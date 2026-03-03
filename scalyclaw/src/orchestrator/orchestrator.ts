import { log } from '@scalyclaw/shared/core/logger.js';
import { withRetry } from '@scalyclaw/shared/core/retry.js';
import { DEFAULT_CONTEXT_WINDOW, LLM_RETRY_ATTEMPTS, LLM_RETRY_BASE_DELAY_MS } from '../const/constants.js';
import { getConfigRef } from '../core/config.js';
import { checkBudget } from '../core/budget.js';
import type { ChatMessage } from '../models/provider.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { ASSISTANT_TOOLS } from '../tools/tools.js';
import { getMcpTools } from '../mcp/mcp-manager.js';
import { handleToolCall, type ToolContext } from './tool-handlers.js';
import { buildSystemPrompt } from '../prompt/builder.js';
import { recordUsage } from '../core/db.js';
import { getProvider } from '../models/registry.js';
import { searchMemory } from '../memory/memory.js';
import { initContext, calibrate, ensureBudget, truncateToolResult } from './context.js';

export type StopReason = 'continue' | 'cancelled' | 'budget';

export interface OrchestratorInput {
  channelId: string;
  /** Used for logging only — the user message is already stored in DB and loaded via getChannelMessages */
  text: string;
  sendToChannel: (channelId: string, text: string) => Promise<void>;
  onRoundComplete?: () => Promise<void>;
  /** Return a stop reason (or 'continue' to keep going) */
  shouldStop?: () => Promise<StopReason>;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export async function runOrchestrator(input: OrchestratorInput): Promise<string> {
  const config = getConfigRef();
  const maxIterations = config.orchestrator.maxIterations;
  const maxInputTokens = config.orchestrator.maxInputTokens;

  // Budget enforcement
  const budgetStatus = checkBudget();
  if (!budgetStatus.allowed) {
    throw new Error(
      `Budget limit exceeded — daily: $${budgetStatus.currentDayCost.toFixed(2)}/$${budgetStatus.dailyLimit}, monthly: $${budgetStatus.currentMonthCost.toFixed(2)}/$${budgetStatus.monthlyLimit}. Disable hard limit in budget settings to continue.`
    );
  }

  log('info', '>>> Orchestrator called', {
    channelId: input.channelId,
    textLength: input.text.length,
  });

  // Parallelize system prompt build + auto-recall memory search
  const [systemPromptBase, memories] = await Promise.all([
    buildSystemPrompt(),
    input.text.length >= 10
      ? searchMemory(input.text, { topK: 5 }).catch(err => {
          log('warn', 'Auto-recall failed — continuing without memories', { error: String(err) });
          return [] as Awaited<ReturnType<typeof searchMemory>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof searchMemory>>),
  ]);

  let systemPrompt = systemPromptBase;
  if (memories.length > 0) {
    const memorySection = memories
      .map(m => `- **${m.subject}**: ${m.content}`)
      .join('\n');
    systemPrompt += `\n\n## Relevant Memories\n${memorySection}`;
    log('debug', 'Auto-recall injected memories', { count: memories.length, topScore: memories[0].score });
  }

  // Select model (need contextWindow for initContext)
  const modelId = selectModel(config.orchestrator.models)
    ?? selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
  if (!modelId) {
    throw new Error('No model configured — add a model in the dashboard or set orchestrator.models in config');
  }
  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);
  const modelConfig = config.models.models.find(m => m.id === modelId);
  log('debug', 'Model selected', { providerId, model, modelId });

  const mcpTools = getMcpTools();
  const allTools = mcpTools.length > 0 ? [...ASSISTANT_TOOLS, ...mcpTools] : ASSISTANT_TOOLS;

  // Load channel-scoped messages + build context budget
  const { messages, budget } = initContext({
    channelId: input.channelId,
    systemPrompt,
    tools: allTools,
    contextWindow: modelConfig?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
  });
  log('debug', 'Loaded conversation history', { channelId: input.channelId, messageCount: messages.length });

  const toolCtx: ToolContext = {
    channelId: input.channelId,
    sendToChannel: input.sendToChannel,
    signal: input.signal,
    messages,
    modelId,
    sentFiles: new Set(),
  };

  // LLM tool loop
  let finalContent = '';
  let round = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (round < maxIterations) {
    // Check abort before each round
    if (input.signal?.aborted) {
      log('info', 'Orchestrator aborted before round start', { channelId: input.channelId, round });
      break;
    }

    round++;

    // Ensure messages fit within context budget before each LLM call
    await ensureBudget(messages, budget);

    log('debug', `--- LLM round ${round} ---`, {
      messagesInContext: messages.length,
      toolsAvailable: allTools.length,
      messageTokens: budget.messageTokens,
      messageBudget: budget.messageBudget,
    });

    const response = await withRetry(
      () => provider.chat({
        model,
        systemPrompt,
        messages,
        tools: allTools,
        maxTokens: modelConfig?.maxTokens ?? 8192,
        temperature: modelConfig?.temperature ?? 0.7,
        reasoningEnabled: modelConfig?.reasoningEnabled,
        signal: input.signal,
      }),
      {
        attempts: LLM_RETRY_ATTEMPTS,
        baseDelay: LLM_RETRY_BASE_DELAY_MS,
        signal: input.signal,
        label: 'LLM call',
        shouldRetry: (err) => {
          // Don't retry on abort or budget errors
          const msg = String(err);
          return !msg.includes('Aborted') && !msg.includes('Budget limit');
        },
      },
    );

    totalInputTokens += response.usage?.inputTokens ?? 0;
    totalOutputTokens += response.usage?.outputTokens ?? 0;

    // Calibrate after round 1 using real token counts
    if (round === 1 && response.usage?.inputTokens) {
      calibrate(budget, response.usage.inputTokens, messages, systemPrompt, allTools);
    }

    log('debug', `LLM round ${round} response`, {
      stopReason: response.stopReason,
      toolCallCount: response.toolCalls.length,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      contentLength: response.content?.length ?? 0,
    });

    if (response.content) {
      finalContent = response.content;
    }

    // No tool calls — done
    if (response.toolCalls.length === 0) {
      break;
    }

    // Guard against runaway token usage (e.g. self-repair loops)
    if (totalInputTokens > maxInputTokens) {
      log('warn', 'Orchestrator hit token limit', {
        channelId: input.channelId,
        round,
        totalInputTokens,
        maxInputTokens,
      });
      // Don't override useful content with a generic error.
      // If nothing was produced at all, leave finalContent empty — the caller decides what to do.
      break;
    }

    // Add assistant message with tool calls to conversation
    messages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls,
    });

