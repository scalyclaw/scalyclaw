import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { log } from '../core/logger.js';
import { getConfigRef } from '../core/config.js';
import { registerRoutes } from './routes.js';
import { registerAuthHook } from './auth.js';

let server: FastifyInstance | null = null;

export async function initGateway(): Promise<FastifyInstance> {
  server = Fastify({ logger: false });

  // WebSocket support
  await server.register(websocket);

  // Multipart upload support
  await server.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Rate limiting — only on /api/* routes (not webhooks, /ws, /health)
  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (_req: import('fastify').FastifyRequest, _key: string) => {
      const url = _req.url.split('?')[0];
      return !url.startsWith('/api');
    },
  });

  // Security headers
  server.addHook('onRequest', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-XSS-Protection', '0');
  });

  // CORS — reads from config on every request so changes take effect immediately
  server.addHook('onRequest', async (request, reply) => {
    const cors = getConfigRef().gateway.cors;
    if (cors.length === 0) return;

    const origin = request.headers.origin;
    if (origin && (cors.includes('*') || cors.includes(origin))) {
      reply.header('Access-Control-Allow-Origin', cors.includes('*') ? '*' : origin);
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // Auth — reads from config dynamically
  registerAuthHook(server);

  // Routes
  registerRoutes(server);

  return server;
}

export async function listenGateway(host: string, port: number): Promise<void> {
  if (!server) throw new Error('Gateway not initialized');
  await server.listen({ host, port });
  log('info', `Gateway listening on ${host}:${port}`);
}

export function getGateway(): FastifyInstance | null {
  return server;
}

export async function closeGateway(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
  }
}
