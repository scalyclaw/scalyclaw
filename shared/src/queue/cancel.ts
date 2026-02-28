import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';
import { publishCancelSignal } from './cancel-signal.js';
import { CANCEL_KEY_PREFIX, CHANNEL_JOBS_KEY_PREFIX, CANCEL_TTL_S } from '../const/constants.js';

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

// ─── Channel → Jobs Tracking ───

/** Track a job as belonging to a channel (for /stop) */
export async function trackChannelJob(channelId: string, jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.sadd(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`, jobId);
  await redis.expire(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`, CANCEL_TTL_S);
}

/** Remove a job from a channel's tracked jobs */
export async function untrackChannelJob(channelId: string, jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.srem(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`, jobId);
}

/** Cancel all active jobs for a channel */
export async function cancelAllChannelJobs(channelId: string): Promise<number> {
  const redis = getRedis();
  const jobIds = await redis.smembers(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`);
  let count = 0;
  for (const jobId of jobIds) {
    await requestJobCancel(jobId);
    count++;
  }
  if (jobIds.length > 0) {
    await redis.del(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`);
  }
  return count;
}
