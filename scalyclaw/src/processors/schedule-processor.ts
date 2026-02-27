import type { Job } from 'bullmq';
import { log } from '@scalyclaw/shared/core/logger.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { isScheduledJobActive, markScheduledCompleted, markScheduledFailed, updateScheduledNextRun } from '../scheduler/scheduler.js';
import type { ReminderData, RecurrentReminderData, TaskData, RecurrentTaskData } from '@scalyclaw/shared/queue/jobs.js';

// ─── Schedule job processor (scalyclaw-scheduler queue) ───

export async function processScheduleJob(job: Job): Promise<void> {
  log('info', `Processing schedule job: ${job.name}`, { jobId: job.id });

  switch (job.name) {
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
    default:
      log('warn', `Unknown schedule job type: ${job.name}`, { jobId: job.id });
  }
}

// ─── Reminder ───

async function processReminder(job: Job<ReminderData>): Promise<void> {
  const { channelId, message, scheduledJobId } = job.data;

  log('info', 'Firing reminder', { jobId: job.id, channelId, message, scheduledJobId });

  // Check if still active
  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Reminder no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    // Enqueue scheduled-fire on system queue for assistant to deliver
    await enqueueJob({
      name: 'scheduled-fire',
      data: {
        channelId,
        type: 'reminder' as const,
        message: `Reminder: ${message}`,
        scheduledJobId,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    // Mark completed AFTER enqueue so retries work if enqueue fails
    await markScheduledCompleted(scheduledJobId);

    log('info', 'Reminder fired → scheduled-fire enqueued', { channelId, scheduledJobId });
  } catch (err) {
    log('error', 'Reminder fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}

// ─── Recurrent Reminder ───

async function processRecurrentReminder(job: Job<RecurrentReminderData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Processing recurrent reminder', { jobId: job.id, channelId, task, scheduledJobId });

  // Check if still active
  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Recurrent reminder no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    // Update next_run timestamp
    await updateScheduledNextRun(scheduledJobId, new Date().toISOString());

    // Enqueue scheduled-fire on system queue for text delivery
    await enqueueJob({
      name: 'scheduled-fire',
      data: {
        channelId,
        type: 'recurrent-reminder' as const,
        message: task,
        task,
        scheduledJobId,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    log('info', 'Recurrent reminder fired → scheduled-fire enqueued', { channelId, scheduledJobId });
  } catch (err) {
    log('error', 'Recurrent reminder fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}

// ─── Task (one-shot orchestrator) ───

async function processTask(job: Job<TaskData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Firing task', { jobId: job.id, channelId, task, scheduledJobId });

  // Check if still active
  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Task no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    // Enqueue scheduled-fire on system queue for orchestrator execution
    await enqueueJob({
      name: 'scheduled-fire',
      data: {
        channelId,
        type: 'task' as const,
        message: task,
        task,
        scheduledJobId,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    // Mark completed AFTER enqueue so retries work if enqueue fails
    await markScheduledCompleted(scheduledJobId);

    log('info', 'Task fired → scheduled-fire enqueued', { channelId, scheduledJobId });
  } catch (err) {
    log('error', 'Task fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}

// ─── Recurrent Task ───

async function processRecurrentTask(job: Job<RecurrentTaskData>): Promise<void> {
  const { channelId, task, scheduledJobId } = job.data;

  log('info', 'Processing recurrent task', { jobId: job.id, channelId, task, scheduledJobId });

  // Check if still active
  const active = await isScheduledJobActive(scheduledJobId);
  if (!active) {
    log('info', 'Recurrent task no longer active, skipping', { jobId: job.id, scheduledJobId });
    return;
  }

  try {
    // Update next_run timestamp
    await updateScheduledNextRun(scheduledJobId, new Date().toISOString());

    // Enqueue scheduled-fire on system queue for orchestrator execution
    await enqueueJob({
      name: 'scheduled-fire',
      data: {
        channelId,
        type: 'recurrent-task' as const,
        message: task,
        task,
        scheduledJobId,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    log('info', 'Recurrent task fired → scheduled-fire enqueued', { channelId, scheduledJobId });
  } catch (err) {
    log('error', 'Recurrent task fire failed', { jobId: job.id, scheduledJobId, error: String(err) });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsStarted >= maxAttempts) {
      await markScheduledFailed(scheduledJobId);
    }
    throw err;
  }
}
