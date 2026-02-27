import type { FastifyInstance } from 'fastify';
import { getConfigRef } from '../core/config.js';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { getDb } from '../core/db.js';
import { processProactiveEngagement } from '../scheduler/proactive.js';
import { storeMessage } from '../core/db.js';
import { sendToChannel } from '../channels/manager.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export function registerProactiveRoutes(server: FastifyInstance): void {
  // GET /api/proactive/status
  server.get('/api/proactive/status', async () => {
    const config = getConfigRef();
    const redis = getRedis();
    const db = getDb();

    // Count recent proactive messages (last 24h)
    const recentMessages = db.prepare(
      `SELECT COUNT(*) as count FROM messages
       WHERE json_extract(metadata, '$.source') = 'proactive'
         AND created_at > datetime('now', '-1 day')`
    ).get() as { count: number };

    // Get per-channel cooldown status
    const channels = db.prepare(
      `SELECT DISTINCT channel FROM messages`
    ).all() as Array<{ channel: string }>;

    const cooldowns: Record<string, { onCooldown: boolean; dailyCount: number }> = {};
    for (const ch of channels) {
      const cooldownKey = `proactive:cooldown:${ch.channel}`;
      const dailyKey = `proactive:daily:${ch.channel}`;
      const hasCooldown = await redis.exists(cooldownKey);
      const dailyCount = await redis.get(dailyKey);
      cooldowns[ch.channel] = {
        onCooldown: hasCooldown === 1,
        dailyCount: dailyCount ? Number(dailyCount) : 0,
      };
    }

    return {
      enabled: config.proactive.enabled,
      recentMessageCount: recentMessages.count,
      channels: cooldowns,
    };
  });

  // POST /api/proactive/trigger
  server.post('/api/proactive/trigger', async () => {
    const results = await processProactiveEngagement();

    const delivered: typeof results = [];

    for (const result of results) {
      storeMessage(result.channelId, 'assistant', result.message, {
        source: 'proactive',
        triggerType: result.triggerType,
      });
      await sendToChannel(result.channelId, result.message);
      delivered.push(result);
      log('info', 'Proactive message sent (manual trigger)', {
        channelId: result.channelId,
        triggerType: result.triggerType,
      });
    }

    return {
      triggered: delivered.length,
      results: delivered.map(r => ({
        channelId: r.channelId,
        triggerType: r.triggerType,
        messagePreview: r.message.substring(0, 100),
      })),
    };
  });
}
