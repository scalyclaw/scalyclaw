import { log } from '@scalyclaw/shared/core/logger.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_CHARS_PER_TOKEN,
  SAFETY_MARGIN_TOKENS,
  COMPACTION_THRESHOLD,
  COMPACTION_KEEP_RATIO,
  MIN_TOOL_RESULT_CHARS,
  MAX_TOOL_RESULT_CHARS,
  TOOL_RESULT_BUDGET_FRACTION,
} from '../const/constants.js';
import { getChannelMessages } from '../core/db.js';
import { getConfigRef } from '../core/config.js';
import { COMPACT_CONTEXT_PROMPT } from '../prompt/compact.js';
import type { ChatMessage, ToolDefinition } from '../models/provider.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { recordUsage } from '../core/db.js';

// ─── Types ───

export interface ContextBudget {
  contextWindow: number;
  systemTokens: number;
  messageBudget: number;
  messageTokens: number;
  charsPerToken: number;
  calibrated: boolean;
}

export interface InitContextOpts {
  channelId: string;
  systemPrompt: string;
  tools?: ToolDefinition[];
  contextWindow?: number;
}

export interface EnsureBudgetOpts {
  /** Force compaction even if under threshold */
  force?: boolean;
}

export interface EnsureBudgetResult {
  compacted: boolean;
  trimmed: boolean;
  messagesBefore: number;
}

// ─── Public API ───

/**
 * Load channel-scoped messages and build an initial context budget.
 */
export function initContext(opts: InitContextOpts): { messages: ChatMessage[]; budget: ContextBudget } {
  const { channelId, systemPrompt, tools, contextWindow = DEFAULT_CONTEXT_WINDOW } = opts;

  const recentMessages = getChannelMessages(channelId, 50);
  log('debug', 'initContext: loaded channel messages', { channelId, count: recentMessages.length });

  const messages: ChatMessage[] = recentMessages.map(m => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }));

  const charsPerToken = DEFAULT_CHARS_PER_TOKEN;
  const systemTokens = estimateSystemTokens(systemPrompt, tools, charsPerToken);
  const messageBudget = contextWindow - systemTokens - SAFETY_MARGIN_TOKENS;
  const messageTokens = estimateMessagesTokens(messages, charsPerToken);

  const budget: ContextBudget = {
    contextWindow,
    systemTokens,
    messageBudget: Math.max(messageBudget, 0),
    messageTokens,
    charsPerToken,
    calibrated: false,
  };

  log('debug', 'initContext: budget computed', {
    contextWindow,
    systemTokens,
    messageBudget: budget.messageBudget,
    messageTokens,
  });

  return { messages, budget };
}

/**
 * Calibrate the chars-per-token ratio using real usage data from the first LLM response.
 * Call this after round 1 to improve accuracy.
 */
export function calibrate(
  budget: ContextBudget,
  realInputTokens: number,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: ToolDefinition[],
): void {
  if (realInputTokens <= 0) return;

  const totalChars = msgArrayChars(messages) + systemPrompt.length + (tools ? JSON.stringify(tools).length : 0);
  const realRatio = totalChars / realInputTokens;

  // Sanity-bound to [1.5, 8.0]
  const bounded = Math.max(1.5, Math.min(8.0, realRatio));

  budget.charsPerToken = bounded;
  budget.calibrated = true;

  // Recompute derived values
  budget.systemTokens = estimateSystemTokens(systemPrompt, tools, bounded);
  budget.messageBudget = Math.max(budget.contextWindow - budget.systemTokens - SAFETY_MARGIN_TOKENS, 0);
  budget.messageTokens = estimateMessagesTokens(messages, bounded);

  log('info', 'Context budget calibrated', {
    charsPerToken: bounded,
    rawRatio: realRatio,
    systemTokens: budget.systemTokens,
    messageBudget: budget.messageBudget,
    messageTokens: budget.messageTokens,
  });
}

/**
 * Ensure messages fit within the context budget.
 * Stage 1: auto-compact if over threshold.
 * Stage 2: emergency trim if still over budget.
 */
export async function ensureBudget(
  messages: ChatMessage[],
  budget: ContextBudget,
  opts?: EnsureBudgetOpts,
): Promise<EnsureBudgetResult> {
  const messagesBefore = messages.length;
  let compacted = false;
  let trimmed = false;

  // Refresh message token estimate
  budget.messageTokens = estimateMessagesTokens(messages, budget.charsPerToken);

  const threshold = budget.messageBudget * COMPACTION_THRESHOLD;

  // Stage 1: Auto-compact
  if ((budget.messageTokens > threshold || opts?.force) && messages.length > 2) {
    compacted = await compactMessages(messages, budget);
    budget.messageTokens = estimateMessagesTokens(messages, budget.charsPerToken);
  }

  // Stage 2: Emergency trim
  if (budget.messageTokens > budget.messageBudget && messages.length > 1) {
    trimOldestMessages(messages, budget);
    budget.messageTokens = estimateMessagesTokens(messages, budget.charsPerToken);
    trimmed = true;
  }

  if (compacted || trimmed) {
    log('debug', 'ensureBudget result', {
      messagesBefore,
      messagesAfter: messages.length,
      compacted,
      trimmed,
      messageTokens: budget.messageTokens,
      messageBudget: budget.messageBudget,
    });
  }

  return { compacted, trimmed, messagesBefore };
}

