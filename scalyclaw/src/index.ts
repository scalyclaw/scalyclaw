import { Worker } from 'bullmq';
import { PATHS } from './core/paths.js';
import { getRedis, getSubscriber } from '@scalyclaw/shared/core/redis.js';
import { log, initLogFile } from '@scalyclaw/shared/core/logger.js';
import { bootstrap } from './core/bootstrap.js';
import { enqueueJob, closeQueue, getQueue, getQueueName, removeRepeatableJob } from '@scalyclaw/shared/queue/queue.js';
import { processMessageQueueJob } from './processors/message-processor.js';
import { processInternalJob } from './processors/internal-processor.js';
import { processAgentJob } from './processors/agent-processor.js';
import { cancelAllChannelJobs } from '@scalyclaw/shared/queue/cancel.js';
import { CHANNEL_JOBS_KEY_PREFIX } from '@scalyclaw/shared/const/constants.js';
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
import {
  CANCEL_FLAG_KEY, UPDATE_NOTIFY_KEY, UPDATE_AWAITING_KEY_PREFIX,
  RATE_LIMIT_KEY_PREFIX, DEFAULT_RATE_LIMIT_PER_MINUTE,
  PROGRESS_BUFFER_KEY_PREFIX,
  CANCEL_FLAG_TTL_S, UPDATE_NOTIFY_TTL_S, UPDATE_AWAITING_TTL_S,
  PROGRESS_DRAIN_INTERVAL_MS, STARTUP_NOTIFY_DELAY_MS, SHUTDOWN_TIMEOUT_MS,
  GIT_FETCH_TIMEOUT_MS, VAULT_ROTATION_INTERVAL_MS,
} from './const/constants.js';

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
      try {
        await registerVaultKeyRotation();
      } catch (err) {
        log('warn', 'Failed to re-register vault key rotation after config reload', { error: String(err) });
      }
    },
  });

  // ── Always write logs to file ──
  initLogFile(PATHS.logs, 'scalyclaw.log');

  // ── BullMQ Workers: 3 queues (messages + agents + internal) ──
  const messageConcurrency = Number(process.env.SCALYCLAW_MESSAGE_CONCURRENCY ?? 5);
  const agentConcurrency = Number(process.env.SCALYCLAW_AGENT_CONCURRENCY ?? 3);
  const workerOpts = {
    connection: redis.duplicate() as never,
    lockDuration: resolvedConfig.queue.lockDuration,
    stalledInterval: resolvedConfig.queue.stalledInterval,
    limiter: resolvedConfig.queue.limiter,
  };

  const workers: Worker[] = [];

  // Messages queue — user message processing + commands (configurable concurrency for multi-channel)
  const messagesWorker = new Worker(getQueueName('messages'), processMessageQueueJob, {
    ...workerOpts,
    concurrency: messageConcurrency,
  });
  workers.push(messagesWorker);

  // Agents queue — agent LLM loops (runs on node for full DB/tool access)
  const agentsWorker = new Worker(getQueueName('agents'), processAgentJob, {
    ...workerOpts,
    concurrency: agentConcurrency,
  });
  workers.push(agentsWorker);

  // Internal queue — reminders, tasks, proactive, memory extraction, vault rotation
  const internalWorker = new Worker(getQueueName('internal'), processInternalJob, {
    ...workerOpts,
    concurrency: 3,
  });
  workers.push(internalWorker);

  for (const w of workers) {
    w.on('completed', (job) => {
      log('info', `Job completed: ${job.name}`, { jobId: job.id, queue: w.name });
    });
    w.on('failed', (job, err) => {
      log('error', `Job failed: ${job?.name}`, { jobId: job?.id, queue: w.name, error: String(err) });
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

  // ── Post-startup notification (update or restart) ──
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

  try {
    await registerProactiveCheck();
  } catch (err) {
    log('warn', 'Failed to register proactive check', { error: String(err) });
  }

  try {
    await registerVaultKeyRotation();
  } catch (err) {
    log('warn', 'Failed to register vault key rotation', { error: String(err) });
  }

  // ── Periodic cleanup ──

  const progressDrainInterval = setInterval(async () => {
    try {
      await drainProgressBuffers(redis);
    } catch (err) {
      log('warn', 'Periodic progress drain failed', { error: String(err) });
    }
  }, PROGRESS_DRAIN_INTERVAL_MS);
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
  const keys = await redis.keys(`${PROGRESS_BUFFER_KEY_PREFIX}*`);
  for (const key of keys) {
    const channelId = key.slice(PROGRESS_BUFFER_KEY_PREFIX.length);
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
  const key = `${RATE_LIMIT_KEY_PREFIX}${channelId}`;
  const now = Date.now();
  const result = await redis.eval(
    RATE_LIMIT_LUA, 1, key,
    now, 60_000, DEFAULT_RATE_LIMIT_PER_MINUTE, `${now}-${randomUUID()}`
  );
  return result === 1;
}

// ─── Slash commands ───

const KNOWN_COMMANDS = new Set([
  '/start', '/status', '/help', '/stop', '/cancel', '/clear', '/update',
  '/restart', '/shutdown',
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
    log('info', 'Rate limit exceeded, message dropped', { channelId });
    await sendToChannel(channelId, 'You\'re sending messages faster than I can keep up. Give me a moment.');
    return;
  }

  // ─── Update confirmation intercept ───
  {
    const redis = getRedis();
    const awaitingKey = `${UPDATE_AWAITING_KEY_PREFIX}${channelId}`;
    const awaitingRaw = await redis.get(awaitingKey);
    if (awaitingRaw) {
      await redis.del(awaitingKey);
      const lower = trimmed.toLowerCase();
      log('info', 'Update confirmation intercepted', { channelId, response: lower });
      if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
        try {
          const { repoDir, scriptPath } = JSON.parse(awaitingRaw);
          await redis.set(UPDATE_NOTIFY_KEY, JSON.stringify({ channelId, timestamp: Date.now() }), 'EX', UPDATE_NOTIFY_TTL_S);
          await sendToChannel(channelId, 'Updating now — I\'ll be back in a moment.');
          const { spawn } = await import('node:child_process');
          const child = spawn(scriptPath, ['--update-auto'], {
            cwd: repoDir,
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          log('info', 'Update process spawned (confirmed)', { pid: child.pid });
        } catch (err) {
          log('error', 'Failed to apply update', { error: String(err) });
          await sendToChannel(channelId, 'Failed to apply update. Check logs for details.');
        }
      } else {
        await sendToChannel(channelId, 'Update cancelled.');
      }
      return;
    }
  }

  // ─── Typing indicator ───
  sendTypingToChannel(channelId).catch(() => {});

  // ─── Stop detection ───
  if (trimmed === '/stop') {
    log('info', 'Command handled: /stop', { channelId });
    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
    await cancelAllChannelJobs(channelId).catch(() => {});
    await drainWaitingJobs(channelId).catch(() => {});
    await sendToChannel(channelId, 'Got it, stopping.');
    return;
  }

  // ─── /restart — restart the system ───
  if (trimmed === '/restart') {
    log('info', 'Command handled: /restart', { channelId });
    const scriptPath = join(PATHS.base, 'scalyclaw.sh');
    if (!existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Restart not available — management script not found.');
      return;
    }

    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
    await cancelAllChannelJobs(channelId).catch(() => {});
    await drainWaitingJobs(channelId).catch(() => {});
    await redis.set(UPDATE_NOTIFY_KEY, JSON.stringify({ channelId, reason: 'restart', timestamp: Date.now() }), 'EX', UPDATE_NOTIFY_TTL_S);
    await sendToChannel(channelId, 'Restarting...');

    const { spawn } = await import('node:child_process');
    const child = spawn(scriptPath, ['--restart'], {
      cwd: PATHS.base,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    log('info', 'Restart process spawned', { pid: child.pid });
    return;
  }

  // ─── /shutdown — shut down the system ───
  if (trimmed === '/shutdown') {
    log('info', 'Command handled: /shutdown', { channelId });
    const scriptPath = join(PATHS.base, 'scalyclaw.sh');
    if (!existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Shutdown not available — management script not found.');
      return;
    }

    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
    await cancelAllChannelJobs(channelId).catch(() => {});
    await drainWaitingJobs(channelId).catch(() => {});
    await sendToChannel(channelId, 'Shutting down.');

    const { spawn } = await import('node:child_process');
    const child = spawn(scriptPath, ['--stop'], {
      cwd: PATHS.base,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    log('info', 'Shutdown process spawned', { pid: child.pid });
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

  // ─── /update — check for updates and ask for confirmation ───
  if (trimmed === '/update') {
    log('info', 'Command handled: /update', { channelId });
    const repoDir = join(PATHS.base, 'repo');
    const scriptPath = join(repoDir, 'website', 'install.sh');

    if (!existsSync(join(repoDir, '.git')) || !existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Update not available — ScalyClaw was not installed via the standard installer.');
      return;
    }

    try {
      const { execSync } = await import('node:child_process');

      try {
        execSync('git fetch origin main --quiet', { cwd: repoDir, timeout: GIT_FETCH_TIMEOUT_MS, stdio: 'pipe' });
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
      const commitLog = execSync('git log --oneline HEAD..origin/main', { cwd: repoDir, encoding: 'utf-8' }).trim();

      // Store confirmation state in Redis with 120s TTL
      const redis = getRedis();
      await redis.set(
        `${UPDATE_AWAITING_KEY_PREFIX}${channelId}`,
        JSON.stringify({ repoDir, scriptPath }),
        'EX', UPDATE_AWAITING_TTL_S,
      );

      await sendToChannel(channelId, `${count} update(s) available:\n\n\`\`\`\n${commitLog}\n\`\`\`\n\nReply **yes** to update or **no** to cancel.`);
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

// ─── Drain waiting jobs for a channel ───

async function drainWaitingJobs(channelId: string): Promise<void> {
  let removed = 0;

  // Drain messages + agents queues — match by channelId in job data
  for (const queueName of ['messages', 'agents'] as const) {
    const q = getQueue(queueName);
    for (const state of ['waiting', 'prioritized'] as const) {
      const jobs = await q.getJobs(state);
      for (const job of jobs) {
        if (job.data?.channelId === channelId) {
          await job.remove().catch(() => {});
          removed++;
        }
      }
    }
  }

  // Drain tools queue — match by jobId against the tracked set for this channel
  const redis = getRedis();
  const trackedJobIds = await redis.smembers(`${CHANNEL_JOBS_KEY_PREFIX}${channelId}`);
  if (trackedJobIds.length > 0) {
    const trackedSet = new Set(trackedJobIds);
    const toolsQ = getQueue('tools');
    for (const state of ['waiting', 'prioritized'] as const) {
      const jobs = await toolsQ.getJobs(state);
      for (const job of jobs) {
        if (job.id && trackedSet.has(job.id)) {
          await job.remove().catch(() => {});
          removed++;
        }
      }
    }
  }

  if (removed > 0) {
    log('info', 'Drained waiting jobs on /stop', { channelId, removed });
  }
}

// ─── Vault key rotation registration ───

async function registerVaultKeyRotation(): Promise<void> {
  await removeRepeatableJob('vault-key-rotation', 'internal');

  await enqueueJob({
    name: 'vault-key-rotation',
    data: { trigger: 'scheduled' },
    opts: {
      repeat: { every: VAULT_ROTATION_INTERVAL_MS },
      jobId: 'vault-key-rotation',
    },
  });

  log('info', 'Vault key rotation cron registered (every 10 minutes)');
}

main().catch((err) => {
  console.error('ScalyClaw failed to start:', err);
  process.exit(1);
});
