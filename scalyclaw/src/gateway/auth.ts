import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { getConfigRef } from '../core/config.js';

export function registerAuthHook(server: FastifyInstance): void {
  server.addHook('onRequest', async (request, reply) => {
    const { authType, authValue } = getConfigRef().gateway;

    // No auth configured — allow all
    if (authType === 'none' || !authValue) return;

    const url = request.url.split('?')[0];

    // Skip auth for health/status endpoints
    if (url === '/health' || url === '/status') return;

    // Only protect /api/* and /ws routes
    if (!url.startsWith('/api') && url !== '/ws') return;

    let token: string | null = null;

    // Bearer token from Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback: ?token= query param (for WebSocket clients that can't set headers on upgrade)
    if (!token) {
      const query = request.query as Record<string, string>;
      token = query.token ?? null;
    }

    if (!token || token.length !== authValue.length || !timingSafeEqual(Buffer.from(token), Buffer.from(authValue))) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}
