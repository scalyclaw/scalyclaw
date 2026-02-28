import type { Job } from 'bullmq';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getConfigRef } from '../core/config.js';
import { checkBudget } from '../core/budget.js';
import { loadAgent } from '../agents/agent-loader.js';
import { getProvider } from '../models/registry.js';
import { selectModel, parseModelId } from '../models/provider.js';
import type { ChatMessage } from '../models/provider.js';
import { buildAgentToolDefs, AGENT_ELIGIBLE_TOOL_NAMES } from '../tools/tools.js';
import { getMcpToolsForServers } from '../mcp/mcp-manager.js';
import { executeAssistantTool, type ToolContext } from '../tools/tool-impl.js';
import { registerAbort, unregisterAbort } from '@scalyclaw/shared/queue/cancel-signal.js';
import { recordUsage } from '../core/db.js';
import { sendToChannel } from '../channels/manager.js';
import type { AgentTaskData } from '@scalyclaw/shared/queue/jobs.js';

export interface AgentResult {
  response: string;
  metadata: Record<string, unknown>;
  storeInMemory: boolean;
}

// Agent tools built dynamically per-agent from buildAgentToolDefs() — scoped to
// operational tools only, with skill access restricted by agent.skills.

// ─── Agent job processor (scalyclaw-agents queue, runs on node) ───

export async function processAgentJob(job: Job<AgentTaskData>): Promise<string> {
  const { channelId, agentId, context } = job.data;
  const task = job.data.task ?? '';
  const jobId = job.id!;

  if (!task) {
    log('warn', `Agent job missing task`, { jobId, agentId });
    return JSON.stringify({
      response: `Agent "${agentId ?? 'default'}" failed: no task provided. Use delegate_agent with { agentId, task, context? }.`,
      metadata: { error: true },
      storeInMemory: false,
    } satisfies AgentResult);
  }

  log('info', `Processing agent task: ${agentId}`, { jobId, channelId, taskLength: task.length });

  const ac = new AbortController();
  registerAbort(jobId, ac);
  try {
    const result = await runAgentLoop(agentId ?? 'default', task, context ?? '', channelId, jobId, ac.signal);
    return JSON.stringify(result);
  } finally {
    unregisterAbort(jobId);
  }
}

