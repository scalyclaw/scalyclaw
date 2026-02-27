import { Worker } from 'bullmq';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getQueueName, closeQueue } from '@scalyclaw/shared/queue/queue.js';
import { createRedisClient } from '@scalyclaw/shared/core/redis.js';
import { registerProcess, deregisterProcess, processId } from '@scalyclaw/shared/core/registry.js';
import { bootstrapWorker } from './bootstrap.js';
import { processToolJob, setWorkerConfig } from './tool-processor.js';
import { subscribeToSkillInvalidation } from './skill-cache.js';
import { initWorkerServer, listenWorkerServer, closeWorkerServer } from './server.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname } from 'node:os';

async function main(): Promise<void> {
  // ── Minimal bootstrap — Redis + workspace + queues + logger (no scalyclaw.json, no shared bootstrap) ──
  const { redis, config, redisConfig } = await bootstrapWorker();

  // ── Pass node connection info + worker identity to tool processor ──
  const advertiseHost = config.gateway.host === '0.0.0.0' ? hostname() : config.gateway.host;
  const workerProcId = processId('worker', advertiseHost, config.gateway.port);
  setWorkerConfig(config.node.url, config.node.token, workerProcId);

  // ── Skill reload subscription ──
  const reloadSubscriber = createRedisClient(redisConfig);
  await reloadSubscriber.connect();
  subscribeToSkillInvalidation(reloadSubscriber);

  // ── Single BullMQ Worker — tools queue only ──
  const concurrency = process.env.SCALYCLAW_WORKER_CONCURRENCY
    ? parseInt(process.env.SCALYCLAW_WORKER_CONCURRENCY, 10)
    : config.concurrency;

  log('info', `Starting worker process (tool concurrency: ${concurrency})...`);

  const toolsWorker = new Worker(getQueueName('tools'), processToolJob, {
    connection: redis.duplicate() as never,
    lockDuration: 120_000,
    stalledInterval: 30_000,
    concurrency,
  });

  toolsWorker.on('completed', (job) => {
    log('info', `Job completed: ${job.name}`, { jobId: job.id, queue: toolsWorker.name });
  });
  toolsWorker.on('failed', (job, err) => {
    log('error', `Job failed: ${job?.name}`, { jobId: job?.id, queue: toolsWorker.name, error: String(err) });
  });

  log('info', `Worker ready (consuming 1 queue: tools)`);

  // ── Fastify server ──
  const server = await initWorkerServer(config);
  await listenWorkerServer(server, config.gateway.host, config.gateway.port);
  log('info', `Worker API listening on ${config.gateway.host}:${config.gateway.port}`);

  // ── Register process — host:port identity ──
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    version = pkg.version;
  } catch { /* fallback */ }

  await registerProcess(redis, {
    id: workerProcId,
    type: 'worker',
    host: advertiseHost,
    port: config.gateway.port,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    version,
    concurrency,
    authToken: config.gateway.authToken,
  });

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      log('warn', 'Forced exit (second signal)');
      process.exit(1);
    }
    shuttingDown = true;
    log('info', 'Worker shutting down...');

    const forceTimer = setTimeout(() => {
      log('error', 'Worker shutdown timed out after 8s, forcing exit');
      process.exit(1);
    }, 8_000);
    forceTimer.unref();

    try {
      await closeWorkerServer(server);
      await deregisterProcess(redis);
      reloadSubscriber.disconnect();
      await toolsWorker.close();
      await closeQueue();
    } catch (err) {
      log('error', 'Error during worker shutdown', { error: String(err) });
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
