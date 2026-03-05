import { log } from '@scalyclaw/shared/core/logger.js';
import { getQueue, QUEUE_NAMES, type QueueKey } from '@scalyclaw/shared/queue/queue.js';
import { requestJobCancel } from '@scalyclaw/shared/queue/cancel.js';
import { cancelScheduledJobAdmin, deleteScheduledJob } from '../../scheduler/scheduler.js';
import { removeRepeatableJob } from '@scalyclaw/shared/queue/queue.js';
import { getConfigRef } from '../../core/config.js';
import { checkBudget } from '../../core/budget.js';
import { getSkill } from '@scalyclaw/shared/skills/skill-loader.js';
import type { ToolContext } from '../tool-registry.js';

// Lazy import to break circular dependency (tool-impl → tool-registration → jobs → tool-impl)
async function getToolImpl() {
  return await import('../tool-impl.js');
}

/** Strip leading/trailing whitespace and quotes from tool names (LLMs sometimes emit them). */
export function normalizeToolName(name: string): string {
  return name.replace(/^[\s"']+|[\s"']+$/g, '');
}

/** Validate required payload fields per tool type. Returns error string or null if valid. */
export function validateJobPayload(toolName: string, payload: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'execute_skill':
      if (!payload.skillId) return 'Missing required field: skillId. Use { skillId: "<skill-id>", input: "<json>" }.';
      break;
    case 'execute_code':
      if (!payload.code) return 'Missing required field: code. Use { language: "python"|"javascript"|"bash", code: "<code>" }.';
      break;
    case 'execute_command':
      if (!payload.command) return 'Missing required field: command. Use { command: "<shell command>" }.';
      break;
    case 'delegate_agent':
      if (!payload.agentId) return 'Missing required field: agentId. Use { agentId: "<agent-id>", task: "..." }.';
      if (!payload.task) return 'Missing required field: task. Use { agentId: "<agent-id>", task: "..." }.';
      break;
  }
  return null;
}

/** Shared job query logic for list_jobs / list_active_jobs */
export async function queryJobs(opts: {
  queueKey?: QueueKey; status?: string; limit: number; defaultStatuses: readonly string[];
}): Promise<Record<string, unknown>[]> {
  const baseStatuses = opts.status
    ? [opts.status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed']
    : opts.defaultStatuses as unknown as ('waiting' | 'active' | 'completed' | 'failed' | 'delayed')[];
  const statuses = (baseStatuses as string[]).includes('waiting')
    ? [...baseStatuses, 'prioritized' as any]
    : [...baseStatuses];

  const queuesToSearch = opts.queueKey
    ? [{ key: opts.queueKey, q: getQueue(opts.queueKey) }]
    : Object.keys(QUEUE_NAMES).map(k => ({ key: k, q: getQueue(k as QueueKey) }));

  const jobs: Record<string, unknown>[] = [];
  for (const { key, q } of queuesToSearch) {
    const qJobs = await q.getJobs(statuses, 0, opts.limit - 1);
    for (const j of qJobs) {
      const state = await j.getState();
      jobs.push({
        id: j.id, queue: key, name: j.name,
        state: state === 'prioritized' ? 'waiting' : state,
        timestamp: j.timestamp, processedOn: j.processedOn, finishedOn: j.finishedOn,
      });
      if (jobs.length >= opts.limit) break;
    }
    if (jobs.length >= opts.limit) break;
  }
  return jobs;
}

export async function handleSubmitJob(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const toolName = normalizeToolName(input.toolName as string ?? '');
  const payload = (input.payload as Record<string, unknown>) ?? {};
  if (!toolName) return JSON.stringify({ error: 'Missing required field: toolName' });

  if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
    log('warn', `Job tool "${toolName}" blocked — not in allowed set`, { channelId: ctx.channelId });
    return JSON.stringify({ error: `Tool "${toolName}" is not available to this agent.` });
  }

  const payloadError = validateJobPayload(toolName, payload);
  if (payloadError) return JSON.stringify({ error: payloadError });

  if (toolName === 'execute_skill') {
    const skillId = payload.skillId as string;
    const skillConfig = getConfigRef().skills.find(s => s.id === skillId);
    if (skillConfig && !skillConfig.enabled) {
      return JSON.stringify({ error: `Skill "${skillId}" is disabled. Enable it in the dashboard first.` });
    }
    if (ctx.allowedSkillIds !== undefined && !ctx.allowedSkillIds.includes(skillId)) {
      return JSON.stringify({ error: `Skill "${skillId}" is not available to this agent.` });
    }
  }

  if (toolName === 'delegate_agent') {
    const agentId = payload.agentId as string;
    const agentConfig = getConfigRef().orchestrator.agents.find(a => a.id === agentId);
    if (agentConfig && !agentConfig.enabled) {
      return JSON.stringify({ error: `Agent "${agentId}" is disabled. Enable it in the dashboard first.` });
    }
  }

  log('info', 'Tool call', { tool: toolName, payload, channelId: ctx.channelId });
  const { dispatchTool, redactSecrets } = await getToolImpl();
  try {
    const result = await dispatchTool(toolName, payload, ctx);
    try {
      const parsed = JSON.parse(result);
      if (parsed.error) {
        log('warn', `Tool "${toolName}" returned error`, { error: parsed.error, payload });
      }
    } catch { /* not JSON, that's fine */ }
    return result;
  } catch (err) {
    const safeError = await redactSecrets(String(err));
    log('error', `Tool "${toolName}" threw`, { error: safeError, payload });
    return JSON.stringify({ error: `Tool "${toolName}" failed: ${safeError}` });
  }
}

export async function handleSubmitParallelJobs(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const jobs = input.jobs as Array<{ toolName: string; payload?: Record<string, unknown> }>;
  if (!Array.isArray(jobs) || jobs.length === 0) return JSON.stringify({ error: 'Missing or empty: jobs' });

  log('debug', 'submit_parallel_jobs', { count: jobs.length, channelId: ctx.channelId });
  const results = await Promise.all(
    jobs.map(async (j, i) => {
      const toolName = normalizeToolName(j.toolName ?? '');
      if (!toolName) return { index: i, toolName: j.toolName, error: 'Missing toolName' };
      const payloadError = validateJobPayload(toolName, j.payload ?? {});
      if (payloadError) return { index: i, toolName, error: payloadError };
      try {
        const { dispatchTool } = await getToolImpl();
        const result = await dispatchTool(toolName, j.payload ?? {}, ctx);
        return { index: i, toolName, result };
      } catch (err) {
        return { index: i, toolName, error: String(err) };
      }
    })
  );
  return JSON.stringify({ results });
}

export async function handleStopJob(input: Record<string, unknown>): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });

  log('debug', 'stop_job', { jobId });

  const { getJobStatus } = await import('@scalyclaw/shared/queue/queue.js');
  const info = await getJobStatus(jobId);
  if (info.state === 'not_found') {
    return JSON.stringify({ error: `Job "${jobId}" not found`, jobId });
  }

  if (info.state === 'completed' || info.state === 'failed') {
    return JSON.stringify({ stopped: false, jobId, reason: `Job already in terminal state: ${info.state}` });
  }

  await requestJobCancel(jobId);
  log('info', 'Job stop requested', { jobId, previousState: info.state });
  return JSON.stringify({ stopped: true, jobId, previousState: info.state });
}

export async function handleDeleteJob(input: Record<string, unknown>): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });

  log('debug', 'delete_job', { jobId });

  const cancelled = await cancelScheduledJobAdmin(jobId);
  if (cancelled) {
    return JSON.stringify({ deleted: true, jobId, details: 'Scheduled job cancelled and removed' });
  }

  const deletedState = await deleteScheduledJob(jobId);
  if (deletedState) {
    return JSON.stringify({ deleted: true, jobId, details: 'Non-active scheduled job state removed' });
  }

  const removed = await removeRepeatableJob(jobId);
  if (removed) {
    return JSON.stringify({ deleted: true, jobId, details: 'BullMQ job removed' });
  }

  return JSON.stringify({ deleted: false, jobId, error: 'Job not found in any queue or scheduled state' });
}
