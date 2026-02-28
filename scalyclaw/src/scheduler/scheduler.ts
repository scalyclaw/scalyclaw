import { randomUUID } from 'node:crypto';
import { log } from '@scalyclaw/shared/core/logger.js';
import { enqueueJob, removeRepeatableJob } from '@scalyclaw/shared/queue/queue.js';

const SCHEDULED_PREFIX = 'scalyclaw:scheduled:';

// ─── Redis helpers ───

async function getRedis() {
  const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
  return getRedis();
}

async function setScheduledState(jobId: string, fields: Record<string, string>): Promise<void> {
  const redis = await getRedis();
  await redis.hmset(`${SCHEDULED_PREFIX}${jobId}`, fields);
}

async function getScheduledState(jobId: string): Promise<Record<string, string> | null> {
  const redis = await getRedis();
  const data = await redis.hgetall(`${SCHEDULED_PREFIX}${jobId}`);
  if (!data || Object.keys(data).length === 0) return null;
  return data;
}

async function updateScheduledField(jobId: string, field: string, value: string): Promise<void> {
  const redis = await getRedis();
  await redis.hset(`${SCHEDULED_PREFIX}${jobId}`, field, value);
}

const TERMINAL_TTL_SECONDS = 604800; // 7 days

/** Set a 7-day TTL on a scheduled job hash after it reaches a terminal state */
async function expireScheduledJob(jobId: string): Promise<void> {
  const redis = await getRedis();
  await redis.expire(`${SCHEDULED_PREFIX}${jobId}`, TERMINAL_TTL_SECONDS);
}

// ─── Create Reminder ───

