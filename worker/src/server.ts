import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';
import { PATHS } from '@scalyclaw/shared/core/paths.js';
import type { WorkerSetupConfig } from './config.js';

const LOG_FILE = 'worker.log';

let version = '0.1.0';
try {
  const pkg = await import('../../package.json', { with: { type: 'json' } });
  version = pkg.default.version;
} catch { /* fallback */ }

export async function initWorkerServer(config: WorkerSetupConfig): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const authToken = config.gateway.authToken;

  // Bearer auth hook — skip /health
  server.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (url === '/health') return;
    if (!authToken) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token || token.length !== authToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(authToken))) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /health — no auth, liveness check
  server.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version,
  }));

  // GET /status — detailed status
  server.get('/status', async () => ({
    uptime: process.uptime(),
    concurrency: config.concurrency,
    memory: process.memoryUsage(),
    version,
  }));

  // GET /api/logs — serve worker log
  server.get<{ Querystring: { lines?: string } }>('/api/logs', async (request) => {
    const logPath = join(PATHS.logs, LOG_FILE);
    try {
      const content = await readFile(logPath, 'utf-8');
      const allLines = content.split('\n');
      const lines = Number(request.query.lines) || 100;
      const tail = allLines.slice(-lines).join('\n');
      return { file: LOG_FILE, content: tail };
    } catch {
      return { file: LOG_FILE, content: '' };
    }
  });

  // GET /api/files — serve any file from the worker's home directory (PATHS.base).
  // The node can access any file in the worker's home (workspace, skills, logs, database, etc.).
  // Paths are relative to PATHS.base (e.g. "workspace/output.mp4", "skills/youtube/out.mp4", "logs/worker.log").
  server.get<{ Querystring: { path?: string } }>('/api/files', async (request, reply) => {
    const relPath = request.query.path;
    if (!relPath) {
      reply.status(400).send({ error: 'Missing query parameter: path' });
      return;
    }
    if (relPath.includes('\0')) {
      reply.status(400).send({ error: 'Invalid path' });
      return;
    }

    const resolved = resolve(PATHS.base, relPath);
    const baseRoot = resolve(PATHS.base);
    if (!resolved.startsWith(baseRoot + '/') && resolved !== baseRoot) {
      reply.status(403).send({ error: 'Path traversal blocked' });
      return;
    }

    try {
      const st = await stat(resolved);
      if (!st.isFile()) {
        reply.status(400).send({ error: 'Not a file' });
        return;
      }
    } catch {
      reply.status(404).send({ error: 'File not found' });
      return;
    }

    const MIME: Record<string, string> = {
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain', '.csv': 'text/csv',
      '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
    };
    const ext = extname(resolved).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    const filename = basename(resolved);
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape);
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);

    const stream = createReadStream(resolved);
    return reply.send(stream);
  });

  // POST /api/shutdown — graceful shutdown
  server.post('/api/shutdown', async (_request, reply) => {
    reply.send({ status: 'shutting_down' });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });

  return server;
}

export async function listenWorkerServer(server: FastifyInstance, host: string, port: number): Promise<void> {
  await server.listen({ host, port });
}

export async function closeWorkerServer(server: FastifyInstance): Promise<void> {
  await server.close();
}
