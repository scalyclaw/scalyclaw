import type { FastifyInstance } from 'fastify';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { getAllRecentMessages } from '../core/db.js';
import type { ProgressEvent } from '../queue/progress.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PROGRESS_CHANNEL_PATTERN, PROGRESS_CHANNEL_PREFIX, PROGRESS_BUFFER_KEY_PREFIX, CHAT_RESPONSE_TIMEOUT_MS } from '../const/constants.js';

// ─── Shared Redis subscriber for chat API ───

let sharedSub: ReturnType<ReturnType<typeof getRedis>['duplicate']> | null = null;
const waiters = new Map<string, { resolve: (result: ChatResult) => void; timeout: ReturnType<typeof setTimeout> }>();

interface ChatResult {
  text?: string;
  error?: string;
  filePath?: string;
  caption?: string;
}

async function getSharedSubscriber(): Promise<void> {
  if (sharedSub) return;
  const redis = getRedis();
  sharedSub = redis.duplicate();
  await sharedSub.connect();
  await sharedSub.psubscribe(PROGRESS_CHANNEL_PATTERN);
  sharedSub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as ProgressEvent;
      const channelId = channel.slice(PROGRESS_CHANNEL_PREFIX.length);
      // Resolve all waiters for this channel on complete/error
      if (event.type === 'complete' || event.type === 'error') {
        for (const [key, waiter] of waiters) {
          if (key.startsWith(`${channelId}:`)) {
            clearTimeout(waiter.timeout);
            waiters.delete(key);
            if (event.type === 'complete') {
              waiter.resolve({ text: event.result, filePath: event.filePath, caption: event.caption });
            } else {
              waiter.resolve({ error: event.error });
            }
          }
        }
      }
    } catch (err) {
      log('error', 'Chat API shared subscriber: failed to parse progress event', { error: String(err) });
    }
  });
}

export function registerChatRoutes(server: FastifyInstance): void {
  // POST /api/chat — send a message, wait for response via shared Redis subscriber
  server.post<{ Body: { text: string } }>('/api/chat', async (request, reply) => {
    const { text } = request.body ?? {};
    if (!text) return reply.status(400).send({ error: 'text is required' });

    const channelId = 'gateway';

    // Ensure shared subscriber is initialized
    await getSharedSubscriber();

    // Enqueue the message
    const jobId = await enqueueJob({
      name: 'message-processing',
      data: { channelId, text },
      opts: { attempts: 2, backoff: { type: 'fixed', delay: 2000 } },
    });

    // Wait for complete/error event (120s timeout)
    const result = await new Promise<ChatResult>((resolve) => {
      const waiterKey = `${channelId}:${jobId}`;
      const timeout = setTimeout(() => {
        waiters.delete(waiterKey);
        resolve({ error: 'Timeout waiting for response' });
      }, CHAT_RESPONSE_TIMEOUT_MS);

      waiters.set(waiterKey, { resolve, timeout });
    });

    if (result.error) {
      return reply.status(500).send({ error: result.error, jobId });
    }

    return { jobId, response: result.text, filePath: result.filePath, caption: result.caption };
  });

  // GET /api/messages — recent message history (unified across all channels)
  server.get<{ Querystring: { limit?: string } }>('/api/messages', async (request) => {
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const messages = getAllRecentMessages(limit);
    return { messages };
  });

  // DELETE /api/messages — clear message history
  server.delete('/api/messages', async () => {
    const { getDb } = await import('../core/db.js');
    const db = getDb();
    db.prepare('DELETE FROM messages').run();
    return { cleared: true };
  });

  // GET /api/buffered-responses — drain buffered progress events for a channel (used by dashboard on WS reconnect)
  server.get<{ Querystring: { channelId?: string } }>('/api/buffered-responses', async (request) => {
    const channelId = request.query.channelId ?? 'gateway';
    const bufferKey = `${PROGRESS_BUFFER_KEY_PREFIX}${channelId}`;
    const redis = getRedis();

    // Atomically drain the buffer
    const raw = await redis.lrange(bufferKey, 0, -1);
    if (raw.length > 0) {
      await redis.del(bufferKey);
    }

    const events = raw.map(entry => {
      try { return JSON.parse(entry); } catch { return null; }
    }).filter(Boolean);

    return events;
  });
}
