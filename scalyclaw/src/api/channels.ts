import type { FastifyInstance } from 'fastify';
import { getAllAdapters, getChannelHealth } from '../channels/manager.js';
import { getConfig, saveConfig, publishConfigReload } from '../core/config.js';

export function registerChannelsRoutes(server: FastifyInstance): void {
  // GET /api/channels — list channels and their health
  server.get('/api/channels', async () => {
    const adapters = getAllAdapters();
    const health = await getChannelHealth();
    const config = getConfig();

    return {
      channels: adapters.filter(a => a.id !== 'gateway').map(a => {
        const cfg = config.channels[a.id] as Record<string, unknown> | undefined;
        return {
          id: a.id,
          name: a.id,
          type: a.id,
          enabled: cfg?.enabled !== false,
          healthy: health[a.id] ?? false,
        };
      }),
    };
  });

  // PATCH /api/channels/:id — toggle enabled
  server.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>('/api/channels/:id', async (request, reply) => {
    const { id } = request.params;
    const { enabled } = request.body ?? {};
    const config = getConfig();

    if (!config.channels[id]) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    (config.channels[id] as Record<string, unknown>).enabled = enabled;
    await saveConfig(config);
    await publishConfigReload();
    return { enabled };
  });
}