/**
 * Dynamically truncate a tool result based on remaining context budget.
 */
export function truncateToolResult(result: string, budget: ContextBudget): string {
  const remainingTokens = budget.messageBudget - budget.messageTokens;
  const remainingChars = remainingTokens * budget.charsPerToken;
  const dynamicLimit = Math.min(
    Math.max(Math.floor(remainingChars * TOOL_RESULT_BUDGET_FRACTION), MIN_TOOL_RESULT_CHARS),
    MAX_TOOL_RESULT_CHARS,
  );

  if (result.length <= dynamicLimit) return result;

  return smartTruncate(result, dynamicLimit);
}

/**
 * Build a ContextBudget from raw parameters (for agent processor or compact_context tool).
 */
export function buildBudget(
  systemPrompt: string,
  tools: ToolDefinition[] | undefined,
  contextWindow: number,
  messages: ChatMessage[],
): ContextBudget {
  const charsPerToken = DEFAULT_CHARS_PER_TOKEN;
  const systemTokens = estimateSystemTokens(systemPrompt, tools, charsPerToken);
  const messageBudget = Math.max(contextWindow - systemTokens - SAFETY_MARGIN_TOKENS, 0);
  const messageTokens = estimateMessagesTokens(messages, charsPerToken);

  return {
    contextWindow,
    systemTokens,
    messageBudget,
    messageTokens,
    charsPerToken,
    calibrated: false,
  };
}

// ─── Internal helpers ───

function estimateSystemTokens(systemPrompt: string, tools: ToolDefinition[] | undefined, charsPerToken: number): number {
  let chars = systemPrompt.length;
  if (tools && tools.length > 0) {
    chars += JSON.stringify(tools).length;
  }
  return Math.ceil(chars / charsPerToken);
}

export function estimateMessagesTokens(messages: ChatMessage[], charsPerToken: number): number {
  return Math.ceil(msgArrayChars(messages) / charsPerToken);
}

function estimateMsgTokens(m: ChatMessage, charsPerToken: number): number {
  return Math.ceil(msgChars(m) / charsPerToken);
}

function msgChars(m: ChatMessage): number {
  let chars = m.content.length;
  if (m.tool_calls && m.tool_calls.length > 0) {
    chars += JSON.stringify(m.tool_calls).length;
  }
  return chars;
}

function msgArrayChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + msgChars(m), 0);
}

/** Group messages into standalone or assistant+tool-result groups */
function groupMessages(messages: ChatMessage[]): { startIdx: number; endIdx: number }[] {
  const groups: { startIdx: number; endIdx: number }[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const start = i;
      i++;
      while (i < messages.length && messages[i].role === 'tool') i++;
      groups.push({ startIdx: start, endIdx: i - 1 });
    } else {
      groups.push({ startIdx: i, endIdx: i });
      i++;
    }
  }
  return groups;
}

/**
 * Select the cheapest enabled model from config.
 * Cheapest = lowest inputPricePerMillion among enabled models.
 */
function selectCheapestModel(): string | null {
  const config = getConfigRef();
  const enabled = config.models.models.filter(m => m.enabled);
  if (enabled.length === 0) return null;

  let cheapest = enabled[0];
  for (const m of enabled) {
    if (m.inputPricePerMillion < cheapest.inputPricePerMillion) {
      cheapest = m;
    }
  }
  return cheapest.id;
}

/**
 * Compact old messages by summarizing them via LLM.
 * Returns true if compaction was performed.
 */
