import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { enqueueJob, getQueue, removeRepeatableJob } from '@scalyclaw/shared/queue/queue.js';
import { requestJobCancel } from '@scalyclaw/shared/queue/cancel.js';
import { sendToChannel, sendTypingToChannel } from '../channels/manager.js';
import { PATHS } from '../core/paths.js';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedMessage } from '../channels/adapter.js';
import {
  CANCEL_FLAG_KEY, UPDATE_NOTIFY_KEY, UPDATE_AWAITING_KEY_PREFIX,
  RATE_LIMIT_KEY_PREFIX, DEFAULT_RATE_LIMIT_PER_MINUTE,
  CANCEL_FLAG_TTL_S, UPDATE_NOTIFY_TTL_S, UPDATE_AWAITING_TTL_S,
  GIT_FETCH_TIMEOUT_MS, VAULT_ROTATION_INTERVAL_MS,
  DEDUP_KEY_PREFIX, DEDUP_TTL_S,
} from '../const/constants.js';

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

export const KNOWN_COMMANDS = new Set([
  '/start', '/status', '/help', '/stop', '/stopall', '/cancel', '/clear', '/update',
  '/restart', '/shutdown',
  '/reminders', '/tasks', '/skills', '/agents', '/mcp',
  '/models', '/guards', '/vault', '/memory', '/usage',
]);

// ─── Incoming message handler ───

export async function handleIncomingMessage(message: NormalizedMessage): Promise<void> {
  const channelId = message.channelId;

  log('info', '=== Incoming message ===', {
    channelId,
    textLength: message.text.length,
    attachments: message.attachments.length,
  });

  const trimmed = message.text.trim();
  const command = trimmed.split(/\s/)[0].toLowerCase();

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

  // ─── /stop — cancel the latest active message job only ───
  if (command === '/stop') {
    log('info', 'Command handled: /stop', { channelId });
    const q = getQueue('messages');
    const activeJobs = await q.getJobs('active');
    const latest = activeJobs
      .filter(j => j.data?.channelId === channelId)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    if (latest?.id) {
      await requestJobCancel(latest.id);
      log('info', '/stop cancelled latest job', { jobId: latest.id, channelId });
    }
    await drainWaitingJobs(channelId).catch(() => {});
    await sendToChannel(channelId, 'Got it, stopping.');
    return;
  }

  // ─── /stopall — cancel ALL active processing + drain pending ───
  if (command === '/stopall') {
    log('info', 'Command handled: /stopall', { channelId });
    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
    for (const queueName of ['messages', 'agents'] as const) {
      const q = getQueue(queueName);
      const jobs = await q.getJobs(['active', 'waiting', 'prioritized']);
      for (const job of jobs) {
        if (job.id) await requestJobCancel(job.id).catch(() => {});
      }
    }
    for (const queueName of ['messages', 'agents'] as const) {
      const q = getQueue(queueName);
      for (const state of ['waiting', 'prioritized'] as const) {
        const jobs = await q.getJobs(state);
        for (const job of jobs) {
          await job.remove().catch(() => {});
        }
      }
    }
    await sendToChannel(channelId, 'Stopping everything.');
    return;
  }

  // ─── /restart — restart the system ───
  if (command === '/restart') {
    log('info', 'Command handled: /restart', { channelId });
    const scriptPath = join(PATHS.base, 'scalyclaw.sh');
    if (!existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Restart not available — management script not found.');
      return;
    }

    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
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
  if (command === '/shutdown') {
    log('info', 'Command handled: /shutdown', { channelId });
    const scriptPath = join(PATHS.base, 'scalyclaw.sh');
    if (!existsSync(scriptPath)) {
      await sendToChannel(channelId, 'Shutdown not available — management script not found.');
      return;
    }

    const redis = getRedis();
    await redis.set(CANCEL_FLAG_KEY, '1', 'EX', CANCEL_FLAG_TTL_S);
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
  if (command === '/clear') {
    const { clearMessages } = await import('../core/db.js');
    const { invalidatePromptCache } = await import('../prompt/builder.js');
    clearMessages();
    invalidatePromptCache();
    await sendToChannel(channelId, 'Conversation cleared.');
    log('info', 'Conversation cleared', { channelId });
    return;
  }

  // ─── /update — check for updates and ask for confirmation ───
  if (command === '/update') {
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
  if (command === '/cancel') {
    await sendToChannel(channelId, 'Usage: `/cancel reminder <id>` or `/cancel task <id>`');
    return;
  }

  const isCommand = KNOWN_COMMANDS.has(command);

  // ─── Incoming message dedup (guards against webhook/network double-delivery) ───
  {
    const redis = getRedis();
    const hash = createHash('sha256').update(`${channelId}:${message.text}`).digest('hex').slice(0, 16);
    const dedupKey = `${DEDUP_KEY_PREFIX}${hash}`;
    const isNew = await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S, 'NX');
    if (isNew !== 'OK') {
      log('info', 'Duplicate message detected, skipping', { channelId });
      return;
    }
  }

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

export async function drainWaitingJobs(channelId: string): Promise<void> {
  let removed = 0;

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

  if (removed > 0) {
    log('info', 'Drained waiting jobs on /stop', { channelId, removed });
  }
}

// ─── Vault key rotation registration ───

export async function registerVaultKeyRotation(): Promise<void> {
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
