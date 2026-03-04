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
import { getTopEntities } from '../memory/entities.js';
import { initContext, buildBudget, calibrate, ensureBudget, truncateToolResult } from './context.js';

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
  /** When provided, skip initContext and use these messages instead (task mode). */
  isolatedMessages?: ChatMessage[];
}

const TASK_MODE_PROMPT = `\n\n## Scheduled Task Mode
You are executing a scheduled task. Focus exclusively on completing the task described in the user message. Do not reference or respond to any prior conversations. Execute the required tools and provide a concise result. If the task requires specific tools, call them — do not simulate or hallucinate results.`;

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
      ? searchMemory(input.text, { topK: 7 }).catch(err => {
          log('warn', 'Auto-recall failed — continuing without memories', { error: String(err) });
          return [] as Awaited<ReturnType<typeof searchMemory>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof searchMemory>>),
  ]);

  let systemPrompt = systemPromptBase;
  if (memories.length > 0) {
    const memorySection = memories
      .map(m => `- [${m.type}] **${m.subject}** (importance: ${m.importance}): ${m.content}`)
      .join('\n');
    systemPrompt += `\n\n## Relevant Memories\n${memorySection}`;
    log('debug', 'Auto-recall injected memories', { count: memories.length, topScore: memories[0].score });
  }

  // Inject entity context
  try {
    const topEntities = getTopEntities(5);
    if (topEntities.length > 0) {
      const entityLines = topEntities.map(e => {
        const rels = e.relations.map(r => `${r.relation} ${r.target}`).join(', ');
        return `- **${e.name}** (${e.type}${rels ? ': ' + rels : ''})`;
      });
      systemPrompt += `\n\n## Known Entities\n${entityLines.join('\n')}`;
    }
  } catch {
    // Entity context is optional — don't fail if it errors
  }

  if (input.isolatedMessages) {
    systemPrompt += TASK_MODE_PROMPT;
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

  // Load context: isolated for tasks, full history for normal messages
  let messages: ChatMessage[];
  let budget;
  const contextWindow = modelConfig?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  if (input.isolatedMessages) {
    messages = [...input.isolatedMessages];
    budget = buildBudget(systemPrompt, allTools, contextWindow, messages);
    log('debug', 'Using isolated context (task mode)', { channelId: input.channelId, messageCount: messages.length });
  } else {
    const ctx = initContext({
      channelId: input.channelId,
      systemPrompt,
      tools: allTools,
      contextWindow,
    });
    messages = ctx.messages;
    budget = ctx.budget;
    log('debug', 'Loaded conversation history', { channelId: input.channelId, messageCount: messages.length });
  }

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
  const sentProgress = new Set<string>();

  // Consecutive execution-tool failure tracking (prevents retry storms)
  const EXEC_TOOLS = new Set(['execute_skill', 'execute_code', 'execute_command']);
  const MAX_CONSECUTIVE_EXEC_FAILURES = 3;
  let consecutiveExecFailures = 0;

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

    // Send intermediate progress message before executing tools (skip already-sent lines)
    const newLines = response.toolCalls
      .map(tc => describeToolCall(tc.name, tc.input))
      .filter(line => !sentProgress.has(line));
    if (newLines.length > 0) {
      for (const line of newLines) sentProgress.add(line);
      input.sendToChannel(input.channelId, newLines.join('\n')).catch(() => {});
    }

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

      // Track consecutive execution-tool failures
      if (EXEC_TOOLS.has(toolCall.name)) {
        try {
          const parsed = JSON.parse(result);
          if (parsed.error || (parsed.exitCode !== undefined && parsed.exitCode !== 0)) {
            consecutiveExecFailures++;
          } else {
            consecutiveExecFailures = 0;
          }
        } catch { consecutiveExecFailures++; }
      }
    }

    // Stop retry storms: after N consecutive execution failures, inject a system hint
    if (consecutiveExecFailures >= MAX_CONSECUTIVE_EXEC_FAILURES) {
      log('warn', 'Consecutive execution failures — injecting stop hint', {
        channelId: input.channelId,
        failures: consecutiveExecFailures,
      });
      consecutiveExecFailures = 0;
      messages.push({
        role: 'user',
        content: '[System: Tool execution has failed repeatedly on the worker. Stop retrying and inform the user that the requested operation could not be completed. Suggest they check the worker logs for details.]',
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

// ─── Progress message helpers ───

/** Extract a short detail string from tool input for a given key, truncated. */
function detail(input: Record<string, unknown>, key: string, maxLen = 40): string {
  const val = input[key];
  if (val == null) return '';
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function describeDirectTool(name: string, input: Record<string, unknown>): string {
  const d = (key: string, max?: number) => detail(input, key, max);
  switch (name) {
    // Memory
    case 'memory_store':    return `💾 Saving "${d('subject')}" to memory…`;
    case 'memory_search':   return `🔍 Searching memories for "${d('query')}"…`;
    case 'memory_recall':   return '🧠 Recalling memories…';
    case 'memory_update':   return `💾 Updating memory "${d('subject')}"…`;
    case 'memory_delete':   return '🗑️ Removing a memory…';
    case 'memory_reflect':  return '🔄 Reflecting on memories…';
    case 'memory_graph':    return `🕸️ Querying knowledge graph for "${d('entity')}"…`;
    // Messaging
    case 'send_message':    return `💬 Sending a message to ${d('channelId') || 'channel'}…`;
    case 'send_file':       return `📎 Sending ${d('filePath') || 'a file'}…`;
    // Agents
    case 'create_agent':    return `🤖 Creating agent "${d('name') || d('id')}"…`;
    case 'delete_agent':    return `🤖 Removing agent "${d('id')}"…`;
    // Skills
    case 'register_skill':  return `⚡ Registering skill "${d('id')}"…`;
    case 'execute_skill':   return `⚡ Running skill "${d('skillId') || 'a skill'}"…`;
    // Agents (direct call)
    case 'delegate_agent':  return `🤖 Delegating to "${d('agentId') || 'an agent'}"…`;
    // Code & commands (direct call)
    case 'execute_code':    return `💻 Running ${d('language') || 'code'}…`;
    case 'execute_command': return `⚙️ Running command: ${d('command', 60) || '…'}`;
    // Vault
    case 'vault_store':     return `🔐 Storing secret "${d('name')}"…`;
    case 'vault_list':      return '🔐 Checking the vault…';
    // Scheduling
    case 'list_reminders':  return '⏰ Checking reminders…';
    case 'list_tasks':      return '📋 Checking tasks…';
    case 'cancel_reminder': return `⏰ Cancelling reminder ${d('jobId')}…`;
    case 'cancel_task':     return `📋 Cancelling task ${d('jobId')}…`;
    // Files
    case 'list_directory':  return `📂 Browsing ${d('path') || 'files'}…`;
    case 'file_read':       return `📄 Reading ${d('path') || 'a file'}…`;
    case 'file_write':      return `✏️ Writing ${d('path') || 'a file'}…`;
    case 'file_edit':       return `✏️ Editing ${d('path') || 'a file'}…`;
    case 'file_ops':        return `📁 ${d('operation') || 'Managing'} ${d('path') || 'files'}…`;
    // System
    case 'system_info':     return `📊 Checking ${d('section') || 'system info'}…`;
    case 'compact_context': return '🧹 Tidying up context…';
    // Jobs
    case 'get_job':          return `📋 Checking job ${d('jobId')}…`;
    case 'list_active_jobs': return '📋 Listing active jobs…';
    case 'stop_job':         return `🛑 Stopping job ${d('jobId')}…`;
    default:                 return `⚙️ Working on it…`;
  }
}

function describeSubmitJob(input: Record<string, unknown>): string {
  const toolName = input.toolName as string | undefined;
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const d = (key: string, max?: number) => detail(payload, key, max);
  switch (toolName) {
    case 'execute_command':              return `⚙️ Running command: ${d('command', 60) || '…'}`;
    case 'execute_skill':               return `⚡ Running skill "${d('skillId') || 'a skill'}"…`;
    case 'execute_code':                return `💻 Running ${d('language') || 'code'}…`;
    case 'delegate_agent':              return `🤖 Delegating to "${d('agentId') || 'an agent'}"…`;
    case 'schedule_reminder':           return `⏰ Setting a reminder…`;
    case 'schedule_recurrent_reminder': return `⏰ Setting a recurring reminder…`;
    case 'schedule_task':               return `📋 Scheduling a task…`;
    case 'schedule_recurrent_task':     return `📋 Scheduling a recurring task…`;
    default:                            return `⚙️ Running ${toolName ?? 'job'}…`;
  }
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  if (name === 'submit_job') return describeSubmitJob(input);
  if (name === 'submit_parallel_jobs') {
    const jobs = input.jobs as Array<Record<string, unknown>> | undefined;
    if (jobs?.length) {
      const lines = jobs.map(j => describeSubmitJob(j));
      return [...new Set(lines)].join('\n');
    }
    return '⚡ Running parallel jobs…';
  }
  if (name.startsWith('mcp_')) return `🔌 Calling ${name.replace(/^mcp_/, '')}…`;
  return describeDirectTool(name, input);
}
