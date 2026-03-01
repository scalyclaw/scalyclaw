import { setBasePath, PATHS } from '@scalyclaw/shared/core/paths.js';
import { loadWorkerSetupConfig, type WorkerSetupConfig } from './config.js';
import { initRedis, getRedis, createRedisClient, type RedisConfig } from '@scalyclaw/shared/core/redis.js';
import { initQueue, type QueueConfig } from '@scalyclaw/shared/queue/queue.js';
import { initLogger, initLogFile, log } from '@scalyclaw/shared/core/logger.js';
import {
  LOCK_DURATION_MS, STALLED_INTERVAL_MS,
  QUEUE_LIMITER_MAX, QUEUE_LIMITER_DURATION_MS,
  JOB_COMPLETE_AGE_S, JOB_COMPLETE_COUNT, JOB_FAIL_AGE_S,
} from '@scalyclaw/shared/const/constants.js';
import { WORKER_LOG_FILE } from './const/constants.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Redis } from 'ioredis';

// ─── Default queue config (worker doesn't load full config from Redis) ───

const QUEUE_DEFAULTS: QueueConfig = {
  lockDuration: LOCK_DURATION_MS,
  stalledInterval: STALLED_INTERVAL_MS,
  limiter: { max: QUEUE_LIMITER_MAX, duration: QUEUE_LIMITER_DURATION_MS },
  removeOnComplete: { age: JOB_COMPLETE_AGE_S, count: JOB_COMPLETE_COUNT },
  removeOnFail: { age: JOB_FAIL_AGE_S },
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
  initLogger({ level: ['all'], format: 'text' });
  initLogFile(PATHS.logs, WORKER_LOG_FILE);
  log('info', 'Worker bootstrap complete', { homeDir: config.homeDir });

  return { redis, config, redisConfig };
}
