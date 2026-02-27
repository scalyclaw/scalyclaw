import { Worker } from 'bullmq';
import { PATHS } from './core/paths.js';
import { getRedis, getSubscriber } from '@scalyclaw/shared/core/redis.js';
import { log, initLogFile } from '@scalyclaw/shared/core/logger.js';
import { bootstrap } from './core/bootstrap.js';
import { enqueueJob, closeQueue, getQueueName } from '@scalyclaw/shared/queue/queue.js';
import { processMessageQueueJob } from './processors/message-processor.js';
import { processSystemQueueJob } from './processors/system-processor.js';
import { processAgentJob } from './processors/agent-processor.js';
import { processScheduleJob } from './processors/schedule-processor.js';
import { processProactiveJob } from './processors/proactive-processor.js';
import { cancelAllChannelJobs } from '@scalyclaw/shared/queue/cancel.js';
import { randomUUID } from 'node:crypto';
import { subscribeToProgress, type ProgressEvent } from './queue/progress.js';
import { initGateway, listenGateway, closeGateway } from './gateway/server.js';
import { registerAdapter, connectAll, disconnectAll, reloadChannels, sendToChannel, sendFileToChannel, sendTypingToChannel } from './channels/manager.js';
import { resolveFilePath } from './core/workspace.js';
import { GatewayChannel } from './channels/gateway.js';
import { buildChannelAdapters } from './channels/registry.js';
import type { NormalizedMessage } from './channels/adapter.js';
import type { FastifyInstance } from 'fastify';
import { registerProactiveCheck } from './scheduler/scheduler.js';
import { registerProcess, deregisterProcess, processId } from '@scalyclaw/shared/core/registry.js';
import { disconnectAll as disconnectMcpServers } from './mcp/mcp-manager.js';
import type { ScalyClawConfig } from './core/config.js';
import type { Redis } from 'ioredis';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hostname } from 'node:os';

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
      try {
        await registerProactiveCheck();
      } catch (err) {
        log('warn', 'Failed to re-register proactive check after config reload', { error: String(err) });
      }
    },
  });

  // ── Always write logs to file ──
  initLogFile(PATHS.logs, 'scalyclaw.log');

  // ── BullMQ Workers: 5 queues (messages + system + agents + scheduler + proactive) ──
  const concurrency = Number(process.env.SCALYCLAW_CONCURRENCY ?? 3);
  const agentConcurrency = Number(process.env.SCALYCLAW_AGENT_CONCURRENCY ?? 3);
  const workerOpts = {
    connection: redis.duplicate() as never,
    lockDuration: resolvedConfig.queue.lockDuration,
    stalledInterval: resolvedConfig.queue.stalledInterval,
    limiter: resolvedConfig.queue.limiter,
  };

  const workers: Worker[] = [];

  // Messages queue — user message processing + commands (concurrency=1: single-user serialization)
  const messagesWorker = new Worker(getQueueName('messages'), processMessageQueueJob, {
    ...workerOpts,
    concurrency: 1,
  });
  workers.push(messagesWorker);

  // System queue — memory extraction, scheduled-fire, proactive-fire
  const systemWorker = new Worker(getQueueName('system'), processSystemQueueJob, {
    ...workerOpts,
    concurrency: 2,
  });
  workers.push(systemWorker);

  // Agents queue — agent LLM loops (runs on node for full DB/tool access)
  const agentsWorker = new Worker(getQueueName('agents'), processAgentJob, {
    ...workerOpts,
    concurrency: agentConcurrency,
  });
  workers.push(agentsWorker);

  // Scheduler queue — reminder/recurring relay (moved from worker — lightweight, no DB needed)
  const schedulerWorker = new Worker(getQueueName('scheduler'), processScheduleJob, {
    ...workerOpts,
    concurrency: 2,
  });
  workers.push(schedulerWorker);

  // Proactive queue — proactive engagement check (moved from worker — needs DB for usage recording)
  const proactiveWorker = new Worker(getQueueName('proactive'), processProactiveJob, {
    ...workerOpts,
    concurrency: 1,
  });
  workers.push(proactiveWorker);

  for (const w of workers) {
    w.on('completed', (job) => {
      log('info', `Job completed: ${job.name}`, { jobId: job.id, queue: w.name });
    });
    w.on('failed', (job, err) => {
      log('error', `Job failed: ${job?.name}`, { jobId: job?.id, queue: w.name, error: String(err) });
    });
  }
  log('info', `Assistant consumers started (concurrency: ${concurrency}, agent: ${agentConcurrency}, queues: ${workers.length})`);

  // ── Gateway + channels ──
  const server = await initGateway();
  gatewayServer = server;

  initChannelAdapters(resolvedConfig, server);
  await connectAll(async (message: NormalizedMessage) => {
    await handleIncomingMessage(message);
  });

  await listenGateway(resolvedConfig.gateway.host, resolvedConfig.gateway.port);

  // Warn if auth is disabled on a non-localhost address
  if (
    (resolvedConfig.gateway.authType === 'none' || !resolvedConfig.gateway.authValue) &&
    resolvedConfig.gateway.host !== '127.0.0.1'
  ) {
    log('warn', '!!! WARNING: Gateway is listening without authentication on a non-localhost address. Set gateway.authType in config. !!!');
  }

  // ── Progress subscription — targeted delivery to source channel ──
  const subscriber = await getSubscriber(redisConfig);
  await subscribeToProgress(subscriber, async (channelId, event) => {
    if (event.type === 'complete' && event.filePath) {
      const localPath = resolveFilePath(event.filePath);
      await sendFileToChannel(channelId, localPath, event.caption);
    } else if (event.type === 'complete' && event.result) {
      await sendToChannel(channelId, event.result);
    } else if (event.type === 'progress' && event.message) {
      await sendToChannel(channelId, event.message);
    } else if (event.type === 'error' && event.error) {
      log('error', 'Worker job error received', { jobId: event.jobId, error: event.error });
      await sendToChannel(channelId, event.error);
    }
  });

  await drainProgressBuffers(redis);

  try {
    await registerProactiveCheck();
  } catch (err) {
    log('warn', 'Failed to register proactive check', { error: String(err) });
  }

  // ── Periodic cleanup ──

  const progressDrainInterval = setInterval(async () => {
    try {
      await drainProgressBuffers(redis);
    } catch (err) {
      log('warn', 'Periodic progress drain failed', { error: String(err) });
    }
  }, 60_000);
  progressDrainInterval.unref();

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
    concurrency,
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
      log('error', 'Shutdown timed out after 8s, forcing exit');
      process.exit(1);
    }, 8_000);
    forceTimer.unref();

    try {
      await closeGateway();
      await deregisterProcess(redis);
      clearInterval(progressDrainInterval);
      await disconnectAll();
      await Promise.allSettled(workers.map(w => w.close()));
      await disconnectMcpServers();
      reloadSubscriber?.disconnect();
      await closeQueue();
    } catch (err) {
      log('error', 'Error during shutdown', { error: String(err) });
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ─── Progress buffer drain ───

async function drainProgressBuffers(redis: Redis): Promise<void> {
  const keys = await redis.keys('progress-buffer:*');
  for (const key of keys) {
    const channelId = key.replace('progress-buffer:', '');
    const events = await redis.eval(
      `local msgs = redis.call('lrange', KEYS[1], 0, -1)
       if #msgs > 0 then redis.call('del', KEYS[1]) end
       return msgs`, 1, key,
    ) as string[];
    for (const raw of events) {
      try {
        const event = JSON.parse(raw) as ProgressEvent;

        if (event.type === 'complete' && event.filePath) {
          const localPath = resolveFilePath(event.filePath);
          await sendFileToChannel(channelId, localPath, event.caption);
        } else if (event.type === 'complete' && event.result) {
          await sendToChannel(channelId, event.result);
        } else if (event.type === 'error' && event.error) {
          await sendToChannel(channelId, event.error);
        }
      } catch (err) {
        log('warn', 'Failed to process buffered progress event', { channelId, error: String(err) });
      }
    }
  }
  if (keys.length > 0) {
    log('info', 'Drained progress buffers', { keyCount: keys.length });
  }
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

// ─── Rate limiting (Redis sliding window) ───

const RATE_LIMIT_PREFIX = 'scalyclaw:ratelimit:';
const DEFAULT_MAX_PER_MINUTE = 20;

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('zremrangebyscore', key, 0, now - window)
local count = redis.call('zcard', key)
if count >= limit then return 0 end
redis.call('zadd', key, now, member)
redis.call('pexpire', key, window)
return 1
`;

async function checkRateLimit(channelId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${RATE_LIMIT_PREFIX}${channelId}`;
  const now = Date.now();
  const result = await redis.eval(
    RATE_LIMIT_LUA, 1, key,
    now, 60_000, DEFAULT_MAX_PER_MINUTE, `${now}-${randomUUID()}`
  );
  return result === 1;
}

// ─── Slash commands ───

const KNOWN_COMMANDS = new Set([
  '/start', '/status', '/help', '/stop', '/cancel', '/clear', '/update',
  '/reminders', '/tasks', '/skills', '/agents', '/mcp',
  '/models', '/guards', '/vault', '/memory', '/usage',
]);

// ─── Incoming message handler ───

async function handleIncomingMessage(message: NormalizedMessage): Promise<void> {
  const channelId = message.channelId;

  log('info', '=== Incoming message ===', {
    channelId,
    textLength: message.text.length,
    attachments: message.attachments.length,
  });

  const trimmed = message.text.trim();

  // ─── Rate limiting ───
  const allowed = await checkRateLimit(channelId);
  if (!allowed) {
    log('warn', 'Rate limit exceeded', { channelId });
    await sendToChannel(channelId, 'You\'re sending messages faster than I can keep up. Give me a moment.');
    return;
  }

  // ─── Typing indicator ───
  sendTypingToChannel(channelId).catch(() => {});

  // ─── Stop detection ───
  if (trimmed === '/stop') {
    const redis = getRedis();
    await redis.set('scalyclaw:cancel', '1', 'EX', 30);
    await cancelAllChannelJobs(channelId).catch(() => {});
    await sendToChannel(channelId, 'Got it, stopping.');
    return;
  }

  // ─── /clear — clear conversation + prompt cache ───
  if (trimmed === '/clear') {
    const { clearMessages } = await import('./core/db.js');
    const { invalidatePromptCache } = await import('./prompt/builder.js');
    clearMessages();
    invalidatePromptCache();
    await sendToChannel(channelId, 'Conversation cleared.');
    log('info', 'Conversation cleared', { channelId });
    return;
  }

  // ─── /update — check for updates and apply ───
  if (trimmed === '/update') {
    const repoDir = join(PATHS.base, 'repo');
    const scriptPath = join(repoDir, 'website', 'install.sh');

    if (!existsSync(join(repoDir, '.git')) || !existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Update not available — ScalyClaw was not installed via the standard installer.');
      return;
    }

    try {
      const { execSync } = await import('node:child_process');

      try {
        execSync('git fetch origin main --quiet', { cwd: repoDir, timeout: 15_000, stdio: 'pipe' });
      } catch {
        await sendToChannel(channelId, 'Failed to check for updates. Check your internet connection.');
        return;
      }

      const localHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
      const remoteHead = execSync('git rev-parse origin/main', { cwd: repoDir, encoding: 'utf-8' }).trim();

      if (localHead === remoteHead) {
        const current = execSync('git log -1 --format="%h %s"', { cwd: repoDir, encoding: 'utf-8' }).trim();
        await sendToChannel(channelId, `Already up to date. Current: \`${current}\``);
        return;
      }

      const count = execSync('git rev-list --count HEAD..origin/main', { cwd: repoDir, encoding: 'utf-8' }).trim();
      await sendToChannel(channelId, `${count} update(s) available. Updating now — I'll be back in a moment.`);

      const { spawn } = await import('node:child_process');
      const child = spawn(scriptPath, ['--update-auto'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      log('info', 'Update process spawned', { pid: child.pid });
    } catch (err) {
      log('error', 'Update check failed', { error: String(err) });
      await sendToChannel(channelId, 'Failed to check for updates. Check logs for details.');
    }
    return;
  }

  // ─── /cancel reminder|task [id] ───
  if (trimmed === '/cancel') {
    await sendToChannel(channelId, 'Usage: `/cancel reminder <id>` or `/cancel task <id>`');
    return;
  }

  const isCommand = KNOWN_COMMANDS.has(trimmed.split(/\s/)[0]);

  const attachments = message.attachments.length > 0
    ? message.attachments.map(a => ({ type: a.type, filePath: a.filePath, fileName: a.fileName, mimeType: a.mimeType }))
    : undefined;

  try {
    await enqueueJob({
      name: isCommand ? 'command' : 'message-processing',
      data: {
        channelId,
        text: message.text,
        ...(attachments && { attachments }),
      },
      opts: {
        ...(isCommand && { priority: 1 }),
        attempts: 2,
        backoff: { type: 'fixed', delay: 2000 },
      },
    });
  } catch (err) {
    log('error', 'Failed to enqueue job', { channelId, error: String(err) });
    try {
      await sendToChannel(channelId, 'Something went wrong on my end. Try again?');
    } catch {
      // Can't send error response either
    }
  }
}

main().catch((err) => {
  console.error('ScalyClaw failed to start:', err);
  process.exit(1);
});
