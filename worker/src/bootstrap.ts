import { setBasePath, PATHS } from '@scalyclaw/shared/core/paths.js';
import { loadWorkerSetupConfig, type WorkerSetupConfig } from './config.js';
import { initRedis, getRedis, createRedisClient, type RedisConfig } from '@scalyclaw/shared/core/redis.js';
import { initQueue, type QueueConfig } from '@scalyclaw/shared/queue/queue.js';
import { initLogger, initLogFile, log } from '@scalyclaw/shared/core/logger.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Redis } from 'ioredis';

// ─── Default queue config (worker doesn't load full config from Redis) ───

const QUEUE_DEFAULTS: QueueConfig = {
  lockDuration: 18_300_000, // 5h + 5min margin
  stalledInterval: 30_000,
  limiter: { max: 10, duration: 1000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800 },
};

export interface WorkerBootstrapResult {
  redis: Redis;
  config: WorkerSetupConfig;
  redisConfig: RedisConfig;
}

/** Minimal worker bootstrap — no scalyclaw.json, no shared bootstrap, no skills/agents/MCP/DB. */
export async function bootstrapWorker(configPath?: string): Promise<WorkerBootstrapResult> {
  // 1. Load worker config (explicit path > env var > default)
  const config = loadWorkerSetupConfig(configPath ?? process.env.SCALYCLAW_WORKER_CONFIG);

  // 2. Set base path to worker's own homeDir
  setBasePath(config.homeDir);

  // 3. Ensure workspace + skills + logs directories
  for (const dir of [PATHS.base, PATHS.workspace, PATHS.skills, PATHS.logs]) {
    mkdirSync(dir, { recursive: true });
  }

  // 4. Init Redis connection
  const redisConfig: RedisConfig = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    tls: config.redis.tls,
  };
  await initRedis(redisConfig);

  // 5. Init queues (only needs Redis connection + queue config defaults)
  const redis = getRedis();
  initQueue(redis, QUEUE_DEFAULTS);

  // 6. Init logger
  initLogger({ level: 'info', format: 'text' });
  initLogFile(PATHS.logs, 'worker.log');
  log('info', 'Worker bootstrap complete', { homeDir: config.homeDir });

  return { redis, config, redisConfig };
}
