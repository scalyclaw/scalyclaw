import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { getConfigRef, type ScalyClawConfig } from '../core/config.js';
import { getChannelMessages, recordUsage, type Message } from '../core/db.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { buildProactivePrompt } from '../prompt/proactive.js';

const ACTIVITY_PREFIX = 'scalyclaw:activity:';

// ─── Types ──────────────────────────────────────────────────────────

export interface ProactiveResult {
  channelId: string;
  message: string;
}

// ─── Channel Activity Tracking ──────────────────────────────────────

/** Record channel activity (called after each user message) */
export async function recordChannelActivity(channelId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${ACTIVITY_PREFIX}${channelId}`, String(Date.now()));
}

// ─── Context Gathering ──────────────────────────────────────────────

interface ChannelContext {
  messages: Message[];
  pendingResults: Message[];
}

function gatherChannelContext(channelId: string, lastActiveTs: number): ChannelContext {
  const messages = getChannelMessages(channelId, 10);

  // Pending results = assistant messages with scheduled sources created after lastActiveTs
  const lastActiveIso = new Date(lastActiveTs).toISOString().replace('T', ' ').slice(0, 19);
  const pendingResults = messages.filter(m => {
    if (m.role !== 'assistant' || !m.metadata) return false;
    try {
      const meta = JSON.parse(m.metadata);
      if (!['task', 'recurrent-task', 'reminder', 'recurrent-reminder'].includes(meta.source)) return false;
      return m.created_at > lastActiveIso;
    } catch {
      return false;
    }
  });

  return { messages, pendingResults };
}

// ─── Main entry point ───────────────────────────────────────────────

export async function processProactiveEngagement(): Promise<ProactiveResult[]> {
  const config = getConfigRef();
  const proactive = config.proactive;

  if (!proactive.enabled) {
    log('debug', 'Proactive engagement disabled');
    return [];
  }

  // Quiet hours check
  if (proactive.quietHours.enabled && isQuietHour(proactive.quietHours)) {
    log('debug', 'Proactive skipped — quiet hours');
    return [];
  }

  const redis = getRedis();

  // Find channels with activity keys
  const activityKeys = await redis.keys(`${ACTIVITY_PREFIX}*`);
  const idleThresholdMs = proactive.idleThresholdMinutes * 60_000;
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const idleChannels: Array<{ channel: string; lastActive: number }> = [];

  for (const key of activityKeys) {
    const channelId = key.slice(ACTIVITY_PREFIX.length);
    const tsStr = await redis.get(key);
    if (!tsStr) continue;

    const lastActive = Number(tsStr);
    const idleMs = now - lastActive;

    // Must be idle beyond threshold but active within 7 days
    if (idleMs >= idleThresholdMs && idleMs < sevenDaysMs) {
      idleChannels.push({ channel: channelId, lastActive });
    }
  }

  // Load identity once for all channels
  let identity = '';
  try {
    identity = await readFile(join(PATHS.mind, 'IDENTITY.md'), 'utf-8');
  } catch {
    log('debug', 'Proactive: IDENTITY.md not found — using empty identity');
  }

  const results: ProactiveResult[] = [];

  for (const ch of idleChannels) {
    // Rate limit: cooldown
    const cooldownKey = `proactive:cooldown:${ch.channel}`;
    const hasCooldown = await redis.exists(cooldownKey);
    if (hasCooldown) continue;

    // Rate limit: daily cap
    const dailyKey = `proactive:daily:${ch.channel}`;
    const dailyCount = await redis.get(dailyKey);
    if (dailyCount && Number(dailyCount) >= proactive.maxPerDay) continue;

    // Gather context from DB
    const context = gatherChannelContext(ch.channel, ch.lastActive);

    // Skip channels with no conversation history
    if (context.messages.length === 0) continue;

    try {
      const message = await generateProactiveMessage(context, identity, config);
      if (!message) continue;

      results.push({ channelId: ch.channel, message });

      // Set cooldown
      await redis.setex(cooldownKey, proactive.cooldownSeconds, '1');

      // Increment daily counter (expires at midnight in configured timezone)
      const ttl = secondsUntilMidnight(proactive.quietHours.timezone);
      const current = await redis.incr(dailyKey);
      if (current === 1) {
        await redis.expire(dailyKey, ttl);
      }
    } catch (err) {
      log('error', 'Failed to generate proactive message', { channelId: ch.channel, error: String(err) });
    }
  }

  log('debug', `Proactive check completed`, { checkedChannels: idleChannels.length, results: results.length });
  return results;
}

// ─── LLM message generation ────────────────────────────────────────

async function generateProactiveMessage(
  context: ChannelContext,
  identity: string,
  config: Readonly<ScalyClawConfig>,
): Promise<string | null> {
  const modelId = config.proactive.model || selectModel(config.orchestrator.models);
  if (!modelId) {
    log('warn', 'No model available for proactive message generation');
    return null;
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);

  const { system, user } = buildProactivePrompt({
    identity,
    messages: context.messages,
    pendingResults: context.pendingResults,
    currentTime: new Date().toISOString(),
  });

  const response = await provider.chat({
    model,
    systemPrompt: system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 256,
    temperature: 0.7,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'proactive',
  });

  const text = response.content.trim();

  // LLM can return [SKIP] to indicate nothing meaningful to say
  if (!text || text.includes('[SKIP]')) return null;

  return text;
}

// ─── Quiet hours ────────────────────────────────────────────────────

function isQuietHour(quietHours: ScalyClawConfig['proactive']['quietHours']): boolean {
  const { start, end, timezone } = quietHours;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
  const currentHour = Number(formatter.format(now));

  if (start > end) {
    return currentHour >= start || currentHour < end;
  }
  return currentHour >= start && currentHour < end;
}

function secondsUntilMidnight(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  const parts = formatter.formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const s = Number(parts.find(p => p.type === 'second')?.value ?? 0);
  const secondsSinceMidnight = h * 3600 + m * 60 + s;
  return Math.max(86400 - secondsSinceMidnight, 60);
}
