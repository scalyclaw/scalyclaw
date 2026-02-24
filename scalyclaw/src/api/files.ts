import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolveFilePath } from '../core/workspace.js';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

export function registerFilesRoutes(server: FastifyInstance): void {
  // GET /api/files?path=<relative-path> — serve workspace files as binary
  server.get<{ Querystring: { path: string } }>('/api/files', async (request, reply) => {
    const { path } = request.query;
    if (!path) return reply.status(400).send({ error: 'path is required' });

    let fullPath: string;
    try {
      fullPath = resolveFilePath(path);
    } catch {
      return reply.status(400).send({ error: 'Invalid path' });
    }

    try {
      await stat(fullPath);
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }

    const ext = extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const fileName = basename(fullPath);

    const DANGEROUS_TYPES = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml']);
    const disposition = DANGEROUS_TYPES.has(contentType) ? 'attachment' : 'inline';

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `${disposition}; filename="${fileName}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=3600');

    return reply.send(createReadStream(fullPath));
  });
}