async function runAgentLoop(
  agentId: string,
  task: string,
  context: string,
  channelId: string,
  jobId: string,
  signal: AbortSignal,
): Promise<AgentResult> {
  log('info', `>>> Agent loop: ${agentId}`, { taskLength: task.length, contextLength: context.length, channelId });

  // Budget enforcement (DB available — runs on node)
  const budgetStatus = checkBudget();
  if (!budgetStatus.allowed) {
    log('warn', `Agent "${agentId}" blocked by budget limit`);
    return {
      response: `Budget limit exceeded — daily: $${budgetStatus.currentDayCost.toFixed(2)}/$${budgetStatus.dailyLimit}, monthly: $${budgetStatus.currentMonthCost.toFixed(2)}/$${budgetStatus.monthlyLimit}.`,
      metadata: { error: true, budgetExceeded: true },
      storeInMemory: false,
    };
  }

  const agent = await loadAgent(agentId);
  if (!agent) {
    log('warn', `Agent "${agentId}" not found`);
    return {
      response: `Agent "${agentId}" not found or failed to load.`,
      metadata: { error: true },
      storeInMemory: false,
    };
  }

  const config = getConfigRef();
  const maxIterations = agent.maxIterations ?? config.orchestrator.maxIterations;

  // "auto" means use global model selection — filter it out so selectModel falls through
  const agentModels = agent.models.filter(m => m.model !== 'auto');
  const modelId = selectModel(agentModels)
    ?? selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
  if (!modelId) {
    return {
      response: `No model configured for agent "${agentId}".`,
      metadata: { error: true },
      storeInMemory: false,
    };
  }
  const { provider: providerId, model } = parseModelId(modelId);

  let provider;
  try {
    provider = getProvider(providerId);
  } catch {
    return {
      response: `Model provider "${providerId}" is not available.`,
      metadata: { error: true },
      storeInMemory: false,
    };
  }

  // Build messages
  const messages: ChatMessage[] = [];
  if (context) {
    messages.push({ role: 'user', content: `Context:\n${context}` });
  }
  messages.push({ role: 'user', content: task });

  // Compute scoped MCP tools and build agent tool definitions
  const mcpTools = getMcpToolsForServers(agent.mcpServers);
  const agentTools = buildAgentToolDefs(agent.tools, agent.skills, mcpTools);

  // Build allowed tool names set for runtime enforcement
  const eligibleSet = new Set(AGENT_ELIGIBLE_TOOL_NAMES);
  const allowedToolNames = new Set<string>([
    ...agent.tools.filter(t => eligibleSet.has(t)),
    ...mcpTools.map(t => t.name),
    'submit_job', 'submit_parallel_jobs', 'get_job', 'list_active_jobs', 'stop_job',
  ]);

  const toolCtx: ToolContext = {
    channelId,
    sendToChannel: async (chId: string, text: string) => {
      await sendToChannel(chId || channelId, text);
    },
    messages,
    modelId,
    allowedSkillIds: agent.skills.length > 0 ? agent.skills : undefined,
    allowedToolNames,
  };

  let finalContent = '';
  let round = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    while (round < maxIterations) {
      // Check cancel before each round
      if (signal.aborted) {
        log('info', `Agent "${agentId}" cancelled`, { round, jobId });
        break;
      }

      round++;

      // Re-check budget every 5 rounds to prevent runaway cost
      if (round > 1 && round % 5 === 0) {
        const midBudget = checkBudget();
        if (!midBudget.allowed) {
          log('warn', `Agent "${agentId}" stopped — budget exceeded mid-loop`, { round });
          finalContent = finalContent || `Agent "${agentId}" stopped: budget limit reached.`;
          break;
        }
      }

      const modelConfig = config.models.models.find(m => m.id === modelId);
      log('debug', `Agent "${agentId}" LLM round ${round}`, { messageCount: messages.length, tools: agentTools.length });

      const response = await provider.chat({
        model,
        systemPrompt: agent.systemPrompt,
        messages,
        tools: agentTools.length > 0 ? agentTools : undefined,
        maxTokens: modelConfig?.maxTokens ?? 8192,
        temperature: modelConfig?.temperature ?? 0.7,
        reasoningEnabled: modelConfig?.reasoningEnabled,
        signal,
      });

      totalInputTokens += response.usage?.inputTokens ?? 0;
      totalOutputTokens += response.usage?.outputTokens ?? 0;

      if (response.content) {
        finalContent = response.content;
      }

      // No tool calls — done
      if (response.toolCalls.length === 0) {
        break;
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      const toolResults = await Promise.all(
        response.toolCalls.map(async (tc) => {
          if (signal.aborted) return { id: tc.id, result: '{"error":"Cancelled"}' };
          const result = await executeAssistantTool(tc.name, tc.input, toolCtx);
          return { id: tc.id, result };
        })
      );

      for (const { id, result } of toolResults) {
        messages.push({ role: 'tool', content: result, tool_call_id: id });
      }
    }

    if (round >= maxIterations) {
      log('warn', `Agent "${agentId}" hit max iterations`, { rounds: round, maxIterations });
    }

    // Record usage directly (DB available on node)
    recordUsage({
      model: modelId,
      provider: providerId,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      type: 'agent',
      agentId,
      channelId,
    });

    log('info', `<<< Agent "${agentId}" done`, {
      rounds: round,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      responseLength: finalContent.length,
    });

    // Try to parse structured output
    try {
      const parsed = JSON.parse(finalContent) as Partial<AgentResult>;
      return {
        response: parsed.response ?? finalContent,
        metadata: parsed.metadata ?? {},
        storeInMemory: parsed.storeInMemory ?? false,
      };
    } catch {
      return {
        response: finalContent,
        metadata: {},
        storeInMemory: false,
      };
    }
  } catch (err) {
    log('error', `Agent "${agentId}" loop failed`, { error: String(err) });
    return {
      response: `Agent "${agentId}" encountered an error: ${String(err)}`,
      metadata: { error: true },
      storeInMemory: false,
    };
  }
}
