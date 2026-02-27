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

    // Preserve real secrets when the dashboard sends back redacted '***' values
    if (merged.models && typeof merged.models === 'object') {
      const m = merged.models as Record<string, unknown>;
      const incomingProviders = m.providers as Record<string, Record<string, string>> | undefined;
      const currentProviders = current.models.providers;
      if (incomingProviders && currentProviders) {
        for (const [key, prov] of Object.entries(incomingProviders)) {
          const orig = currentProviders[key];
          if (!orig) continue;
          if (prov.apiKey === '***') prov.apiKey = orig.apiKey ?? '';
          if (prov.baseUrl === '***') prov.baseUrl = orig.baseUrl ?? '';
        }
      }
    }

    // Preserve real MCP server secrets when redacted
    if (merged.mcpServers && typeof merged.mcpServers === 'object') {
      const incoming = merged.mcpServers as Record<string, Record<string, unknown>>;
      const currentMcp = current.mcpServers;
      for (const [id, server] of Object.entries(incoming)) {
        const orig = currentMcp[id];
        if (!orig) continue;
        const headers = server.headers as Record<string, string> | undefined;
        if (headers && orig.headers) {
          for (const [k, v] of Object.entries(headers)) {
            if (v === '***') headers[k] = orig.headers[k] ?? '';
          }
        }
        const env = server.env as Record<string, string> | undefined;
        if (env && orig.env) {
          for (const [k, v] of Object.entries(env)) {
            if (v === '***') env[k] = orig.env[k] ?? '';
          }
        }
      }
    }

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
