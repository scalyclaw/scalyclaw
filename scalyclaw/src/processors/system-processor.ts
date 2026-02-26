import type { Job } from 'bullmq';
import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '../queue/queue.js';
import { withSession, heartbeat } from '../session/session.js';
import { extractMemories } from '../memory/extractor.js';
import { startTypingLoop, stopTypingLoop } from '../channels/manager.js';
import type { MemoryExtractionData, ScheduledFireData, ProactiveFireData } from '../queue/jobs.js';

// ─── System queue job dispatcher ───

export async function processSystemQueueJob(job: Job): Promise<void> {
  log('info', `Processing system queue job: ${job.name}`, { jobId: job.id, queue: job.queueName });

  switch (job.name) {
    case 'memory-extraction':
      await processMemoryExtraction(job as Job<MemoryExtractionData>);
      break;
    case 'scheduled-fire':
      await processScheduledFire(job as Job<ScheduledFireData>);
      break;
    case 'proactive-fire':
      await processProactiveFire(job as Job<ProactiveFireData>);
      break;
    default:
      log('warn', `Unknown system queue job type: ${job.name}`, { jobId: job.id });
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

// ─── Scheduled Fire (from schedule-worker via system queue) ───

async function processScheduledFire(job: Job<ScheduledFireData>): Promise<void> {
  const { channelId, type, message, task, scheduledJobId } = job.data;
  const redis = getRedis();
  const targetChannel = channelId || 'system';

  log('info', 'Processing scheduled-fire', { jobId: job.id, channelId: targetChannel, type, scheduledJobId });

  // Tasks — full orchestrator LLM loop, no intermediate progress
  if (type === 'task' || type === 'recurrent-task') {
    await withSession(
      targetChannel,
      async (sessionId: string) => {
        startTypingLoop(targetChannel);
        try {
          const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

          const taskText = task ?? message;
          storeMessage(targetChannel, 'user', taskText, { source: type, scheduledJobId });

          // No-op sendToChannel suppresses intermediate progress
          const noopSend = async () => {};

          const result = await runOrchestrator({
            channelId: targetChannel,
            text: taskText,
            sendToChannel: noopSend,
            onRoundComplete: async () => {
              await heartbeat(targetChannel, sessionId, 'PROCESSING');
            },
          });

          storeMessage(targetChannel, 'assistant', result, { source: type, scheduledJobId });
          await publishProgress(redis, targetChannel, {
            jobId: job.id!,
            type: 'complete',
            result,
          });

          // Trigger memory extraction for the task conversation
          await enqueueJob({
            name: 'memory-extraction',
            data: {
              channelId: targetChannel,
              texts: [taskText, result],
            },
            opts: { attempts: 1 },
          });
        } catch (err) {
          log('error', 'Scheduled-fire task execution failed', { scheduledJobId, error: String(err) });
          const errorMsg = `Task failed: ${String(err)}`;
          storeMessage(targetChannel, 'assistant', errorMsg, { source: type, error: true });
          await publishProgress(redis, targetChannel, {
            jobId: job.id!,
            type: 'error',
            error: errorMsg,
          });
        } finally {
          stopTypingLoop(targetChannel);
        }
      },
      async () => {
        if (type === 'task') {
          // One-shot task — throw so BullMQ retries
          throw new Error('Channel busy — task will retry');
        }
        // Recurrent task — skip this occurrence
        log('info', 'Channel busy — skipping recurrent task', { channelId: targetChannel, scheduledJobId });
      },
    );
  } else {
    // Simple text delivery: reminder, recurrent-reminder
    await withSession(
      targetChannel,
      async () => {
        storeMessage(targetChannel, 'assistant', message, { source: type, scheduledJobId });
        await publishProgress(redis, targetChannel, {
          jobId: job.id!,
          type: 'complete',
          result: message,
        });
        log('info', 'Scheduled-fire delivered', { channelId: targetChannel, type, scheduledJobId });
      },
      async () => {
        // Channel is busy — push as pending so it gets delivered after the current conversation
        const pendingKey = `scalyclaw:pending:${targetChannel}`;
        const pending = JSON.stringify({
          id: job.id,
          text: message,
          type: 'message' as const,
          priority: 2,
          enqueuedAt: new Date().toISOString(),
          source: type,
          scheduledJobId,
        });
        await redis.rpush(pendingKey, pending);
        log('info', 'Scheduled-fire queued to pending — channel busy', { channelId: targetChannel, scheduledJobId });
      },
    );
  }
}

// ─── Proactive Fire (from proactive-worker via system queue) ───

async function processProactiveFire(job: Job<ProactiveFireData>): Promise<void> {
  const { channelId, message, triggerType } = job.data;
  const redis = getRedis();

  log('info', 'Processing proactive-fire', { jobId: job.id, channelId, triggerType });

  await withSession(
    channelId,
    async (_sessionId: string) => {
      storeMessage(channelId, 'assistant', message, {
        source: 'proactive',
        triggerType,
      });
      await publishProgress(redis, channelId, {
        jobId: job.id!,
        type: 'complete',
        result: message,
      });
      log('info', 'Proactive message sent', { channelId, triggerType });
    },
    async () => {
      log('info', 'Proactive message skipped — channel busy', { channelId });
    },
  );
}
