import { Redis } from 'ioredis';

let client: Redis | null = null;
let subscriber: Redis | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password: string | null;
  tls: boolean;
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
