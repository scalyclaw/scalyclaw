import type { FastifyInstance } from 'fastify';
import { listProcesses } from '../core/registry.js';
import { getRedis } from '../core/redis.js';

export function registerWorkersRoutes(server: FastifyInstance): void {
  // GET /api/workers — list registered processes
  server.get('/api/workers', async () => {
    const redis = getRedis();
    const processes = await listProcesses(redis);
    return { workers: processes };
  });
}
