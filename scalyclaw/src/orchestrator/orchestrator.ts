import { log } from '@scalyclaw/shared/core/logger.js';
import { DEFAULT_CONTEXT_WINDOW } from '../const/constants.js';
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
  };

  // LLM tool loop
  let finalContent = '';
  let lastProgressSent = '';  // Track what was already sent as progress
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

    const response = await provider.chat({
      model,
      systemPrompt,
      messages,
      tools: allTools,
      maxTokens: modelConfig?.maxTokens ?? 8192,
      temperature: modelConfig?.temperature ?? 0.7,
      reasoningEnabled: modelConfig?.reasoningEnabled,
      signal: input.signal,
    });

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

    // Send progress to channel — surface what the assistant is doing
    const progressText = response.content?.trim();
    if (progressText) {
      // LLM provided narration alongside tool calls — relay it
      lastProgressSent = progressText;
      await input.sendToChannel(input.channelId, progressText).catch(() => {});
    } else if (round === 1) {
      // First round, no narration — auto-generate friendly status
      const brief = describeToolCalls(response.toolCalls);
      if (brief) {
        lastProgressSent = brief;
        await input.sendToChannel(input.channelId, brief).catch(() => {});
      }
    }

    // Add assistant message with tool calls to conversation
    messages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls,
    });

    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        if (input.signal?.aborted) return { toolCall: tc, result: '{"error":"Aborted"}' };
        const result = await handleToolCall(tc.name, tc.input, toolCtx);
        return { toolCall: tc, result };
      })
    );

    // Add all tool results to conversation (dynamically truncate based on remaining budget)
    for (const { toolCall, result } of toolResults) {
      const content = truncateToolResult(result, budget);
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

  // If finalContent was already sent as progress, don't re-deliver it (avoids duplicate messages)
  if (finalContent && finalContent === lastProgressSent) {
    finalContent = '';
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

// ─── Context-aware tool-call descriptions for auto-progress ───

import type { ToolCall } from '../models/provider.js';

/** Extract a context-aware description from a single tool call */
function describeToolCall(name: string, input: Record<string, unknown> | undefined): string {
  // Unwrap submit_job payload
  let payload = input;
  if (name === 'submit_job' && input) {
    name = (input.toolName as string) || name;
    payload = (input.payload as Record<string, unknown>) ?? input;
  }

  const p = payload ?? {};

  switch (name) {
    // Skills — include skill name
    case 'execute_skill': {
      const id = p.skillId as string;
      return id ? `Running ${id}` : 'Running a skill';
    }
    // Agents — include agent name and task hint
    case 'delegate_agent': {
      const id = p.agentId as string;
      return id ? `Asking ${id}` : 'Delegating to an agent';
    }
    case 'create_agent': {
      const n = (p.name as string) || (p.id as string);
      return n ? `Creating agent "${n}"` : 'Creating an agent';
    }
    // Memory — include query/subject
    case 'memory_search': {
      const q = p.query as string;
      return q ? `Searching memory for "${q}"` : 'Searching memory';
    }
    case 'memory_store': {
      const s = p.subject as string;
      return s ? `Remembering "${s}"` : 'Saving to memory';
    }
    // Commands
    case 'execute_command': {
      const cmd = p.command as string;
      if (cmd) {
        const short = cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd;
        return `Running \`${short}\``;
      }
      return 'Running a command';
    }
    case 'execute_code': {
      const lang = p.language as string;
      return lang ? `Running ${lang} code` : 'Running code';
    }
    // Scheduling — include what's being scheduled
    case 'schedule_reminder':
    case 'schedule_task': {
      const msg = (p.message as string) || (p.task as string);
      if (msg) {
        const short = msg.length > 40 ? msg.slice(0, 40) + '...' : msg;
        return `Scheduling "${short}"`;
      }
      return name === 'schedule_reminder' ? 'Setting a reminder' : 'Scheduling a task';
    }
    case 'schedule_recurrent_reminder':
    case 'schedule_recurrent_task':
      return 'Setting up a recurring schedule';
    // Files — include path
    case 'file_read':
    case 'file_write':
    case 'file_edit': {
      const path = p.path as string;
      if (path) {
        const short = path.length > 30 ? '...' + path.slice(-30) : path;
        return `${name === 'file_read' ? 'Reading' : name === 'file_write' ? 'Writing' : 'Editing'} ${short}`;
      }
      return name === 'file_read' ? 'Reading a file' : name === 'file_write' ? 'Writing a file' : 'Editing a file';
    }
    case 'send_file': {
      const path = p.path as string;
      if (path) {
        const fileName = path.split('/').pop() || path;
        return `Sending ${fileName}`;
      }
      return 'Sending a file';
    }
    // System info — include section
    case 'system_info': {
      const section = p.section as string;
      return section ? `Checking ${section}` : 'Checking system info';
    }
    // Simple labels for everything else
    case 'send_message':    return '';  // Don't narrate send_message (it IS user-facing)
    case 'list_reminders':  return 'Checking your reminders';
    case 'list_tasks':      return 'Checking your tasks';
    case 'cancel_reminder': return 'Cancelling a reminder';
    case 'cancel_task':     return 'Cancelling a task';
    case 'memory_recall':   return 'Recalling memories';
    case 'memory_update':   return 'Updating a memory';
    case 'memory_delete':   return 'Removing a memory';
    case 'vault_store':     return 'Storing a secret';
    case 'vault_list':      return 'Checking the vault';
    case 'register_skill':  return 'Registering a skill';
    case 'compact_context': return 'Freeing up context space';
    default:                return '';
  }
}

/** Build a friendly one-liner from a list of tool calls */
function describeToolCalls(toolCalls: ToolCall[]): string {
  const labels: string[] = [];
  for (const tc of toolCalls) {
    // Unwrap submit_parallel_jobs into individual descriptions
    if (tc.name === 'submit_parallel_jobs' && tc.input) {
      const jobs = tc.input.jobs as Array<{ toolName?: string; payload?: Record<string, unknown> }> | undefined;
      if (jobs) {
        for (const j of jobs) {
          const desc = describeToolCall(j.toolName || '', j.payload);
          if (desc) labels.push(desc);
        }
      }
      continue;
    }
    const desc = describeToolCall(tc.name, tc.input as Record<string, unknown>);
    if (desc) labels.push(desc);
  }
  if (labels.length === 0) return '';
  const unique = [...new Set(labels)];
  if (unique.length === 1) return `${unique[0]}...`;
  if (unique.length <= 3) return `${unique.join(', ')}...`;
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more...`;
}
