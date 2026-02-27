import type { Job } from 'bullmq';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMessage } from '../core/db.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { runOrchestrator, type StopReason } from '../orchestrator/orchestrator.js';
import { runMessageGuard } from '../guards/guard.js';
import type { MessageProcessingData, CommandData, PendingMessage, AttachmentData } from '@scalyclaw/shared/queue/jobs.js';
import { withSession, heartbeat, getSessionState } from '../session/session.js';
import { recordChannelActivity } from '../scheduler/proactive.js';
import { startTypingLoop, stopTypingLoop } from '../channels/manager.js';
import { randomUUID } from 'node:crypto';

export const PENDING_KEY_PREFIX = 'scalyclaw:pending:';

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

// ─── Pending queue helpers ───

function makePendingMessage(text: string, type: PendingMessage['type'], attachments?: AttachmentData[]): string {
  const msg: PendingMessage = {
    id: randomUUID(),
    text,
    attachments,
    type,
    priority: type === 'cancel' ? 0 : type === 'command' ? 1 : 2,
    enqueuedAt: new Date().toISOString(),
  };
  return JSON.stringify(msg);
}

function parsePendingMessages(raw: string[]): PendingMessage[] {
  return raw
    .map(r => {
      try {
        const parsed = JSON.parse(r);
        if (!parsed.id) {
          return { id: randomUUID(), text: parsed.text, type: 'message', priority: 2, enqueuedAt: new Date().toISOString() } as PendingMessage;
        }
        return parsed as PendingMessage;
      } catch (err) {
        log('warn', 'Failed to parse pending message, dropping', { raw: r.slice(0, 200), error: String(err) });
        return null;
      }
    })
    .filter((m): m is PendingMessage => m !== null)
    .sort((a, b) => a.priority - b.priority);
}

// ─── Message processor ───

async function processMessageJob(job: Job<MessageProcessingData>): Promise<void> {
  const { channelId, text, attachments } = job.data;
  const redis = getRedis();
  const pendingKey = `${PENDING_KEY_PREFIX}${channelId}`;

  let fullText = text;
  if (attachments && attachments.length > 0) {
    const attachmentLines = attachments.map(
      a => `[Attachment: ${a.type} — ${a.fileName} at ${a.filePath}${a.mimeType ? ` (${a.mimeType})` : ''}]`
    ).join('\n');
    fullText = fullText ? `${fullText}\n\n${attachmentLines}` : attachmentLines;
  }

  log('info', 'Processing message job', { jobId: job.id, channelId, textLength: fullText.length, attachments: attachments?.length ?? 0 });

  await withSession(
    channelId,
    async (sessionId: string) => {
      // Record channel activity for proactive engagement
      await recordChannelActivity(channelId).catch(() => {});
      startTypingLoop(channelId);
      try {
        await processMessageWithSession(channelId, fullText, sessionId, pendingKey, job.id!);
      } finally {
        stopTypingLoop(channelId);
      }
    },
    async () => {
      await redis.rpush(pendingKey, makePendingMessage(fullText, 'message', attachments));
      log('info', 'Channel busy — message queued to pending list', { channelId, jobId: job.id });
    },
  );
}

