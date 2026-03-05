import { Worker } from 'bullmq';
import { PATHS } from './core/paths.js';
import { getRedis, getSubscriber, closeRedis } from '@scalyclaw/shared/core/redis.js';
import { log, initLogFile } from '@scalyclaw/shared/core/logger.js';
import { bootstrap } from './core/bootstrap.js';
import { closeQueue, getQueueName } from '@scalyclaw/shared/queue/queue.js';
import { processMessageQueueJob } from './processors/message-processor.js';
import { processInternalJob } from './processors/internal-processor.js';
import { processAgentJob } from './processors/agent-processor.js';
import { subscribeToProgress, publishProgress } from './queue/progress.js';
import { deliverProgressEvent, drainProgressBuffers } from './queue/progress-delivery.js';
import { initGateway, listenGateway, closeGateway } from './gateway/server.js';
import { registerAdapter, connectAll, disconnectAll, reloadChannels, sendToChannel } from './channels/manager.js';
import { GatewayChannel } from './channels/gateway.js';
import { buildChannelAdapters } from './channels/registry.js';
import type { NormalizedMessage } from './channels/adapter.js';
import type { FastifyInstance } from 'fastify';
import { registerProactiveCheck } from './scheduler/scheduler.js';
import { registerConsolidationSchedule } from './processors/internal-processor.js';
import { registerProcess, deregisterProcess, processId } from '@scalyclaw/shared/core/registry.js';
import { disconnectAll as disconnectMcpServers } from './mcp/mcp-manager.js';
import type { ScalyClawConfig } from './core/config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { handleIncomingMessage, registerVaultKeyRotation } from './commands/message-handler.js';
import {
  UPDATE_NOTIFY_KEY,
  PROGRESS_DRAIN_INTERVAL_MS, STARTUP_NOTIFY_DELAY_MS, SHUTDOWN_TIMEOUT_MS,
  MEMORY_CLEANUP_INTERVAL_MS,
} from './const/constants.js';

// ── Global error handlers — prevent silent crashes ──
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { error: String(reason), stack: (reason as Error)?.stack });
});
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception — shutting down', { error: String(err), stack: err.stack });
  process.exit(1);
});

async function main(): Promise<void> {
  await startSystem();
}

