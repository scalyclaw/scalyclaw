import type { Job } from 'bullmq';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { extractMemories } from '../memory/extractor.js';
import { startAllTypingLoops, stopAllTypingLoops } from '../channels/manager.js';
import { isScheduledJobActive, markScheduledCompleted, markScheduledFailed, updateScheduledNextRun } from '../scheduler/scheduler.js';
import { processProactiveEngagement } from '../scheduler/proactive.js';
import type {
  ReminderData, RecurrentReminderData, TaskData, RecurrentTaskData,
  MemoryExtractionData, ProactiveCheckData, VaultKeyRotationData,
} from '@scalyclaw/shared/queue/jobs.js';

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
    default:
      log('warn', `Unknown internal job type: ${job.name}`, { jobId: job.id });
  }
}

// ─── Memory extraction ───

async function processMemoryExtraction(job: Job<MemoryExtractionData>): Promise<void> {
  const { channelId, texts } = job.data;
  log('debug', 'Processing memory extraction job', { jobId: job.id, channelId, textCount: texts.length });

  try {
    await extractMemories(texts, channelId);
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
  startAllTypingLoops();

  try {
    const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

    storeMessage(targetChannel, 'user', task, { source: 'task', scheduledJobId });

    const result = await runOrchestrator({
      channelId: targetChannel,
      text: task,
      sendToChannel: async () => {},
    });

    storeMessage(targetChannel, 'assistant', result, { source: 'task', scheduledJobId });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'complete',
      result,
    });

    await enqueueJob({
      name: 'memory-extraction',
      data: { channelId: targetChannel, texts: [task, result] },
      opts: { attempts: 1 },
    });

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
    stopAllTypingLoops();
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

  const targetChannel = channelId || 'system';
  startAllTypingLoops();

  try {
    await updateScheduledNextRun(scheduledJobId, new Date().toISOString());

    const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

    storeMessage(targetChannel, 'user', task, { source: 'recurrent-task', scheduledJobId });

    const result = await runOrchestrator({
      channelId: targetChannel,
      text: task,
      sendToChannel: async () => {},
    });

    storeMessage(targetChannel, 'assistant', result, { source: 'recurrent-task', scheduledJobId });
    await publishProgress(getRedis(), targetChannel, {
      jobId: job.id!,
      type: 'complete',
      result,
    });

    await enqueueJob({
      name: 'memory-extraction',
      data: { channelId: targetChannel, texts: [task, result] },
      opts: { attempts: 1 },
    });

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
    stopAllTypingLoops();
  }
}

// ─── Proactive Check (direct delivery — no double-hop) ───

async function processProactiveCheck(job: Job<ProactiveCheckData>): Promise<void> {
  log('debug', 'Running proactive engagement check', { jobId: job.id });

  const results = await processProactiveEngagement();
  const redis = getRedis();

  for (const result of results) {
    try {
      storeMessage(result.channelId, 'assistant', result.message, { source: 'proactive' });
      await publishProgress(redis, result.channelId, {
        jobId: job.id!,
        type: 'complete',
        result: result.message,
      });
      log('info', 'Proactive message delivered', { channelId: result.channelId });
    } catch (err) {
      log('error', 'Failed to deliver proactive message', {
        channelId: result.channelId,
        error: String(err),
      });
    }
  }

  log('debug', 'Proactive engagement check done', { jobId: job.id, sent: results.length });
}
