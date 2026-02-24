import type { Redis } from 'ioredis';
import { getRedis } from './redis.js';
import { log } from './logger.js';

export function createReloadChannel(channel: string) {
  return {
    async publish(): Promise<void> {
      const redis = getRedis();
      await redis.publish(channel, 'reload');
      log('info', `Published reload notification on ${channel}`);
    },

    subscribe(subscriber: Redis, handler: () => void | Promise<void>): void {
      subscriber.subscribe(channel).catch((err) => {
        log('error', `Failed to subscribe to ${channel}`, { error: String(err) });
      });
      subscriber.on('message', (ch) => {
        if (ch === channel) {
          Promise.resolve(handler()).catch((err) => {
            log('error', `Reload handler failed for ${channel}`, { error: String(err) });
          });
        }
      });
    },
  };
}
