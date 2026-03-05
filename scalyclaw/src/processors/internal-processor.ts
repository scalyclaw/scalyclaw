import type { Job } from 'bullmq';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { extractMemories } from '../memory/extractor.js';
import { startTypingLoop, stopTypingLoop } from '../channels/manager.js';
import { isScheduledJobActive, markScheduledCompleted, markScheduledFailed, updateScheduledNextRun } from '../scheduler/scheduler.js';
import { runSignalScan, runDeepEvaluation } from '../proactive/engine.js';
import type {
  ReminderData, RecurrentReminderData, TaskData, RecurrentTaskData,
  MemoryExtractionData, ProactiveCheckData, ProactiveEvalData, VaultKeyRotationData,
} from '@scalyclaw/shared/queue/jobs.js';
import { runConsolidation } from '../memory/consolidation.js';
import { EXTRACT_BUF_KEY, EXTRACT_TIMER_KEY, PRIORITY_BACKGROUND } from '../const/constants.js';

import { randomUUID } from 'node:crypto';
import { TASK_LOCK_TTL_S, TASK_LOCK_HEARTBEAT_MS } from '../const/constants.js';

// ─── Global lock for scheduled tasks (with heartbeat) ───

const TASK_LOCK_KEY = 'scalyclaw:lock:scheduled-task';

