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
    sentFiles: new Set(),
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

/** Shorten a string with ellipsis if it exceeds maxLen */
function shorten(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

/** Extract a user-friendly description from a single tool call */
function describeToolCall(name: string, input: Record<string, unknown> | undefined): string {
  // Unwrap submit_job payload
  let payload = input;
  if (name === 'submit_job' && input) {
    name = (input.toolName as string) || name;
    payload = (input.payload as Record<string, unknown>) ?? input;
  }

  const p = payload ?? {};

  switch (name) {
    // Skills
    case 'execute_skill': {
      const id = p.skillId as string;
      const inp = p.input as string;
      if (id && inp) return `Running skill "${id}" with: ${shorten(inp, 50)}`;
      if (id) return `Running skill "${id}"`;
      return 'Running a skill';
    }
    // Agents — show agent name + task excerpt
    case 'delegate_agent': {
      const id = p.agentId as string;
      const task = p.task as string;
      if (id && task) return `Handing off to agent "${id}": ${shorten(task, 60)}`;
      if (id) return `Handing off to agent "${id}"`;
      if (task) return `Handing off to an agent: ${shorten(task, 60)}`;
      return 'Handing off to an agent';
    }
    case 'create_agent': {
      const n = (p.name as string) || (p.id as string);
      return n ? `Setting up a new agent: "${n}"` : 'Setting up a new agent';
    }
    // Memory
    case 'memory_search': {
      const q = p.query as string;
      return q ? `Looking up memories about "${shorten(q, 40)}"` : 'Looking up memories';
    }
    case 'memory_store': {
      const s = p.subject as string;
      return s ? `Saving to memory: "${shorten(s, 40)}"` : 'Saving something to memory';
    }
    case 'memory_recall': {
      const q = (p.query as string) || (p.id as string);
      return q ? `Recalling memory: "${shorten(q, 40)}"` : 'Recalling from memory';
    }
    case 'memory_update': {
      const s = (p.subject as string) || (p.id as string);
      return s ? `Updating memory: "${shorten(s, 40)}"` : 'Updating a memory';
    }
    case 'memory_delete': {
      const id = p.id as string;
      return id ? `Removing memory "${shorten(id, 30)}"` : 'Removing a memory';
    }
    // Commands
    case 'execute_command': {
      const cmd = p.command as string;
      return cmd ? `Running command: \`${shorten(cmd, 50)}\`` : 'Running a shell command';
    }
    case 'execute_code': {
      const lang = p.language as string;
      return lang ? `Executing ${lang} code` : 'Executing code';
    }
    // Scheduling
    case 'schedule_reminder': {
      const msg = p.message as string;
      return msg ? `Setting a reminder: "${shorten(msg, 50)}"` : 'Setting a reminder for you';
    }
    case 'schedule_task': {
      const task = p.task as string;
      return task ? `Scheduling a task: "${shorten(task, 50)}"` : 'Scheduling a task for later';
    }
    case 'schedule_recurrent_reminder': {
      const msg = p.message as string;
      return msg ? `Setting up recurring reminder: "${shorten(msg, 40)}"` : 'Setting up a recurring reminder';
    }
    case 'schedule_recurrent_task': {
      const task = p.task as string;
      return task ? `Setting up recurring task: "${shorten(task, 40)}"` : 'Setting up a recurring task';
    }
    // Files
    case 'file_read': {
      const path = p.path as string;
      return path ? `Reading file: ${shorten(path, 40)}` : 'Reading a file';
    }
    case 'file_write': {
      const path = p.path as string;
      return path ? `Writing to file: ${shorten(path, 40)}` : 'Writing a file';
    }
    case 'file_edit': {
      const path = p.path as string;
      return path ? `Editing file: ${shorten(path, 40)}` : 'Editing a file';
    }
    case 'send_file': {
      const path = p.path as string;
      if (path) {
        const fileName = path.split('/').pop() || path;
        return `Sending file: ${fileName}`;
      }
      return 'Sending a file';
    }
    // System
    case 'system_info': {
      const section = p.section as string;
      return section ? `Checking system info: ${section}` : 'Checking system info';
    }
    // Vault
    case 'vault_store': {
      const name = p.name as string;
      return name ? `Storing secret "${name}" in the vault` : 'Storing a secret in the vault';
    }
    case 'vault_list':      return 'Listing vault secrets';
    // Skills management
    case 'register_skill': {
      const id = p.id as string;
      return id ? `Registering skill "${id}"` : 'Registering a new skill';
    }
    // Context
    case 'compact_context': return 'Compacting conversation to free up context space';
    // Scheduling lists
    case 'list_reminders':  return 'Looking up your reminders';
    case 'list_tasks':      return 'Looking up your scheduled tasks';
    case 'cancel_reminder': {
      const id = p.id as string;
      return id ? `Cancelling reminder "${shorten(id, 30)}"` : 'Cancelling a reminder';
    }
    case 'cancel_task': {
      const id = p.id as string;
      return id ? `Cancelling task "${shorten(id, 30)}"` : 'Cancelling a task';
    }
    // Don't narrate send_message — it IS user-facing output
    case 'send_message':    return '';
    default:                return '';
  }
}

/** Build a user-friendly status line from a list of tool calls */
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
  if (unique.length === 1) return unique[0];
  if (unique.length <= 3) return unique.join(' · ');
  return `${unique.slice(0, 2).join(' · ')} (+${unique.length - 2} more)`;
}
