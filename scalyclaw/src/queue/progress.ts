import type { Redis } from 'ioredis';
import { log } from '@scalyclaw/shared/core/logger.js';
import { RESPONSE_KEY_PREFIX, RESPONSE_TTL_S, PROGRESS_CHANNEL_PREFIX, PROGRESS_CHANNEL_PATTERN, PROGRESS_BUFFER_KEY_PREFIX } from '../const/constants.js';

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


export async function publishProgress(
  redis: Redis,
  channelId: string,
  event: ProgressEvent
): Promise<void> {
  const channel = `${PROGRESS_CHANNEL_PREFIX}${channelId}`;
  const payload = JSON.stringify(event);
  const receivers = await redis.publish(channel, payload);
  log('debug', 'Progress published', { channel, type: event.type, jobId: event.jobId, receivers });

  // Persist complete/error responses for reconnect delivery
  if (event.type === 'complete' || event.type === 'error') {
    const responseKey = `${RESPONSE_KEY_PREFIX}${channelId}:${event.jobId}`;

    if (receivers === 0) {
      // No subscribers — persist + buffer in a single pipeline
      const bufferKey = `${PROGRESS_BUFFER_KEY_PREFIX}${channelId}`;
      const pipeline = redis.pipeline();
      pipeline.set(responseKey, payload, 'EX', RESPONSE_TTL_S);
      pipeline.rpush(bufferKey, payload);
      pipeline.expire(bufferKey, RESPONSE_TTL_S);
      await pipeline.exec();
      log('debug', 'Progress event buffered (no subscribers)', { channel, type: event.type });
    } else {
      await redis.set(responseKey, payload, 'EX', RESPONSE_TTL_S);
    }
  }
}

export async function subscribeToProgress(
  subscriber: Redis,
  handler: (channelId: string, event: ProgressEvent) => void
): Promise<void> {
  await subscriber.psubscribe(PROGRESS_CHANNEL_PATTERN);

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const channelId = channel.slice(PROGRESS_CHANNEL_PREFIX.length);
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
