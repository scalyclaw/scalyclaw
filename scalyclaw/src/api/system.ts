import type { FastifyInstance } from 'fastify';
import { getChannelHealth, getAllAdapters } from '../channels/manager.js';
import { getConfigRef } from '../core/config.js';

export function registerSystemRoutes(server: FastifyInstance): void {
  server.get('/health', async () => {
    const channelHealth = await getChannelHealth();
    const activeChannels = Object.entries(channelHealth)
      .filter(([_, healthy]) => healthy)
      .map(([id]) => id);

    let config;
    try {
      config = getConfigRef();
    } catch {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Config not loaded',
      };
    }

    return {
      status: activeChannels.length > 0 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      components: {
        channels: { status: activeChannels.length > 0 ? 'healthy' : 'unhealthy', active: activeChannels },
        models: { status: 'healthy', count: config.models.models.length, embeddingCount: config.models.embeddingModels.length },
      },
    };
  });

  server.get('/status', async () => {
    const adapters = getAllAdapters();
    return {
      uptime: process.uptime(),
      channels: adapters.map(a => a.id),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  server.post('/api/shutdown', async (_request, reply) => {
    reply.send({ status: 'shutting_down' });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });
}