async function startSystem(): Promise<void> {
  let gatewayServer: FastifyInstance | null = null;

  // ── Full bootstrap (Redis, config, DB, embeddings, skills, agents, providers) ──
  const { resolvedConfig, redis, redisConfig, reloadSubscriber } = await bootstrap({
    syncMind: true,
    onConfigReload: async (freshConfig, channelsChanged) => {
      if (channelsChanged && gatewayServer) {
        log('info', 'Reloading channel adapters after config change');
        const adapters = buildChannelAdapters(freshConfig.channels, gatewayServer);
        await reloadChannels(adapters);
      }
      try { await registerProactiveCheck(); } catch (err) {
        log('warn', 'Failed to re-register proactive check after config reload', { error: String(err) });
      }
      try { await registerVaultKeyRotation(); } catch (err) {
        log('warn', 'Failed to re-register vault key rotation after config reload', { error: String(err) });
      }
      try { await registerConsolidationSchedule(); } catch (err) {
        log('warn', 'Failed to re-register consolidation schedule after config reload', { error: String(err) });
      }
    },
  });

  initLogFile(PATHS.logs, 'scalyclaw.log');

  // ── BullMQ Workers ──
  const messageConcurrency = Number(process.env.SCALYCLAW_MESSAGE_CONCURRENCY ?? 3);
  const agentConcurrency = Number(process.env.SCALYCLAW_AGENT_CONCURRENCY ?? 3);
  const workerOpts = {
    connection: redis.duplicate() as never,
    lockDuration: resolvedConfig.queue.lockDuration,
    stalledInterval: resolvedConfig.queue.stalledInterval,
    limiter: resolvedConfig.queue.limiter,
  };

  const workers: Worker[] = [];

  workers.push(new Worker(getQueueName('messages'), processMessageQueueJob, {
    ...workerOpts, concurrency: messageConcurrency,
  }));
  workers.push(new Worker(getQueueName('agents'), processAgentJob, {
    ...workerOpts, concurrency: agentConcurrency,
  }));
  workers.push(new Worker(getQueueName('internal'), processInternalJob, {
    ...workerOpts, concurrency: 3,
  }));

  for (const w of workers) {
    w.on('completed', (job) => {
      log('info', `Job completed: ${job.name}`, { jobId: job.id, queue: w.name });
    });
    w.on('failed', (job, err) => {
      log('error', `Job failed: ${job?.name}`, { jobId: job?.id, queue: w.name, error: String(err) });
      const channelId = job?.data?.channelId;
      if (channelId && (job?.name === 'message-processing' || job?.name === 'command')) {
        publishProgress(redis, channelId, {
          jobId: job.id ?? 'unknown',
          type: 'error',
          error: 'Something went wrong on my end. Try again?',
        }).catch(() => {});
      }
    });
    w.on('error', (err) => {
      log('error', `Worker error: ${w.name}`, { error: String(err) });
    });
  }
  log('info', `Assistant consumers started (messages: ${messageConcurrency}, agent: ${agentConcurrency}, queues: ${workers.length})`);

  // ── Gateway + channels ──
  const server = await initGateway();
  gatewayServer = server;

  initChannelAdapters(resolvedConfig, server);
  await connectAll(async (message: NormalizedMessage) => {
    await handleIncomingMessage(message);
  });

  await listenGateway(resolvedConfig.gateway.host, resolvedConfig.gateway.port);

  if (
    (resolvedConfig.gateway.authType === 'none' || !resolvedConfig.gateway.authValue) &&
    resolvedConfig.gateway.host !== '127.0.0.1'
  ) {
    log('warn', '!!! WARNING: Gateway is listening without authentication on a non-localhost address. Set gateway.authType in config. !!!');
  }

  // ── Progress subscription ──
  const subscriber = await getSubscriber(redisConfig);
  await subscribeToProgress(subscriber, async (channelId, event) => {
    await deliverProgressEvent(channelId, event);
  });

  await drainProgressBuffers(redis);

  // ── Post-startup notification ──
  try {
    const updateNotify = await redis.get(UPDATE_NOTIFY_KEY);
    if (updateNotify) {
      await redis.del(UPDATE_NOTIFY_KEY);
      const { channelId: notifyChannel, reason } = JSON.parse(updateNotify);
      if (notifyChannel) {
        const message = reason === 'restart'
          ? 'Restart complete! I\'m back.'
          : 'Update complete! I\'m back.';
        setTimeout(() => {
          sendToChannel(notifyChannel, message).catch(() => {});
        }, STARTUP_NOTIFY_DELAY_MS);
      }
    }
  } catch (err) {
    log('warn', 'Failed to send post-startup notification', { error: String(err) });
  }

  // ── Scheduled registrations ──
  try { await registerProactiveCheck(); } catch (err) {
    log('warn', 'Failed to register proactive check', { error: String(err) });
  }
  try { await registerVaultKeyRotation(); } catch (err) {
    log('warn', 'Failed to register vault key rotation', { error: String(err) });
  }
  try { await registerConsolidationSchedule(); } catch (err) {
    log('warn', 'Failed to register memory consolidation schedule', { error: String(err) });
  }

  // ── Periodic cleanup ──
  const progressDrainInterval = setInterval(async () => {
    try { await drainProgressBuffers(redis); } catch (err) {
      log('warn', 'Periodic progress drain failed', { error: String(err) });
    }
  }, PROGRESS_DRAIN_INTERVAL_MS);
  progressDrainInterval.unref();

  const memoryCleanupInterval = setInterval(async () => {
    try {
      const { cleanupExpired } = await import('./memory/memory.js');
      const cleaned = cleanupExpired();
      if (cleaned > 0) log('info', 'Scheduled memory TTL cleanup', { cleaned });
    } catch (err) {
      log('warn', 'Memory cleanup failed', { error: String(err) });
    }
    try {
      const { pruneStaleEntities } = await import('./memory/entities.js');
      const pruned = pruneStaleEntities();
      if (pruned > 0) log('info', 'Scheduled entity pruning', { pruned });
    } catch (err) {
      log('warn', 'Entity pruning failed', { error: String(err) });
    }
  }, MEMORY_CLEANUP_INTERVAL_MS);
  memoryCleanupInterval.unref();

  // ── Register process ──
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    version = pkg.version;
  } catch { /* fallback */ }

  const advertiseHost = resolvedConfig.gateway.host === '0.0.0.0' ? hostname() : resolvedConfig.gateway.host;
  await registerProcess(redis, {
    id: processId('node', advertiseHost, resolvedConfig.gateway.port),
    type: 'node',
    host: advertiseHost,
    port: resolvedConfig.gateway.port,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    version,
    concurrency: messageConcurrency,
  });

  log('info', 'ScalyClaw is ready');

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      log('warn', 'Forced exit (second signal)');
      process.exit(1);
    }
    shuttingDown = true;
    log('info', 'Shutting down...');

    const forceTimer = setTimeout(() => {
      log('error', 'Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      await closeGateway();
      await deregisterProcess(redis);
      clearInterval(progressDrainInterval);
      clearInterval(memoryCleanupInterval);
      await disconnectAll();
      await Promise.allSettled(workers.map(w => w.pause()));
      await Promise.allSettled(workers.map(w => w.close()));
      await disconnectMcpServers();
      reloadSubscriber?.disconnect();
      await closeQueue();
      await closeRedis();
    } catch (err) {
      log('error', 'Error during shutdown', { error: String(err) });
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ─── Channel adapters ───

function initChannelAdapters(config: ScalyClawConfig, server: FastifyInstance): void {
  registerAdapter(new GatewayChannel(server));
  log('info', 'Registered channel: gateway');

  for (const adapter of buildChannelAdapters(config.channels, server)) {
    registerAdapter(adapter);
    log('info', `Registered channel: ${adapter.id}`);
  }
}

main().catch((err) => {
  console.error('ScalyClaw failed to start:', err);
  process.exit(1);
});
