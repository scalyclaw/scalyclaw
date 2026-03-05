import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';
import { publishCancelSignal } from './cancel-signal.js';
import { CANCEL_KEY_PREFIX, CANCEL_TTL_S } from '../const/constants.js';

// ─── Cancel Signal ───

/** Request cancellation of a job — sets cancel key + publishes instant signal */
export async function requestJobCancel(jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${CANCEL_KEY_PREFIX}${jobId}`, '1', 'EX', CANCEL_TTL_S);
  await publishCancelSignal([jobId]);
  log('info', 'Job cancel requested', { jobId });
}

/** Check if a job has been cancelled */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const redis = getRedis();
  return (await redis.exists(`${CANCEL_KEY_PREFIX}${jobId}`)) === 1;
}