export async function createReminder(
  channelId: string,
  message: string,
  delayMs: number,
  context: string
): Promise<string> {
  const jobId = `reminder-${randomUUID()}`;

  const nextRun = new Date(Date.now() + delayMs).toISOString();

  // Track in Redis
  await setScheduledState(jobId, {
    state: 'active',
    type: 'reminder',
    channelId,
    message,
    context,
    nextRun,
    createdAt: new Date().toISOString(),
  });

  try {
    await enqueueJob({
      name: 'reminder',
      data: {
        channelId,
        message,
        originalContext: context,
        scheduledJobId: jobId,
      },
      opts: {
        delay: delayMs,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  } catch (err) {
    // Cleanup Redis state on failure
    const redis = await getRedis();
    await redis.del(`${SCHEDULED_PREFIX}${jobId}`);
    throw err;
  }

  log('info', 'Reminder created', { jobId, channelId, delayMs });
  return jobId;
}

// ─── Create Recurrent Reminder ───

export async function createRecurrentReminder(
  channelId: string,
  task: string,
  options: { cron?: string; intervalMs?: number; timezone?: string }
): Promise<string> {
  const { cron, intervalMs, timezone } = options;

  if (!cron && !intervalMs) {
    throw new Error('Either cron or intervalMs must be provided');
  }

  const jobId = `recurrent-reminder-${randomUUID()}`;

  const repeat: { pattern?: string; every?: number; tz?: string } = {};
  if (cron) {
    repeat.pattern = cron;
    if (timezone) repeat.tz = timezone;
  } else {
    repeat.every = intervalMs!;
  }

  const cronOrInterval = cron ?? `every ${intervalMs}ms`;

  // Track in Redis
  await setScheduledState(jobId, {
    state: 'active',
    type: 'recurrent-reminder',
    channelId,
    task,
    cron: cronOrInterval,
    timezone: timezone ?? '',
    createdAt: new Date().toISOString(),
  });

  try {
    await enqueueJob({
      name: 'recurrent-reminder',
      data: {
        channelId,
        task,
        scheduledJobId: jobId,
      },
      opts: {
        repeat,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  } catch (err) {
    const redis = await getRedis();
    await redis.del(`${SCHEDULED_PREFIX}${jobId}`);
    throw err;
  }

  log('info', 'Recurrent reminder created', { jobId, channelId, cron, intervalMs });
  return jobId;
}

// ─── Create Task ───

export async function createTask(
  channelId: string,
  task: string,
  delayMs: number,
): Promise<string> {
  const jobId = `task-${randomUUID()}`;

  const nextRun = new Date(Date.now() + delayMs).toISOString();

  // Track in Redis
  await setScheduledState(jobId, {
    state: 'active',
    type: 'task',
    channelId,
    task,
    nextRun,
    createdAt: new Date().toISOString(),
  });

  try {
    await enqueueJob({
      name: 'task',
      data: {
        channelId,
        task,
        scheduledJobId: jobId,
      },
      opts: {
        delay: delayMs,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  } catch (err) {
    const redis = await getRedis();
    await redis.del(`${SCHEDULED_PREFIX}${jobId}`);
    throw err;
  }

  log('info', 'Task created', { jobId, channelId, delayMs });
  return jobId;
}

// ─── Create Recurrent Task ───

export async function createRecurrentTask(
  channelId: string,
  task: string,
  options: { cron?: string; intervalMs?: number; timezone?: string }
): Promise<string> {
  const { cron, intervalMs, timezone } = options;

  if (!cron && !intervalMs) {
    throw new Error('Either cron or intervalMs must be provided');
  }

  const jobId = `recurrent-task-${randomUUID()}`;

  const repeat: { pattern?: string; every?: number; tz?: string } = {};
  if (cron) {
    repeat.pattern = cron;
    if (timezone) repeat.tz = timezone;
  } else {
    repeat.every = intervalMs!;
  }

  const cronOrInterval = cron ?? `every ${intervalMs}ms`;

  // Track in Redis
  await setScheduledState(jobId, {
    state: 'active',
    type: 'recurrent-task',
    channelId,
    task,
    cron: cronOrInterval,
    timezone: timezone ?? '',
    createdAt: new Date().toISOString(),
  });

  try {
    await enqueueJob({
      name: 'recurrent-task',
      data: {
        channelId,
        task,
        scheduledJobId: jobId,
      },
      opts: {
        repeat,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  } catch (err) {
    const redis = await getRedis();
    await redis.del(`${SCHEDULED_PREFIX}${jobId}`);
    throw err;
  }

  log('info', 'Recurrent task created', { jobId, channelId, cron, intervalMs });
  return jobId;
}

// ─── List Scheduled Jobs ───

export async function listAllScheduledJobs(): Promise<Array<{
  id: string;
  type: string;
  description: string;
  channel: string;
  cron: string | null;
  next_run: string | null;
  state: string;
  created_at: string | null;
}>> {
  const redis = await getRedis();
  const keys = await redis.keys(`${SCHEDULED_PREFIX}*`);
  const results: Array<{
    id: string; type: string; description: string; channel: string;
    cron: string | null; next_run: string | null; state: string; created_at: string | null;
  }> = [];

  for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data || !data.state) continue;
    const jobId = key.slice(SCHEDULED_PREFIX.length);
    results.push({
      id: jobId,
      type: data.type ?? 'unknown',
      description: data.message ?? data.task ?? '',
      channel: data.channelId ?? '',
      cron: data.cron || null,
      next_run: data.nextRun || null,
      state: data.state,
      created_at: data.createdAt || null,
    });
  }

  return results.sort((a, b) => (b.next_run ?? '').localeCompare(a.next_run ?? ''));
}

export async function listReminders(channelId: string): Promise<Array<{
  id: string;
  type: string;
  description: string;
  cron: string | null;
  next_run: string | null;
  state: string;
}>> {
  const all = await listAllScheduledJobs();
  return all
    .filter(j => j.channel === channelId && j.state === 'active' && (j.type === 'reminder' || j.type === 'recurrent-reminder'))
    .map(({ channel: _, ...rest }) => rest);
}

export async function listTasks(channelId: string): Promise<Array<{
  id: string;
  type: string;
  description: string;
  cron: string | null;
  next_run: string | null;
  state: string;
}>> {
  const all = await listAllScheduledJobs();
  return all
    .filter(j => j.channel === channelId && j.state === 'active' && (j.type === 'task' || j.type === 'recurrent-task'))
    .map(({ channel: _, ...rest }) => rest);
}

// ─── Complete Scheduled Job (admin — stop it and mark completed) ───

export async function completeScheduledJobAdmin(jobId: string): Promise<boolean> {
  const data = await getScheduledState(jobId);
  if (!data || data.state !== 'active') return false;
  await updateScheduledField(jobId, 'state', 'completed');
  await expireScheduledJob(jobId);
  await removeRepeatableJob(jobId, 'scheduler');
  log('info', 'Scheduled job completed (admin)', { jobId });
  return true;
}

// ─── Delete Scheduled Job (permanently remove non-active) ───

export async function deleteScheduledJob(jobId: string): Promise<boolean> {
  const data = await getScheduledState(jobId);
  if (!data) return false;
  if (data.state === 'active') return false;
  const redis = await getRedis();
  await redis.del(`${SCHEDULED_PREFIX}${jobId}`);
  log('info', 'Scheduled job deleted', { jobId });
  return true;
}

// ─── Cancel Scheduled Job (admin — no channel check) ───

export async function cancelScheduledJobAdmin(jobId: string): Promise<boolean> {
  const data = await getScheduledState(jobId);
  if (!data) return false;

  await updateScheduledField(jobId, 'state', 'cancelled');
  await expireScheduledJob(jobId);

  // Both reminders and recurring are now on the scheduler queue
  await removeRepeatableJob(jobId, 'scheduler');

  log('info', 'Scheduled job cancelled (admin)', { jobId });
  return true;
}

// ─── Cancel Scheduled Job (channel-scoped) ───

export async function cancelScheduledJob(jobId: string, channelId: string): Promise<boolean> {
  const data = await getScheduledState(jobId);
  if (!data || data.channelId !== channelId) return false;

  await updateScheduledField(jobId, 'state', 'cancelled');
  await expireScheduledJob(jobId);

  // Both reminders and recurring are now on the scheduler queue
  await removeRepeatableJob(jobId, 'scheduler');

  log('info', 'Scheduled job cancelled', { jobId, channelId });
  return true;
}

// ─── Type-validated cancel (LLM-facing) ───

const REMINDER_TYPES = new Set(['reminder', 'recurrent-reminder']);
const TASK_TYPES = new Set(['task', 'recurrent-task']);

export async function cancelReminder(jobId: string, channelId: string): Promise<{ cancelled: boolean; error?: string }> {
  const data = await getScheduledState(jobId);
  if (!data || data.channelId !== channelId) return { cancelled: false, error: 'Reminder not found' };
  if (!REMINDER_TYPES.has(data.type)) return { cancelled: false, error: `Job "${jobId}" is a ${data.type}, not a reminder. Use cancel_task instead.` };

  await updateScheduledField(jobId, 'state', 'cancelled');
  await expireScheduledJob(jobId);
  await removeRepeatableJob(jobId, 'scheduler');
  log('info', 'Reminder cancelled', { jobId, channelId, type: data.type });
  return { cancelled: true };
}

export async function cancelTask(jobId: string, channelId: string): Promise<{ cancelled: boolean; error?: string }> {
  const data = await getScheduledState(jobId);
  if (!data || data.channelId !== channelId) return { cancelled: false, error: 'Task not found' };
  if (!TASK_TYPES.has(data.type)) return { cancelled: false, error: `Job "${jobId}" is a ${data.type}, not a task. Use cancel_reminder instead.` };

  await updateScheduledField(jobId, 'state', 'cancelled');
  await expireScheduledJob(jobId);
  await removeRepeatableJob(jobId, 'scheduler');
  log('info', 'Task cancelled', { jobId, channelId, type: data.type });
  return { cancelled: true };
}

// ─── State Accessors (for workers) ───

/** Check if a scheduled job is active (used by schedule-worker) */
export async function isScheduledJobActive(jobId: string): Promise<boolean> {
  const data = await getScheduledState(jobId);
  return data?.state === 'active';
}

/** Mark a scheduled job as completed (used by schedule-worker for reminders) */
export async function markScheduledCompleted(jobId: string): Promise<void> {
  await updateScheduledField(jobId, 'state', 'completed');
  await expireScheduledJob(jobId);
}

/** Mark a scheduled job as failed */
export async function markScheduledFailed(jobId: string): Promise<void> {
  await updateScheduledField(jobId, 'state', 'failed');
  await expireScheduledJob(jobId);
}

/** Update next_run for a recurring job */
export async function updateScheduledNextRun(jobId: string, nextRun: string): Promise<void> {
  await updateScheduledField(jobId, 'nextRun', nextRun);
}

// ─── Proactive Check Registration ───

export async function registerProactiveCheck(): Promise<void> {
  const { getConfigRef } = await import('../core/config.js');
  const config = getConfigRef();
  const proactive = config.proactive;

  // Always remove the old repeatable first to clear stale cron patterns
  await removeRepeatableJob('proactive-check', 'proactive');

  if (!proactive.enabled) {
    log('info', 'Proactive check disabled — cron removed');
    return;
  }

  await enqueueJob({
    name: 'proactive-check',
    data: { type: 'idle-engagement' },
    opts: {
      repeat: { pattern: proactive.cronPattern },
      jobId: 'proactive-check',
    },
  });

  log('info', 'Proactive check cron registered', { pattern: proactive.cronPattern });
}
