import type { FastifyInstance } from 'fastify';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PATHS } from '../core/paths.js';
import { readWorkspaceFile, writeWorkspaceFile, patchWorkspaceFile } from '../core/workspace.js';

export function registerWorkspaceRoutes(server: FastifyInstance): void {
  // GET /api/workspace/files — list files in workspace
  server.get<{ Querystring: { path?: string } }>('/api/workspace/files', async (request, reply) => {
    const subPath = request.query.path || '';
    const dirPath = join(PATHS.workspace, subPath);
    const resolvedDir = resolve(dirPath);
    const resolvedBase = resolve(PATHS.workspace);
    if (resolvedDir !== resolvedBase && !resolvedDir.startsWith(resolvedBase + '/')) {
      return reply.status(400).send({ error: 'Invalid path' });
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (e) => {
        const fullPath = join(dirPath, e.name);
        const s = await stat(fullPath).catch(() => null);
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          size: s?.size ?? 0,
          modified: s?.mtime.toISOString() ?? null,
        };
      }),
    );
    return { path: subPath || '/', files };
  });

  // GET /api/workspace/file — read a file
  server.get<{ Querystring: { path: string } }>('/api/workspace/file', async (request, reply) => {
    const { path } = request.query;
    if (!path) return reply.status(400).send({ error: 'path is required' });

    try {
      const content = await readWorkspaceFile(path);
      return { path, content };
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }
  });

  // POST /api/workspace/file — write a file
  server.post<{ Body: { path: string; content: string } }>('/api/workspace/file', async (request, reply) => {
    const { path, content } = request.body ?? {};
    if (!path || content === undefined) return reply.status(400).send({ error: 'path and content are required' });

    await writeWorkspaceFile(path, content);
    return { written: true, path };
  });

  // PATCH /api/workspace/file — patch a file (search & replace)
  server.patch<{ Body: { path: string; search: string; replace: string; all?: boolean } }>(
    '/api/workspace/file',
    async (request, reply) => {
      const { path, search, replace, all } = request.body ?? {};
      if (!path || !search || replace === undefined) {
        return reply.status(400).send({ error: 'path, search, and replace are required' });
      }

      const result = await patchWorkspaceFile(path, search, replace, all ?? false);
      if (!result.matched) return reply.status(404).send({ error: 'Search string not found in file' });
      return { patched: true, count: result.count };
    },
  );
}
