import type { Redis } from 'ioredis';
import { log } from './logger.js';
import { randomUUID } from 'node:crypto';

const CHANNEL_LOCK_PREFIX = 'scalyclaw:lock:channel:';

// Lua script: release only if we own the lock
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

// Lua script: extend only if we own the lock
const EXTEND_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
`;

export interface ChannelLock {
  key: string;
  value: string;
  release: () => Promise<void>;
}

/**
 * Acquire a per-channel lock with polling. Returns lock handle or null if timed out.
 */
export async function acquireChannelLock(
  redis: Redis,
  channelId: string,
  ttlSeconds: number,
  waitTimeoutMs: number,
): Promise<ChannelLock | null> {
  const key = `${CHANNEL_LOCK_PREFIX}${channelId}`;
  const value = randomUUID();
  const deadline = Date.now() + waitTimeoutMs;
  const pollMs = 200;

  while (Date.now() < deadline) {
    const result = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      log('debug', 'Channel lock acquired', { channelId });
      return {
        key,
        value,
        release: async () => {
          await redis.eval(RELEASE_LUA, 1, key, value);
          log('debug', 'Channel lock released', { channelId });
        },
      };
    }
    await new Promise(r => setTimeout(r, pollMs));
  }

  log('warn', 'Channel lock acquisition timed out', { channelId, waitTimeoutMs });
  return null;
}

/**
 * Extend a channel lock's TTL (heartbeat). Returns true if extended.
 */
export async function extendChannelLock(
  redis: Redis,
  lock: ChannelLock,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis.eval(EXTEND_LUA, 1, lock.key, lock.value, ttlSeconds);
  return result === 1;
}
