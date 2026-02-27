import type { FastifyInstance } from 'fastify';
import { listProcesses } from '@scalyclaw/shared/core/registry.js';
import { getRedis } from '@scalyclaw/shared/core/redis.js';

export function registerWorkersRoutes(server: FastifyInstance): void {
  // GET /api/workers — list registered processes
  server.get('/api/workers', async () => {
    const redis = getRedis();
    const processes = await listProcesses(redis);
    return { workers: processes };
  });
}
