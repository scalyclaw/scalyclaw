import { log } from '@scalyclaw/shared/core/logger.js';
import { sendToChannel, sendFileToChannel } from '../channels/manager.js';
import { resolveFilePath } from '../core/workspace.js';
import { PROGRESS_BUFFER_KEY_PREFIX } from '../const/constants.js';
import type { ProgressEvent } from './progress.js';
import type { Redis } from 'ioredis';

/**
 * Deliver a single progress event to its target channel.
 * Shared by both the real-time pub/sub callback and the buffered drain.
 */
export async function deliverProgressEvent(channelId: string, event: ProgressEvent): Promise<void> {
  if (event.type === 'complete' && event.filePath) {
    const localPath = resolveFilePath(event.filePath);
    await sendFileToChannel(channelId, localPath, event.caption);
  } else if (event.type === 'complete' && event.result) {
    await sendToChannel(channelId, event.result);
  } else if (event.type === 'progress' && event.message) {
    await sendToChannel(channelId, event.message);
  } else if (event.type === 'error' && event.error) {
    log('error', 'Worker job error received', { jobId: event.jobId, error: event.error });
    await sendToChannel(channelId, event.error);
  }
}

/**
 * Drain buffered progress events from Redis lists and deliver them.
 * Events are popped one at a time — only removed after successful delivery.
 */
export async function drainProgressBuffers(redis: Redis): Promise<void> {
  const keys = await redis.keys(`${PROGRESS_BUFFER_KEY_PREFIX}*`);
  for (const key of keys) {
    const channelId = key.slice(PROGRESS_BUFFER_KEY_PREFIX.length);
    let raw: string | null;
    while ((raw = await redis.lpop(key)) !== null) {
      try {
        const event = JSON.parse(raw) as ProgressEvent;
        await deliverProgressEvent(channelId, event);
      } catch (err) {
        log('warn', 'Failed to process buffered progress event', { channelId, error: String(err) });
      }
    }
  }
  if (keys.length > 0) {
    log('info', 'Drained progress buffers', { keyCount: keys.length });
  }
}
