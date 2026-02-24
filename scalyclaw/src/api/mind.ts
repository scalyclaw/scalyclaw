import type { FastifyInstance } from 'fastify';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PATHS } from '../core/paths.js';

const EDITABLE_FILES = new Set(['SOUL.md', 'IDENTITY.md', 'USER.md']);

export function registerMindRoutes(server: FastifyInstance): void {
  // GET /api/mind — list mind files
  server.get('/api/mind', async () => {
    try {
      const entries = await readdir(PATHS.mind);
      return { files: entries };
    } catch {
      return { files: [] };
    }
  });

  // GET /api/mind/:name — read a mind file
  server.get<{ Params: { name: string } }>('/api/mind/:name', async (request, reply) => {
    const filePath = join(PATHS.mind, request.params.name);
    if (!resolve(filePath).startsWith(resolve(PATHS.mind) + '/')) {
      return reply.status(400).send({ error: 'Invalid file name' });
    }
    try {
      const content = await readFile(filePath, 'utf-8');
      return { name: request.params.name, content };
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }
  });

  // PUT /api/mind/:name — save a mind file (only editable files)
  server.put<{ Params: { name: string }; Body: { content: string } }>('/api/mind/:name', async (request, reply) => {
    const name = request.params.name;
    if (!EDITABLE_FILES.has(name)) {
      return reply.status(403).send({ error: `File "${name}" is read-only` });
    }
    const filePath = join(PATHS.mind, name);
    if (!resolve(filePath).startsWith(resolve(PATHS.mind) + '/')) {
      return reply.status(400).send({ error: 'Invalid file name' });
    }
    try {
      await readFile(filePath); // verify it exists
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }
    await writeFile(filePath, request.body.content, 'utf-8');
    return { ok: true };
  });
}
