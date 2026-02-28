import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';
import type { Redis } from 'ioredis';

const CANCEL_SIGNAL_CHANNEL = 'scalyclaw:cancel:signal';

// ─── Local abort registry (per-process) ───

const activeAborts = new Map<string, AbortController>();

/** Register an AbortController for a job so pub/sub can abort it instantly. */
export function registerAbort(jobId: string, ac: AbortController): void {
  activeAborts.set(jobId, ac);
}

/** Unregister after job completes. */
export function unregisterAbort(jobId: string): void {
  activeAborts.delete(jobId);
}

// ─── Pub/sub: publish cancel signal ───

/** Publish cancel signal for one or more jobIds — all subscribers abort matching ACs instantly. */
export async function publishCancelSignal(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const redis = getRedis();
  const payload = JSON.stringify(jobIds);
  await redis.publish(CANCEL_SIGNAL_CHANNEL, payload);
  log('info', 'Published cancel signal', { jobIds });
}

// ─── Pub/sub: subscribe to cancel signal ───

/** Subscribe to cancel signals — aborts matching local AbortControllers instantly. */
export function subscribeToCancelSignal(subscriber: Redis): void {
  subscriber.subscribe(CANCEL_SIGNAL_CHANNEL).catch((err) => {
    log('error', `Failed to subscribe to ${CANCEL_SIGNAL_CHANNEL}`, { error: String(err) });
  });
  subscriber.on('message', (channel, message) => {
    if (channel !== CANCEL_SIGNAL_CHANNEL) return;
    try {
      const jobIds = JSON.parse(message) as string[];
      for (const jobId of jobIds) {
        const ac = activeAborts.get(jobId);
        if (ac) {
          ac.abort();
          activeAborts.delete(jobId);
          log('info', 'Aborted job via cancel signal', { jobId });
        }
      }
    } catch (err) {
      log('error', 'Failed to process cancel signal', { error: String(err) });
    }
  });
}
