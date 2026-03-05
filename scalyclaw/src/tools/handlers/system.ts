import { DEFAULT_CONTEXT_WINDOW, DEFAULT_CHARS_PER_TOKEN } from '../../const/constants.js';
import { getConfigRef } from '../../core/config.js';
import { buildBudget, ensureBudget, estimateMessagesTokens } from '../../orchestrator/context.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { handleListAgents } from './agents.js';
import { handleListSkills, handleListModels, handleListGuards, handleListQueues, handleGetUsage, handleGetConfig, listSecrets, listProcesses } from './admin.js';
import type { ToolContext } from '../tool-registry.js';

export async function handleSystemInfo(input: Record<string, unknown>): Promise<string> {
  const section = input.section as string;
  if (!section) return JSON.stringify({ error: 'Missing required field: section' });
  switch (section) {
    case 'agents': return handleListAgents();
    case 'skills': return handleListSkills();
    case 'models': return handleListModels();
    case 'guards': return handleListGuards();
    case 'queues': return handleListQueues();
    case 'processes': {
      const { getRedis: getRedisFn } = await import('@scalyclaw/shared/core/redis.js');
      return JSON.stringify({ processes: await listProcesses(getRedisFn()) });
    }
    case 'usage': return handleGetUsage();
    case 'config': return handleGetConfig({});
    case 'vault': return JSON.stringify({ secrets: await listSecrets() });
    default:
      return JSON.stringify({ error: `Unknown section: "${section}". Valid: agents, skills, models, guards, queues, processes, usage, config, vault` });
  }
}

export async function handleCompactContext(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { messages, modelId } = ctx;
  if (!messages || messages.length <= 2) {
    return JSON.stringify({ compacted: false, reason: 'Nothing to compact' });
  }

  const config = getConfigRef();
  const modelEntry = modelId
    ? config.models.models.find(m => m.id === modelId)
    : undefined;
  const contextWindow = modelEntry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  const budget = buildBudget('', undefined, contextWindow, messages);
  const estimatedTokensBefore = budget.messageTokens;
  const force = input.force === true;

  const result = await ensureBudget(messages, budget, { force });

  const estimatedTokensAfter = estimateMessagesTokens(messages, DEFAULT_CHARS_PER_TOKEN);

  if (!result.compacted && !result.trimmed) {
    return JSON.stringify({
      compacted: false,
      reason: 'Context usage below threshold',
      estimatedTokens: estimatedTokensBefore,
      contextWindow,
      usage: `${Math.round((estimatedTokensBefore / budget.messageBudget) * 100)}%`,
    });
  }

  log('info', 'compact_context completed', {
    messagesBefore: result.messagesBefore,
    messagesAfter: messages.length,
    estimatedTokensBefore,
    estimatedTokensAfter,
  });

  return JSON.stringify({
    compacted: result.compacted,
    trimmed: result.trimmed,
    messagesBefore: result.messagesBefore,
    messagesAfter: messages.length,
    estimatedTokensBefore,
    estimatedTokensAfter,
  });
}