    // Send intermediate progress message before executing tools
    const toolNames = response.toolCalls.map(tc => tc.name).join(', ');
    input.sendToChannel(input.channelId, `Using ${toolNames}...`).catch(() => {});

    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        if (input.signal?.aborted) return { toolCall: tc, result: '{"error":"Aborted"}' };
        const result = await handleToolCall(tc.name, tc.input, toolCtx);
        return { toolCall: tc, result };
      })
    );

    // Add all tool results to conversation (dynamically truncate based on remaining budget)
    for (const { toolCall, result } of toolResults) {
      const content = truncateToolResult(result, budget, toolCall.name);
      messages.push({
        role: 'tool',
        content,
        tool_call_id: toolCall.id,
      });
    }

    // Notify caller that a round completed (used to refresh heartbeat)
    if (input.onRoundComplete) await input.onRoundComplete();

    // Check if we should stop early
    if (input.shouldStop) {
      const reason = await input.shouldStop();
      if (reason === 'cancelled') {
        log('info', 'Orchestrator cancelled', { channelId: input.channelId, round });
        break;
      }
    }
  }

  if (round >= maxIterations) {
    log('warn', 'Orchestrator hit max iterations', { channelId: input.channelId, rounds: round, maxIterations });
    // Don't override useful content with a generic error
  }

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    type: 'orchestrator',
    channelId: input.channelId,
  });

  log('info', '<<< Orchestrator done', {
    channelId: input.channelId,
    rounds: round,
    totalInputTokens,
    totalOutputTokens,
    responseLength: finalContent.length,
  });

  return finalContent;
}
