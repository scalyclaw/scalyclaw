import type { Redis } from 'ioredis';
import { log } from '../core/logger.js';

export interface ProgressEvent {
  jobId: string;
  type: 'progress' | 'complete' | 'error';
  message?: string;
  percent?: number;
  result?: string;
  error?: string;
  filePath?: string;
  caption?: string;
}

const RESPONSE_KEY_PREFIX = 'scalyclaw:response:';
const RESPONSE_TTL = 300; // 5 min

export async function publishProgress(
  redis: Redis,
  channelId: string,
  event: ProgressEvent
): Promise<void> {
  const channel = `progress:${channelId}`;
  const payload = JSON.stringify(event);
  const receivers = await redis.publish(channel, payload);
  log('debug', 'Progress published', { channel, type: event.type, jobId: event.jobId, receivers });

  // Persist complete/error responses for reconnect delivery
  if (event.type === 'complete' || event.type === 'error') {
    const responseKey = `${RESPONSE_KEY_PREFIX}${channelId}:${event.jobId}`;

    if (receivers === 0) {
      // No subscribers — persist + buffer in a single pipeline
      const bufferKey = `progress-buffer:${channelId}`;
      const pipeline = redis.pipeline();
      pipeline.set(responseKey, payload, 'EX', RESPONSE_TTL);
      pipeline.rpush(bufferKey, payload);
      pipeline.expire(bufferKey, RESPONSE_TTL);
      await pipeline.exec();
      log('debug', 'Progress event buffered (no subscribers)', { channel, type: event.type });
    } else {
      await redis.set(responseKey, payload, 'EX', RESPONSE_TTL);
    }
  }
}

export async function subscribeToProgress(
  subscriber: Redis,
  handler: (channelId: string, event: ProgressEvent) => void
): Promise<void> {
  await subscriber.psubscribe('progress:*');

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const channelId = channel.replace('progress:', '');
    try {
      const event = JSON.parse(message) as ProgressEvent;
      Promise.resolve(handler(channelId, event)).catch((err) => {
        log('error', 'Progress handler failed', { channelId, error: String(err) });
      });
    } catch (err) {
      log('error', 'Failed to parse progress event', { channel, error: String(err) });
    }
  });

  log('info', 'Subscribed to progress:* channels');
}

/** Fetch buffered responses for a channel (for WS reconnect) */
export async function getBufferedResponses(redis: Redis, channelId: string): Promise<ProgressEvent[]> {
  const pattern = `${RESPONSE_KEY_PREFIX}${channelId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const events: ProgressEvent[] = [];
  for (const raw of values) {
    if (raw) {
      try {
        events.push(JSON.parse(raw) as ProgressEvent);
      } catch { /* skip malformed */ }
    }
  }
  return events;
}
