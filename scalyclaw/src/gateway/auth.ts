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

    if (!token) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    // Pad both buffers to equal length to avoid leaking token length via timing
    const tokenBuf = Buffer.from(token);
    const authBuf = Buffer.from(authValue);
    const maxLen = Math.max(tokenBuf.length, authBuf.length);
    const padded1 = Buffer.alloc(maxLen);
    const padded2 = Buffer.alloc(maxLen);
    tokenBuf.copy(padded1);
    authBuf.copy(padded2);

    if (!timingSafeEqual(padded1, padded2) || tokenBuf.length !== authBuf.length) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}
