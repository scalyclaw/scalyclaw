import type { FastifyInstance } from 'fastify';
import { getConfig, getConfigRef, saveConfig, loadConfig, publishConfigReload, redactConfig } from '../core/config.js';

export function registerConfigRoutes(server: FastifyInstance): void {
  // GET /api/config
  server.get('/api/config', async () => {
    const config = getConfigRef();
    return redactConfig(config);
  });

  // PUT /api/config — full config replace
  server.put<{ Body: Record<string, unknown> }>('/api/config', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'Request body must be a JSON object' });
    }

    const ALLOWED_KEYS = new Set(['orchestrator', 'gateway', 'logs', 'memory', 'queue', 'models', 'channels', 'skills', 'mcpServers', 'guards', 'budget', 'proactive']);
    const unknownKeys = Object.keys(body).filter(k => !ALLOWED_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return reply.status(400).send({ error: `Unknown config keys: ${unknownKeys.join(', ')}` });
    }

    // Block auth setting mutation — prevent attackers from disabling auth
    if (body.gateway) {
      const gw = body.gateway as Record<string, unknown>;
      delete gw.authType;
      delete gw.authValue;
    }

    const current = getConfig();
    const merged = { ...current, ...body };
    await saveConfig(merged as typeof current);
    await publishConfigReload();
    return { updated: true };
  });

  // POST /api/config/reload — reload config from Redis
  server.post('/api/config/reload', async () => {
    await loadConfig();
    return { reloaded: true };
  });
}