async function compactMessages(messages: ChatMessage[], budget: ContextBudget): Promise<boolean> {
  if (messages.length <= 2) return false;

  const groups = groupMessages(messages);

  // Walk backwards to decide how many recent groups to keep (~50% of budget)
  const targetKeepTokens = budget.messageBudget * COMPACTION_KEEP_RATIO;
  let keepTokens = 0;
  let keepFromGroup = groups.length;

  for (let g = groups.length - 1; g >= 0; g--) {
    let groupTokens = 0;
    for (let j = groups[g].startIdx; j <= groups[g].endIdx; j++) {
      groupTokens += estimateMsgTokens(messages[j], budget.charsPerToken);
    }
    if (keepTokens + groupTokens > targetKeepTokens && keepFromGroup < groups.length) break;
    keepTokens += groupTokens;
    keepFromGroup = g;
  }

  // Nothing to compact if we'd keep everything
  if (keepFromGroup === 0) return false;

  const compactEndIdx = groups[keepFromGroup].startIdx;
  const candidateMessages = messages.slice(0, compactEndIdx);
  if (candidateMessages.length === 0) return false;

  // Format for summarization
  const formatted = candidateMessages.map(m => {
    if (m.tool_call_id) return `[tool result for ${m.tool_call_id}]: ${m.content}`;
    let line = `[${m.role}]: ${m.content}`;
    if (m.tool_calls) line += `\n[tool_calls]: ${JSON.stringify(m.tool_calls)}`;
    return line;
  }).join('\n\n');

  // Select cheapest model for summarization
  const config = getConfigRef();
  const summaryModelId = selectCheapestModel()
    ?? selectModel(config.orchestrator.models)
    ?? selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));

  if (!summaryModelId) {
    log('warn', 'Compaction skipped — no model available');
    return false;
  }

  try {
    const { provider: providerId, model } = parseModelId(summaryModelId);
    const provider = getProvider(providerId);

    const summaryResponse = await provider.chat({
      model,
      systemPrompt: COMPACT_CONTEXT_PROMPT,
      messages: [{ role: 'user', content: formatted }],
      maxTokens: 4096,
      temperature: 0.2,
    });

    const summary = summaryResponse.content;

    const messagesBefore = messages.length;
    messages.splice(0, compactEndIdx);
    messages.unshift({
      role: 'user',
      content: `[Previous conversation summary]\n\n${summary}`,
    });

    // Record usage
    recordUsage({
      model: summaryModelId,
      provider: providerId,
      inputTokens: summaryResponse.usage?.inputTokens ?? 0,
      outputTokens: summaryResponse.usage?.outputTokens ?? 0,
      type: 'orchestrator',
    });

    log('info', 'Compaction completed', {
      messagesBefore,
      messagesAfter: messages.length,
      summaryModel: summaryModelId,
      summaryTokens: summaryResponse.usage?.outputTokens ?? 0,
    });

    return true;
  } catch (err) {
    log('warn', 'Compaction failed — falling back to trimming', { error: String(err) });
    return false;
  }
}

/**
 * Emergency trim: remove oldest messages (preserving tool-call/result groups)
 * until messages fit within the budget.
 */
function trimOldestMessages(messages: ChatMessage[], budget: ContextBudget): void {
  let totalTokens = estimateMessagesTokens(messages, budget.charsPerToken);
  if (totalTokens <= budget.messageBudget || messages.length <= 1) return;

  let removeCount = 0;
  let removedTokens = 0;

  while (removeCount < messages.length - 1 && totalTokens - removedTokens > budget.messageBudget) {
    const msg = messages[removeCount];
    removedTokens += estimateMsgTokens(msg, budget.charsPerToken);
    removeCount++;

    // If we just removed an assistant message with tool_calls,
    // also remove all following tool-result messages to keep pairs intact
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      while (removeCount < messages.length - 1 && messages[removeCount].role === 'tool') {
        removedTokens += estimateMsgTokens(messages[removeCount], budget.charsPerToken);
        removeCount++;
      }
    }
  }

  // Safety: never leave orphaned tool results at the start
  while (removeCount < messages.length && messages[removeCount].role === 'tool') {
    removedTokens += estimateMsgTokens(messages[removeCount], budget.charsPerToken);
    removeCount++;
  }

  if (removeCount > 0) {
    messages.splice(0, removeCount);
    log('debug', 'Emergency trim completed', { removedMessages: removeCount, removedTokens });
  }
}

/**
 * Smart truncation: preserves structure based on content type.
 * - JSON arrays → keep head + tail items
 * - Multi-line → keep 60% head + 30% tail
 * - Fallback → hard cut with notice
 */
function smartTruncate(text: string, limit: number): string {
  const notice = `\n...(truncated from ${text.length} chars)`;
  const usable = limit - notice.length;
  if (usable <= 0) return text.slice(0, limit);

  // JSON array: keep head + tail items
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && arr.length > 2) {
        // Binary search for how many items we can keep
        const headCount = Math.ceil(arr.length * 0.6);
        const tailCount = Math.max(1, Math.floor(arr.length * 0.3));
        const head = arr.slice(0, headCount);
        const tail = arr.slice(-tailCount);
        const result = JSON.stringify([...head, `... (${arr.length - headCount - tailCount} items omitted)`, ...tail]);
        if (result.length <= limit) return result;
        // Fallback: reduce to fewer items
        const minHead = Math.min(3, arr.length);
        const minTail = Math.min(2, arr.length - minHead);
        const small = JSON.stringify([
          ...arr.slice(0, minHead),
          `... (${arr.length - minHead - minTail} items omitted)`,
          ...arr.slice(-minTail),
        ]);
        if (small.length <= limit) return small;
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // Multi-line: keep 60% head + 30% tail
  const lines = text.split('\n');
  if (lines.length > 5) {
    const headLines = Math.ceil(lines.length * 0.6);
    const tailLines = Math.max(1, Math.floor(lines.length * 0.3));
    const headPart = lines.slice(0, headLines).join('\n');
    const tailPart = lines.slice(-tailLines).join('\n');
    const combined = headPart + `\n... (${lines.length - headLines - tailLines} lines omitted)\n` + tailPart;
    if (combined.length <= limit) return combined;
  }

  // Fallback: hard cut
  return text.slice(0, usable) + notice;
}