const RELEASE_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const EXTEND_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
`;

interface TaskLockHandle {
  value: string;
  heartbeat: ReturnType<typeof setInterval>;
  release: () => Promise<void>;
}

async function acquireTaskLock(): Promise<TaskLockHandle | null> {
  const redis = getRedis();
  const value = randomUUID();
  const result = await redis.set(TASK_LOCK_KEY, value, 'EX', TASK_LOCK_TTL_S, 'NX');
  if (result !== 'OK') return null;

  // Heartbeat: extend TTL periodically so long-running tasks don't lose the lock
  const heartbeat = setInterval(async () => {
    try {
      await redis.eval(EXTEND_LOCK_LUA, 1, TASK_LOCK_KEY, value, TASK_LOCK_TTL_S);
    } catch (err) {
      log('warn', 'Task lock heartbeat failed', { error: String(err) });
    }
  }, TASK_LOCK_HEARTBEAT_MS);

  return {
    value,
    heartbeat,
    release: async () => {
      clearInterval(heartbeat);
      try {
        await redis.eval(RELEASE_LOCK_LUA, 1, TASK_LOCK_KEY, value);
      } catch (err) {
        log('warn', 'Task lock release failed', { error: String(err) });
      }
    },
  };
}

// ─── Internal queue job dispatcher ───

export async function processInternalJob(job: Job): Promise<void> {
  log('info', `Processing internal job: ${job.name}`, { jobId: job.id, queue: job.queueName });

  switch (job.name) {
    case 'memory-extraction':
      await processMemoryExtraction(job as Job<MemoryExtractionData>);
      break;
    case 'vault-key-rotation':
      await processVaultKeyRotation();
      break;
    case 'reminder':
      await processReminder(job as Job<ReminderData>);
      break;
    case 'recurrent-reminder':
      await processRecurrentReminder(job as Job<RecurrentReminderData>);
      break;
    case 'task':
      await processTask(job as Job<TaskData>);
      break;
    case 'recurrent-task':
      await processRecurrentTask(job as Job<RecurrentTaskData>);
      break;
    case 'proactive-check':
      await processProactiveCheck(job as Job<ProactiveCheckData>);
      break;
    case 'proactive-eval':
      await processProactiveEval(job as Job<ProactiveEvalData>);
      break;
    case 'memory-consolidation':
      await processMemoryConsolidation();
      break;
    default:
      log('warn', `Unknown internal job type: ${job.name}`, { jobId: job.id });
  }
}

// ─── Memory extraction (drains Redis buffer + job data) ───

const DRAIN_EXTRACT_LUA = `
local items = redis.call('lrange', KEYS[1], 0, -1)
if #items > 0 then redis.call('del', KEYS[1]) end
redis.call('del', KEYS[2])
return items
`;

async function processMemoryExtraction(job: Job<MemoryExtractionData>): Promise<void> {
  const { channelId, texts: jobTexts } = job.data;
  const redis = getRedis();

  // Atomically drain buffered texts and clear timer
  const buffered = await redis.eval(DRAIN_EXTRACT_LUA, 2, EXTRACT_BUF_KEY, EXTRACT_TIMER_KEY) as string[];
  const allTexts = [...(buffered ?? []), ...jobTexts];

  if (allTexts.length === 0) {
    log('debug', 'Memory extraction job — no texts to process', { jobId: job.id });
    return;
  }

  log('debug', 'Processing memory extraction job', { jobId: job.id, channelId, buffered: buffered?.length ?? 0, jobTexts: jobTexts.length });

  try {
    await extractMemories(allTexts, channelId);
  } catch (err) {
    log('warn', 'Memory extraction job failed', { jobId: job.id, error: String(err) });
    throw err;
  }
}

// ─── Vault Key Rotation ───

async function processVaultKeyRotation(): Promise<void> {
  const { rotateAllSecrets } = await import('../core/vault.js');
  await rotateAllSecrets();
}

// ─── Reminder (direct delivery — no double-hop) ───

async function processReminder(job: Job<ReminderData>): Promise<void> {
  const { channelId, message, scheduledJobId } = job.data;

  log('info', 'Firing reminder', { jobId: job.id, channelId, message, scheduledJobId });

  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Reminder no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    const text = `Reminder: ${message}`;
    const targetChannel = channelId || 'system';

    storeMessage(targetChannel, 'assistant', text, { source: 'reminder', scheduledJobId });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'complete',
      result: text,
    });

    await markScheduledCompleted(scheduledJobId);
    log('info', 'Reminder delivered', { channelId: targetChannel, scheduledJobId });
  } catch (err) {
    log('error', 'Reminder fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}

// ─── Recurrent Reminder (direct delivery — no double-hop) ───

async function processRecurrentReminder(job: Job<RecurrentReminderData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Processing recurrent reminder', { jobId: job.id, channelId, task, scheduledJobId });

  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Recurrent reminder no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    await updateScheduledNextRun(scheduledJobId, new Date().toISOString());

    const targetChannel = channelId || 'system';

    storeMessage(targetChannel, 'assistant', task, { source: 'recurrent-reminder', scheduledJobId });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'complete',
      result: task,
    });

    log('info', 'Recurrent reminder delivered', { channelId: targetChannel, scheduledJobId });
  } catch (err) {
    log('error', 'Recurrent reminder fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}

// ─── Task (direct orchestrator execution — no double-hop) ───

async function processTask(job: Job<TaskData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Firing task', { jobId: job.id, channelId, task, scheduledJobId });

  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Task no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  const targetChannel = channelId || 'system';
  startTypingLoop(targetChannel);

  try {
    const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

    const taggedTask = `[Scheduled Task] ${task}`;
    storeMessage(targetChannel, 'user', taggedTask, { source: 'task', scheduledJobId });

    const result = await runOrchestrator({
      channelId: targetChannel,
      text: taggedTask,
      sendToChannel: async () => {},
      isolatedMessages: [{ role: 'user', content: taggedTask }],
    });

    if (result.length > 0) {
      storeMessage(targetChannel, 'assistant', result, { source: 'task', scheduledJobId });
      await publishProgress(getRedis(), targetChannel, {
        jobId: job.id!,
        type: 'complete',
        result,
      });

      await enqueueJob({
        name: 'memory-extraction',
        data: { channelId: targetChannel, texts: [task, result] },
        opts: { priority: PRIORITY_BACKGROUND, attempts: 1 },
      });
    }

    await markScheduledCompleted(scheduledJobId);
    log('info', 'Task completed', { channelId: targetChannel, scheduledJobId });
  } catch (err) {
    log('error', 'Task execution failed', { scheduledJobId, error: String(err) });
    const errorMsg = `Task failed: ${String(err)}`;
    storeMessage(targetChannel, 'assistant', errorMsg, { source: 'task', error: true });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'error',
      error: errorMsg,
    });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  } finally {
    stopTypingLoop(targetChannel);
  }
}

// ─── Recurrent Task (direct orchestrator execution — no double-hop) ───

async function processRecurrentTask(job: Job<RecurrentTaskData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Processing recurrent task', { jobId: job.id, channelId, task, scheduledJobId });

  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Recurrent task no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  const lock = await acquireTaskLock();
  if (!lock) {
    log('info', 'Recurrent task skipped — another scheduled task is running', { jobId: job.id, scheduledJobId });
    return;
  }

  const targetChannel = channelId || 'system';
  startTypingLoop(targetChannel);

  try {
    await updateScheduledNextRun(scheduledJobId, new Date().toISOString());

    const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

    const taggedTask = `[Scheduled Task] ${task}`;
    storeMessage(targetChannel, 'user', taggedTask, { source: 'recurrent-task', scheduledJobId });

    const result = await runOrchestrator({
      channelId: targetChannel,
      text: taggedTask,
      sendToChannel: async () => {},
      isolatedMessages: [{ role: 'user', content: taggedTask }],
    });

    if (result.length > 0) {
      storeMessage(targetChannel, 'assistant', result, { source: 'recurrent-task', scheduledJobId });
      await publishProgress(getRedis(), targetChannel, {
        jobId: job.id!,
        type: 'complete',
        result,
      });

      await enqueueJob({
        name: 'memory-extraction',
        data: { channelId: targetChannel, texts: [task, result] },
        opts: { priority: PRIORITY_BACKGROUND, attempts: 1 },
      });
    }

    log('info', 'Recurrent task completed', { channelId: targetChannel, scheduledJobId });
  } catch (err) {
    log('error', 'Recurrent task execution failed', { scheduledJobId, error: String(err) });
    const errorMsg = `Task failed: ${String(err)}`;
    storeMessage(targetChannel, 'assistant', errorMsg, { source: 'recurrent-task', error: true });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'error',
      error: errorMsg,
    });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  } finally {
    await lock.release();
    stopTypingLoop(targetChannel);
  }
}

// ─── Proactive Check (signal scan — no LLM) ───

async function processProactiveCheck(job: Job<ProactiveCheckData>): Promise<void> {
  log('debug', 'Running proactive signal scan', { jobId: job.id });
  await runSignalScan();
  log('debug', 'Proactive signal scan done', { jobId: job.id });
}

// ─── Proactive Eval (deep evaluation — uses LLM) ───

async function processProactiveEval(job: Job<ProactiveEvalData>): Promise<void> {
  log('debug', 'Running proactive deep evaluation', { jobId: job.id });

  const result = await runDeepEvaluation(job.data.signals as any);
  if (result) {
    const redis = getRedis();
    await publishProgress(redis, result.channelId, {
      jobId: job.id!,
      type: 'complete',
      result: result.message,
    });
  }

  log('debug', 'Proactive deep evaluation done', { jobId: job.id, sent: result ? 1 : 0 });
}

// ─── Memory Consolidation ───

async function processMemoryConsolidation(): Promise<void> {
  log('info', 'Running scheduled memory consolidation');
  try {
    const result = await runConsolidation();
    log('info', 'Scheduled memory consolidation complete', {
      consolidated: result.consolidated,
      clusters: result.clusters,
      newMemories: result.newMemoryIds.length,
    });
  } catch (err) {
    log('error', 'Scheduled memory consolidation failed', { error: String(err) });
    throw err;
  }
}

// ─── Consolidation Schedule ───

export async function registerConsolidationSchedule(): Promise<void> {
  try {
    const { getConfigRef } = await import('../core/config.js');
    const config = getConfigRef();
    const memConfig = config.memory as Record<string, unknown>;
    const consolConfig = (memConfig.consolidation as Record<string, unknown> | undefined) ?? {};
    const enabled = (consolConfig.enabled as boolean | undefined) ?? true;
    const schedule = (consolConfig.schedule as string | undefined) ?? '0 3 * * *';

    if (!enabled) {
      log('info', 'Memory consolidation schedule disabled');
      return;
    }

    await enqueueJob({
      name: 'memory-consolidation' as any,
      data: { trigger: 'scheduled' } as any,
      opts: {
        repeat: { pattern: schedule },
        jobId: 'memory-consolidation-schedule',
        priority: PRIORITY_BACKGROUND,
        attempts: 1,
      },
    });

    log('info', 'Memory consolidation schedule registered', { schedule });
  } catch (err) {
    log('warn', 'Failed to register consolidation schedule', { error: String(err) });
  }
}
