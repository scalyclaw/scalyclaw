import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';

const CANCEL_PREFIX = 'scalyclaw:cancel:';
const PID_PREFIX = 'scalyclaw:pid:';
const CHANNEL_JOBS_PREFIX = 'scalyclaw:jobs:';
const TTL_SECONDS = 600; // 10 min

// ─── Cancel Signal ───

/** Request cancellation of a job — sets cancel key + kills registered PID */
export async function requestJobCancel(jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${CANCEL_PREFIX}${jobId}`, '1', 'EX', TTL_SECONDS);

  // Kill registered PID if any
  const pidStr = await redis.get(`${PID_PREFIX}${jobId}`);
  if (pidStr) {
    const pid = Number(pidStr);
    try {
      process.kill(pid, 'SIGTERM');
      // SIGKILL after 3s if still alive
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 3000).unref();
    } catch {
      // Process already dead
    }
  }

  log('info', 'Job cancel requested', { jobId, pid: pidStr });
}

/** Check if a job has been cancelled */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const redis = getRedis();
  return (await redis.exists(`${CANCEL_PREFIX}${jobId}`)) === 1;
}

// ─── PID Tracking ───

/** Register the PID handling a job (for kill on cancel) */
export async function registerJobProcess(jobId: string, pid: number): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PID_PREFIX}${jobId}`, String(pid), 'EX', TTL_SECONDS);
}

/** Unregister the PID after job completes */
export async function unregisterJobProcess(jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${PID_PREFIX}${jobId}`);
}

// ─── Channel → Jobs Tracking ───

/** Track a job as belonging to a channel (for /cancel all) */
export async function trackChannelJob(channelId: string, jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.sadd(`${CHANNEL_JOBS_PREFIX}${channelId}`, jobId);
  await redis.expire(`${CHANNEL_JOBS_PREFIX}${channelId}`, TTL_SECONDS);
}

/** Remove a job from a channel's tracked jobs */
export async function untrackChannelJob(channelId: string, jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.srem(`${CHANNEL_JOBS_PREFIX}${channelId}`, jobId);
}

/** Cancel all active jobs for a channel */
export async function cancelAllChannelJobs(channelId: string): Promise<number> {
  const redis = getRedis();
  const jobIds = await redis.smembers(`${CHANNEL_JOBS_PREFIX}${channelId}`);
  let count = 0;
  for (const jobId of jobIds) {
    await requestJobCancel(jobId);
    count++;
  }
  if (jobIds.length > 0) {
    await redis.del(`${CHANNEL_JOBS_PREFIX}${channelId}`);
  }
  return count;
}
