import { Redis } from 'ioredis';

let client: Redis | null = null;
let subscriber: Redis | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password: string | null;
  tls: boolean;
}

/** Bootstrap Redis config from env vars with sensible defaults */
export function bootstrapRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || null,
    tls: process.env.REDIS_TLS === 'true',
  };
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
    await subscriber.connect();
  }
  return subscriber;
}
