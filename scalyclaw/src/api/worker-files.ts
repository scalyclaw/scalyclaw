import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { PATHS } from '../core/paths.js';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf', '.json': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
};

/**
 * Worker-facing endpoint that serves files ONLY from the node's workspace.
 * Workers must not access skills, agents, mind, logs, database, or any other
 * part of the node's home directory through this endpoint.
 */
export function registerWorkerFilesRoutes(server: FastifyInstance): void {
  server.get<{ Querystring: { path?: string } }>(
    '/api/worker/workspace',
    async (request, reply) => {
      const relPath = request.query.path;
      if (!relPath) return reply.status(400).send({ error: 'Missing query parameter: path' });
      if (relPath.includes('\0')) return reply.status(400).send({ error: 'Invalid path' });

      const resolved = resolve(PATHS.workspace, relPath);
      const workspaceRoot = resolve(PATHS.workspace);
      if (!resolved.startsWith(workspaceRoot + '/') && resolved !== workspaceRoot) {
        return reply.status(403).send({ error: 'Path traversal blocked' });
      }

      try {
        const st = await stat(resolved);
        if (!st.isFile()) return reply.status(400).send({ error: 'Not a file' });
      } catch {
        return reply.status(404).send({ error: 'File not found' });
      }

      const ext = extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      const filename = basename(resolved);
      const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape);

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      reply.header('X-Content-Type-Options', 'nosniff');

      return reply.send(createReadStream(resolved));
    },
  );
}
