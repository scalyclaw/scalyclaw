import type { Job } from 'bullmq';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { runOrchestrator, type StopReason } from '../orchestrator/orchestrator.js';
import { runMessageGuard, runResponseEchoGuard } from '../guards/guard.js';
import type { MessageProcessingData, CommandData, AttachmentData } from '@scalyclaw/shared/queue/jobs.js';
import { recordChannelActivity } from '../scheduler/proactive.js';
import { startAllTypingLoops, stopAllTypingLoops } from '../channels/manager.js';

// ─── Message queue job dispatcher ───

export async function processMessageQueueJob(job: Job): Promise<void> {
  log('info', `Processing message queue job: ${job.name}`, { jobId: job.id, queue: job.queueName });

  switch (job.name) {
    case 'message-processing':
      await processMessageJob(job as Job<MessageProcessingData>);
      break;
    case 'command':
      await processCommandJob(job as Job<CommandData>);
      break;
    default:
      log('warn', `Unknown message queue job type: ${job.name}`, { jobId: job.id });
  }
}

// ─── Message processor ───

async function processMessageJob(job: Job<MessageProcessingData>): Promise<void> {
  const { channelId, text, attachments } = job.data;

  let fullText = text;
  if (attachments && attachments.length > 0) {
    const attachmentLines = attachments.map(
      (a: AttachmentData) => `[Attachment: ${a.type} — ${a.fileName} at ${a.filePath}${a.mimeType ? ` (${a.mimeType})` : ''}]`
    ).join('\n');
    fullText = fullText ? `${fullText}\n\n${attachmentLines}` : attachmentLines;
  }

  log('info', 'Processing message job', { jobId: job.id, channelId, textLength: fullText.length, attachments: attachments?.length ?? 0 });

  await recordChannelActivity(channelId).catch(() => {});
  startAllTypingLoops();
  try {
    await processMessage(channelId, fullText, job.id!);
  } finally {
    stopAllTypingLoops();
  }
}

