import { log } from '@scalyclaw/shared/core/logger.js';
import { getConfigRef } from '../core/config.js';
import { checkBudget } from '../core/budget.js';
import type { ChatMessage } from '../models/provider.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { ASSISTANT_TOOLS } from '../tools/tools.js';
import { getMcpTools } from '../mcp/mcp-manager.js';
import { handleToolCall, type ToolContext } from './tool-handlers.js';
import { buildSystemPrompt } from '../prompt/builder.js';
import { getRecentMessages, recordUsage } from '../core/db.js';
import { getProvider } from '../models/registry.js';
import { searchMemory } from '../memory/memory.js';

export type StopReason = 'continue' | 'cancelled' | 'budget';

export interface OrchestratorInput {
  channelId: string;
  /** Used for logging only — the user message is already stored in DB and loaded via getRecentMessages */
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

  // Load unified conversation history (sync SQLite call)
  const recentMessages = getRecentMessages(50);
  log('debug', 'Loaded conversation history', { channelId: input.channelId, messageCount: recentMessages.length });

  const messages: ChatMessage[] = recentMessages.map(m => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }));

  // Select model
  const modelId = selectModel(config.orchestrator.models)
    ?? selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
  if (!modelId) {
    throw new Error('No model configured — add a model in the dashboard or set orchestrator.models in config');
  }
  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);
  log('debug', 'Model selected', { providerId, model, modelId });

  // Trim old messages if context is too large (model-aware budget)
  const modelConfig = config.models.models.find(m => m.id === modelId);
  const maxContextChars = (modelConfig?.contextWindow ?? 128_000) * 3.5;
  trimToContextBudget(messages, maxContextChars);

  const toolCtx: ToolContext = {
    channelId: input.channelId,
    sendToChannel: input.sendToChannel,
    signal: input.signal,
    messages,
    modelId,
  };

  const mcpTools = getMcpTools();
  const allTools = mcpTools.length > 0 ? [...ASSISTANT_TOOLS, ...mcpTools] : ASSISTANT_TOOLS;

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
    log('debug', `--- LLM round ${round} ---`, {
      messagesInContext: messages.length,
      toolsAvailable: allTools.length,
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
    if (response.stopReason !== 'tool_use' || response.toolCalls.length === 0) {
      break;
    }

    // Send progress to channel — surface what the assistant is doing
    const progressText = response.content?.trim();
    if (progressText) {
      // LLM provided narration alongside tool calls — relay it
      await input.sendToChannel(input.channelId, progressText).catch(() => {});
    } else if (round === 1) {
      // First round, no narration — auto-generate friendly status
      const brief = describeToolCalls(response.toolCalls);
      if (brief) await input.sendToChannel(input.channelId, brief).catch(() => {});
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

    // Add all tool results to conversation
    for (const { toolCall, result } of toolResults) {
      messages.push({
        role: 'tool',
        content: result,
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
    if (!finalContent) {
      finalContent = 'I hit my processing limit on this one. Let me know if you need me to continue.';
    }
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

/** Estimate character size of a message including tool_calls JSON */
function messageChars(m: ChatMessage): number {
  let chars = m.content.length;
  if (m.tool_calls && m.tool_calls.length > 0) {
    chars += JSON.stringify(m.tool_calls).length;
  }
  return chars;
}

/**
 * Remove oldest messages until total content fits within the character budget.
 * Preserves tool-call/tool-result groups: an assistant message with tool_calls
 * is always removed together with its following tool-result messages.
 */
function trimToContextBudget(messages: ChatMessage[], maxChars: number): void {
  let totalChars = messages.reduce((sum, m) => sum + messageChars(m), 0);
  if (totalChars <= maxChars || messages.length <= 1) return;

  let removeCount = 0;
  let removedChars = 0;

  while (removeCount < messages.length - 1 && totalChars - removedChars > maxChars) {
    const msg = messages[removeCount];
    removedChars += messageChars(msg);
    removeCount++;

    // If we just removed an assistant message with tool_calls,
    // also remove all following tool-result messages to keep pairs intact
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      while (removeCount < messages.length - 1 && messages[removeCount].role === 'tool') {
        removedChars += messageChars(messages[removeCount]);
        removeCount++;
      }
    }
  }

  // Safety: never leave orphaned tool results at the start
  while (removeCount < messages.length && messages[removeCount].role === 'tool') {
    removedChars += messageChars(messages[removeCount]);
    removeCount++;
  }

  if (removeCount > 0) {
    messages.splice(0, removeCount);
    log('debug', 'Trimmed conversation context', { removedMessages: removeCount, removedChars });
  }
}

// ─── Friendly tool-call descriptions for auto-progress ───

const TOOL_LABELS: Record<string, string> = {
  // Memory
  memory_search:  'Searching memory',
  memory_store:   'Saving to memory',
  memory_recall:  'Recalling memories',
  memory_update:  'Updating memory',
  memory_delete:  'Removing a memory',
  // Messaging
  send_message:   'Sending a message',
  send_file:      'Sending a file',
  // Agents
  delegate_agent: 'Delegating to an agent',
  list_agents:    'Checking agents',
  create_agent:   'Creating an agent',
  update_agent:   'Updating an agent',
  delete_agent:   'Removing an agent',
  set_agent_tools: 'Setting agent tools',
  set_agent_mcps:  'Setting agent MCPs',
  // Scheduling
  schedule_reminder:            'Setting a reminder',
  schedule_recurrent_reminder:  'Setting up a recurrent reminder',
  schedule_task:                'Scheduling a task',
  schedule_recurrent_task:      'Setting up a recurrent task',
  list_reminders:               'Listing reminders',
  list_tasks:                   'Listing tasks',
  cancel_reminder:              'Cancelling a reminder',
  cancel_task:                  'Cancelling a task',
  // Usage
  get_usage:                    'Checking usage',
  // Vault
  vault_store:  'Storing a secret',
  vault_check:  'Checking the vault',
  vault_delete: 'Removing a secret',
  vault_list:   'Listing secrets',
  // Skills
  execute_skill:  'Running a skill',
  list_skills:    'Checking skills',
  // Commands
  execute_command: 'Running a command',
  execute_code:    'Running code',
  // Files
  read_file:       'Reading a file',
  write_file:      'Writing a file',
  patch_file:      'Editing a file',
  // Config / system
  get_config:     'Checking config',
  update_config:  'Updating config',
  list_queues:    'Checking queues',
  list_processes: 'Checking processes',
  compact_context:'Compacting context',
};

import type { ToolCall } from '../models/provider.js';

/** Build a friendly one-liner from a list of tool calls */
function describeToolCalls(toolCalls: ToolCall[]): string {
  const labels: string[] = [];
  for (const tc of toolCalls) {
    let name = tc.name;
    // Unwrap submit_job / submit_parallel_jobs
    if (name === 'submit_job' && tc.input) {
      name = (tc.input.toolName as string) || name;
    } else if (name === 'submit_parallel_jobs' && tc.input) {
      const jobs = tc.input.jobs as Array<{ toolName?: string }> | undefined;
      if (jobs) {
        for (const j of jobs) labels.push(TOOL_LABELS[j.toolName || ''] || j.toolName || 'working');
      }
      continue;
    }
    labels.push(TOOL_LABELS[name] || name);
  }
  if (labels.length === 0) return '';
  const unique = [...new Set(labels)];
  if (unique.length === 1) return `${unique[0]}...`;
  if (unique.length <= 3) return `${unique.join(', ')}...`;
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more...`;
}
