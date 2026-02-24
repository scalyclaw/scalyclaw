import { getRedis } from '../core/redis.js';
import { getConfigRef, type ScalyClawConfig } from '../core/config.js';
import { recordUsage } from '../core/db.js';
import { log } from '../core/logger.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { PROACTIVE_SYSTEM_PROMPT } from '../prompt/proactive.js';

const ACTIVITY_PREFIX = 'scalyclaw:activity:';

// ─── Types ──────────────────────────────────────────────────────────

export interface ProactiveTrigger {
  type: 'undelivered_result' | 'fired_scheduled' | 'unanswered_message';
  summary: string;
}

export interface ProactiveResult {
  channelId: string;
  message: string;
  triggerType: ProactiveTrigger['type'];
}

// ─── Channel Activity Tracking ──────────────────────────────────────

/** Record channel activity (called after each user message) */
export async function recordChannelActivity(channelId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${ACTIVITY_PREFIX}${channelId}`, String(Date.now()));
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

    // Find triggers (Redis-based)
    const triggers = await findTriggers(ch.channel, proactive.triggers);
    if (triggers.length === 0) continue;

    // Pick the first trigger and generate message via LLM
    const trigger = triggers[0];
    try {
      const message = await generateProactiveMessage(trigger, config);
      if (!message) continue;

      results.push({ channelId: ch.channel, message, triggerType: trigger.type });

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

// ─── Trigger detection (Redis-based) ────────────────────────────────

async function findTriggers(
  channelId: string,
  triggerConfig: ScalyClawConfig['proactive']['triggers'],
): Promise<ProactiveTrigger[]> {
  const redis = getRedis();
  const triggers: ProactiveTrigger[] = [];

  // Check for undelivered results (tracked in Redis set)
  if (triggerConfig.undeliveredResults) {
    const undeliveredKey = `scalyclaw:undelivered:${channelId}`;
    const count = await redis.scard(undeliveredKey);
    if (count > 0) {
      triggers.push({
        type: 'undelivered_result',
        summary: `${count} completed task result(s) since your last message.`,
      });
    }
  }

  // Check for fired scheduled items (tracked in Redis set)
  if (triggerConfig.firedScheduledItems) {
    const firedKey = `scalyclaw:fired:${channelId}`;
    const count = await redis.scard(firedKey);
    if (count > 0) {
      triggers.push({
        type: 'fired_scheduled',
        summary: `${count} scheduled item(s) fired since your last message.`,
      });
    }
  }

  // Check for unanswered message (tracked in Redis flag)
  if (triggerConfig.unansweredMessages) {
    const unansweredKey = `scalyclaw:unanswered:${channelId}`;
    const val = await redis.get(unansweredKey);
    if (val === '1') {
      triggers.push({
        type: 'unanswered_message',
        summary: 'Your last message did not receive a response.',
      });
    }
  }

  return triggers;
}

// ─── LLM message generation ────────────────────────────────────────

async function generateProactiveMessage(
  trigger: ProactiveTrigger,
  config: Readonly<ScalyClawConfig>,
): Promise<string | null> {
  const modelId = config.proactive.model || selectModel(config.orchestrator.models);
  if (!modelId) {
    log('warn', 'No model available for proactive message generation');
    return null;
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);

  const systemPrompt = PROACTIVE_SYSTEM_PROMPT;

  const userPrompt = `Trigger: ${trigger.type}\nDetails: ${trigger.summary}\n\nGenerate a brief follow-up message.`;

  const response = await provider.chat({
    model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
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
  return text || null;
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