async function processMessage(
  channelId: string,
  text: string,
  jobId: string,
): Promise<void> {
  const redis = getRedis();

  const sendToChannel = async (chId: string, msg: string): Promise<void> => {
    await publishProgress(redis, chId, {
      jobId,
      type: 'progress',
      message: msg,
    });
  };

  // Run message guard BEFORE storing
  const guardResult = await runMessageGuard(text);
  if (!guardResult.passed) {
    log('warn', 'Message blocked by guard', {
      channelId,
      layer: guardResult.failedLayer,
      reason: guardResult.reason,
      durationMs: guardResult.durationMs,
    });
    storeMessage(channelId, 'user', text, { blocked: true, reason: guardResult.reason });
    const rejection = `I can't process that message. ${guardResult.reason}`;
    storeMessage(channelId, 'assistant', rejection);
    await publishProgress(redis, channelId, {
      jobId,
      type: 'complete',
      result: rejection,
    });
    return;
  }

  // Check cancel flag between guard and orchestrator start
  const cancelled = await redis.get('scalyclaw:cancel');
  if (cancelled) {
    await redis.del('scalyclaw:cancel');
    return;
  }

  storeMessage(channelId, 'user', text);

  const ac = new AbortController();

  log('info', 'Running orchestrator', { channelId, textLength: text.length });
  const startTime = Date.now();

  try {
    const response = await runOrchestrator({
      channelId,
      text,
      sendToChannel,
      signal: ac.signal,
      shouldStop: async (): Promise<StopReason> => {
        const flag = await redis.get('scalyclaw:cancel');
        if (flag) {
          await redis.del('scalyclaw:cancel');
          ac.abort();
          return 'cancelled';
        }
        return 'continue';
      },
    });

    const durationMs = Date.now() - startTime;
    log('info', 'Orchestrator response ready', { channelId, durationMs, responseLength: response.length });

    if (response.length > 0) {
      const responseGuard = await runResponseEchoGuard(response);
      if (!responseGuard.passed) {
        log('warn', 'Response blocked by echo guard', {
          channelId,
          reason: responseGuard.reason,
          durationMs: responseGuard.durationMs,
        });
        const safeResponse = 'My response was flagged by the security guard. Please try rephrasing your request.';
        storeMessage(channelId, 'assistant', safeResponse);
        await publishProgress(redis, channelId, { jobId, type: 'complete', result: safeResponse });
        return;
      }

      storeMessage(channelId, 'assistant', response);

      await enqueueJob({
        name: 'memory-extraction',
        data: { channelId, texts: [text] },
        opts: { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
      });
    }

    await publishProgress(redis, channelId, {
      jobId,
      type: 'complete',
      result: response,
    });
  } catch (err) {
    log('error', 'Message processing failed', { channelId, error: String(err), stack: (err as Error).stack });
    await publishProgress(redis, channelId, {
      jobId,
      type: 'error',
      error: 'Something went wrong on my end. Try again?',
    });
  }
}

// ─── Command processor ───

async function processCommandJob(job: Job<CommandData>): Promise<void> {
  const { channelId, text } = job.data;
  const redis = getRedis();

  log('info', 'Processing command job', { jobId: job.id, channelId, text });

  const sendToChannel = async (chId: string, msg: string): Promise<void> => {
    await publishProgress(redis, chId, {
      jobId: job.id!,
      type: 'progress',
      message: msg,
    });
  };

  startAllTypingLoops();
  try {
    // Run message guard before storing
    const guardResult = await runMessageGuard(text);
    if (!guardResult.passed) {
      log('warn', 'Command blocked by guard', {
        channelId,
        layer: guardResult.failedLayer,
        reason: guardResult.reason,
        durationMs: guardResult.durationMs,
      });
      storeMessage(channelId, 'user', text, { blocked: true, reason: guardResult.reason });
      const rejection = `I can't process that message. ${guardResult.reason}`;
      storeMessage(channelId, 'assistant', rejection);
      await publishProgress(redis, channelId, {
        jobId: job.id!,
        type: 'complete',
        result: rejection,
      });
      return;
    }

    // Check cancel flag
    const cancelled = await redis.get('scalyclaw:cancel');
    if (cancelled) {
      await redis.del('scalyclaw:cancel');
      return;
    }

    storeMessage(channelId, 'user', text);

    const ac = new AbortController();

    const response = await runOrchestrator({
      channelId,
      text,
      sendToChannel,
      signal: ac.signal,
      shouldStop: async (): Promise<StopReason> => {
        const flag = await redis.get('scalyclaw:cancel');
        if (flag) {
          await redis.del('scalyclaw:cancel');
          ac.abort();
          return 'cancelled';
        }
        return 'continue';
      },
    });

    if (response.length > 0) {
      const responseGuard = await runResponseEchoGuard(response);
      if (!responseGuard.passed) {
        log('warn', 'Response blocked by echo guard', {
          channelId,
          reason: responseGuard.reason,
          durationMs: responseGuard.durationMs,
        });
        const safeResponse = 'My response was flagged by the security guard. Please try rephrasing your request.';
        storeMessage(channelId, 'assistant', safeResponse);
        await publishProgress(redis, channelId, { jobId: job.id!, type: 'complete', result: safeResponse });
        return;
      }

      storeMessage(channelId, 'assistant', response);

      await enqueueJob({
        name: 'memory-extraction',
        data: { channelId, texts: [text] },
        opts: { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
      });
    }

    await publishProgress(redis, channelId, {
      jobId: job.id!,
      type: 'complete',
      result: response,
    });
  } catch (err) {
    log('error', 'Command processing failed', { channelId, error: String(err), stack: (err as Error).stack });
    await publishProgress(redis, channelId, {
      jobId: job.id!,
      type: 'error',
      error: 'Something went wrong on my end. Try again?',
    });
  } finally {
    stopAllTypingLoops();
  }
}