async function processMessageWithSession(
  channelId: string,
  text: string,
  sessionId: string,
  pendingKey: string,
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

  // Check cancel between guard and orchestrator start
  const postGuardState = await getSessionState(channelId);
  if (postGuardState === 'CANCELLING') return;

  storeMessage(channelId, 'user', text);

  const ac = new AbortController();
  let pendingTexts: string[] | null = null;

  while (true) {
    log('info', 'Running orchestrator', { channelId, textLength: text.length });
    const startTime = Date.now();

    try {
      const response = await runOrchestrator({
        channelId,
        text,
        sendToChannel,
        signal: ac.signal,
        onRoundComplete: async () => {
          await heartbeat(channelId, sessionId, 'PROCESSING');
        },
        shouldStop: async (): Promise<StopReason> => {
          const state = await getSessionState(channelId);
          if (state === 'CANCELLING') {
            ac.abort();
            return 'cancelled';
          }
          return 'continue';
        },
      });

      const durationMs = Date.now() - startTime;
      log('info', 'Orchestrator response ready', { channelId, durationMs, responseLength: response.length });

      await heartbeat(channelId, sessionId, 'RESPONDING');

      if (response.length > 0) {
        storeMessage(channelId, 'assistant', response);

        const extractionTexts = pendingTexts ?? [text];
        pendingTexts = null;
        await enqueueJob({
          name: 'memory-extraction',
          data: { channelId, texts: extractionTexts },
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
      break;
    }

    await heartbeat(channelId, sessionId, 'DRAINING');

    const rawPending = await drainPendingList(redis, pendingKey);
    if (rawPending.length === 0) break;

    const pendingMessages = parsePendingMessages(rawPending);

    // Separate messages before and after cancel to preserve post-cancel intent
    const cancelIdx = pendingMessages.findIndex(m => m.type === 'cancel');
    if (cancelIdx !== -1) {
      const postCancel = pendingMessages.filter((m, i) => i > cancelIdx && m.type !== 'cancel');
      if (postCancel.length > 0) {
        await redis.rpush(pendingKey, ...postCancel.map(m => JSON.stringify(m)));
      }
      storeMessage(channelId, 'assistant', 'Got it, stopped.', { cancelled: true });
      await publishProgress(redis, channelId, {
        jobId,
        type: 'complete',
        result: 'Got it, stopped.',
      });
      break;
    }

    // Run guard checks in parallel
    const guardResults = await Promise.all(
      pendingMessages.map(msg =>
        runMessageGuard(msg.text).then(result => ({ msg, result }))
      )
    );

    // Re-check cancel after guards (covers latency gap)
    const drainState = await getSessionState(channelId);
    if (drainState === 'CANCELLING') {
      const passedMsgs = guardResults.filter(g => g.result.passed).map(g => g.msg);
      if (passedMsgs.length > 0) {
        await redis.rpush(pendingKey, ...passedMsgs.map(m => JSON.stringify(m)));
      }
      storeMessage(channelId, 'assistant', 'Got it, stopped.', { cancelled: true });
      await publishProgress(redis, channelId, { jobId, type: 'complete', result: 'Got it, stopped.' });
      break;
    }

    const allowedMessages: PendingMessage[] = [];
    for (const { msg, result: pendingGuard } of guardResults) {
      if (pendingGuard.passed) {
        storeMessage(channelId, 'user', msg.text);
        allowedMessages.push(msg);
      } else {
        storeMessage(channelId, 'user', msg.text, { blocked: true, reason: pendingGuard.reason });
        await publishProgress(redis, channelId, {
          jobId,
          type: 'progress',
          message: `I had to skip one of your messages. ${pendingGuard.reason}`,
        });
      }
    }

    if (allowedMessages.length === 0) break;

    await heartbeat(channelId, sessionId, 'PROCESSING');

    log('info', 'Draining pending messages', { channelId, pendingCount: allowedMessages.length, blockedCount: pendingMessages.length - allowedMessages.length });
    pendingTexts = allowedMessages.map(m => m.text);
    text = pendingTexts.join('\n\n');
  }
}

// ─── Shared helpers ───

async function drainPendingList(redis: import('ioredis').Redis, pendingKey: string): Promise<string[]> {
  return await redis.eval(
    `local msgs = redis.call('lrange', KEYS[1], 0, -1)
     if #msgs > 0 then redis.call('del', KEYS[1]) end
     return msgs`,
    1,
    pendingKey,
  ) as string[];
}

// ─── Command processor ───

async function processCommandJob(job: Job<CommandData>): Promise<void> {
  const { channelId, text } = job.data;
  const redis = getRedis();
  const pendingKey = `${PENDING_KEY_PREFIX}${channelId}`;

  log('info', 'Processing command job', { jobId: job.id, channelId, text });

  await withSession(
    channelId,
    async (sessionId: string) => {
      const sendToChannel = async (chId: string, msg: string): Promise<void> => {
        await publishProgress(redis, chId, {
          jobId: job.id!,
          type: 'progress',
          message: msg,
        });
      };

      startTypingLoop(channelId);
      try {

      // Run message guard before storing (same as message-processing)
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

      // Check cancel between guard and orchestrator start
      const postGuardState = await getSessionState(channelId);
      if (postGuardState === 'CANCELLING') return;

      storeMessage(channelId, 'user', text);

      const ac = new AbortController();
      let currentText = text;

      while (true) {
        const response = await runOrchestrator({
          channelId,
          text: currentText,
          sendToChannel,
          signal: ac.signal,
          onRoundComplete: async () => {
            await heartbeat(channelId, sessionId, 'PROCESSING');
          },
          shouldStop: async (): Promise<StopReason> => {
            const state = await getSessionState(channelId);
            if (state === 'CANCELLING') {
              ac.abort();
              return 'cancelled';
            }
            return 'continue';
          },
        });

        await heartbeat(channelId, sessionId, 'RESPONDING');

        if (response.length > 0) {
          storeMessage(channelId, 'assistant', response);

          await enqueueJob({
            name: 'memory-extraction',
            data: { channelId, texts: [currentText] },
            opts: { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
          });
        }

        await publishProgress(redis, channelId, {
          jobId: job.id!,
          type: 'complete',
          result: response,
        });

        // Drain pending
        await heartbeat(channelId, sessionId, 'DRAINING');
        const rawPending = await drainPendingList(redis, pendingKey);
        if (rawPending.length === 0) break;

        const pendingMessages = parsePendingMessages(rawPending);

        // Separate messages before and after cancel to preserve post-cancel intent
        const cancelIdx = pendingMessages.findIndex(m => m.type === 'cancel');
        if (cancelIdx !== -1) {
          const postCancel = pendingMessages.filter((m, i) => i > cancelIdx && m.type !== 'cancel');
          if (postCancel.length > 0) {
            await redis.rpush(pendingKey, ...postCancel.map(m => JSON.stringify(m)));
          }
          storeMessage(channelId, 'assistant', 'Got it, stopped.', { cancelled: true });
          await publishProgress(redis, channelId, { jobId: job.id!, type: 'complete', result: 'Got it, stopped.' });
          break;
        }

        // Run guard checks in parallel
        const guardResults = await Promise.all(
          pendingMessages.map(msg =>
            runMessageGuard(msg.text).then(result => ({ msg, result }))
          )
        );

        // Re-check cancel after guards (covers latency gap)
        const drainState = await getSessionState(channelId);
        if (drainState === 'CANCELLING') {
          const passedMsgs = guardResults.filter(g => g.result.passed).map(g => g.msg);
          if (passedMsgs.length > 0) {
            await redis.rpush(pendingKey, ...passedMsgs.map(m => JSON.stringify(m)));
          }
          storeMessage(channelId, 'assistant', 'Got it, stopped.', { cancelled: true });
          await publishProgress(redis, channelId, { jobId: job.id!, type: 'complete', result: 'Got it, stopped.' });
          break;
        }

        const allowedMessages: PendingMessage[] = [];
        for (const { msg, result: pendingGuard } of guardResults) {
          if (pendingGuard.passed) {
            storeMessage(channelId, 'user', msg.text);
            allowedMessages.push(msg);
          } else {
            storeMessage(channelId, 'user', msg.text, { blocked: true, reason: pendingGuard.reason });
          }
        }

        if (allowedMessages.length === 0) break;

        await heartbeat(channelId, sessionId, 'PROCESSING');
        currentText = allowedMessages.map(m => m.text).join('\n\n');
      }

      } finally {
        stopTypingLoop(channelId);
      }
    },
    async () => {
      await redis.rpush(pendingKey, makePendingMessage(text, 'command'));
      log('info', 'Channel busy — command queued to pending', { channelId, jobId: job.id });
    },
  );
}
