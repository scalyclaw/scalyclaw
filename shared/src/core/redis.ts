import { Redis } from 'ioredis';
import { log } from './logger.js';

let client: Redis | null = null;
let subscriber: Redis | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password: string | null;
  tls: boolean;
}

function attachErrorHandlers(redis: Redis, label: string): void {
  redis.on('error', (err) => {
    log('error', `Redis ${label} error`, { error: String(err) });
  });
  redis.on('close', () => {
    log('warn', `Redis ${label} connection closed`);
  });
  redis.on('reconnecting', () => {
    log('info', `Redis ${label} reconnecting...`);
  });
}

export function createRedisClient(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password ?? undefined,
    tls: config.tls ? {} : undefined,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

export async function initRedis(config: RedisConfig): Promise<Redis> {
  console.log(`[redis] Connecting to ${config.host}:${config.port} tls=${config.tls}`);
  client = createRedisClient(config);
  attachErrorHandlers(client, 'main');
  await client.connect();
  console.log(`[redis] Connected`);
  return client;
}

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized — call initRedis first');
  return client;
}

export async function getSubscriber(config: RedisConfig): Promise<Redis> {
  if (!subscriber) {
    subscriber = createRedisClient(config);
    attachErrorHandlers(subscriber, 'subscriber');
    await subscriber.connect();
  }
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
  if (client) {
    client.disconnect();
    client = null;
  }
}
