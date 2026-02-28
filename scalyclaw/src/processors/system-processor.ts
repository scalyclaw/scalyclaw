import type { Job } from 'bullmq';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { extractMemories } from '../memory/extractor.js';
import { startAllTypingLoops, stopAllTypingLoops } from '../channels/manager.js';
import type { MemoryExtractionData, ScheduledFireData, ProactiveFireData, VaultKeyRotationData } from '@scalyclaw/shared/queue/jobs.js';

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
    case 'vault-key-rotation':
      await processVaultKeyRotation();
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

  // Tasks — full orchestrator LLM loop
  if (type === 'task' || type === 'recurrent-task') {
    startAllTypingLoops();
    try {
      const { runOrchestrator } = await import('../orchestrator/orchestrator.js');

      const taskText = task ?? message;
      storeMessage(targetChannel, 'user', taskText, { source: type, scheduledJobId });

      const noopSend = async () => {};

      const result = await runOrchestrator({
        channelId: targetChannel,
        text: taskText,
        sendToChannel: noopSend,
      });

      storeMessage(targetChannel, 'assistant', result, { source: type, scheduledJobId });
      await publishProgress(redis, targetChannel, {
        jobId: job.id!,
        type: 'complete',
        result,
      });

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
      stopAllTypingLoops();
    }
  } else {
    // Simple text delivery: reminder, recurrent-reminder
    storeMessage(targetChannel, 'assistant', message, { source: type, scheduledJobId });
    await publishProgress(redis, targetChannel, {
      jobId: job.id!,
      type: 'complete',
      result: message,
    });
    log('info', 'Scheduled-fire delivered', { channelId: targetChannel, type, scheduledJobId });
  }
}

// ─── Vault Key Rotation ───

async function processVaultKeyRotation(): Promise<void> {
  const { rotateAllSecrets } = await import('../core/vault.js');
  await rotateAllSecrets();
}

// ─── Proactive Fire (from proactive-worker via system queue) ───

async function processProactiveFire(job: Job<ProactiveFireData>): Promise<void> {
  const { channelId, message } = job.data;
  const redis = getRedis();

  log('info', 'Processing proactive-fire', { jobId: job.id, channelId });

  storeMessage(channelId, 'assistant', message, {
    source: 'proactive',
  });
  await publishProgress(redis, channelId, {
    jobId: job.id!,
    type: 'complete',
    result: message,
  });
  log('info', 'Proactive message sent', { channelId });
}
