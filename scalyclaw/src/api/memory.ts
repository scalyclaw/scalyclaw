import type { FastifyInstance } from 'fastify';
import { storeMemory, searchMemory, recallMemory, deleteMemory, updateMemory, parseTags } from '../memory/memory.js';

export function registerMemoryRoutes(server: FastifyInstance): void {
  // GET /api/memory — list recent memories
  server.get('/api/memory', async () => {
    const results = recallMemory();
    return { results };
  });

  // POST /api/memory — store a memory
  server.post<{
    Body: {
      type: string;
      subject: string;
      content: string;
      tags?: string[];
      source?: string;
      confidence?: number;
      ttl?: string;
    };
  }>('/api/memory', async (request, reply) => {
    const { type, subject, content, tags, source, confidence, ttl } = request.body ?? {};
    if (!type || !subject || !content) {
      return reply.status(400).send({ error: 'type, subject, and content are required' });
    }

    const id = await storeMemory({ type, subject, content, tags, source, confidence, ttl });
    return { id };
  });

  // PUT /api/memory/:id — update a memory
  server.put<{
    Params: { id: string };
    Body: {
      subject?: string;
      content?: string;
      tags?: string[];
      confidence?: number;
    };
  }>('/api/memory/:id', async (request, reply) => {
    const updated = await updateMemory(request.params.id, request.body ?? {});
    if (!updated) return reply.status(404).send({ error: 'Memory not found' });
    return { updated: true };
  });

  // GET /api/memory/search — search memories
  server.get<{ Querystring: { q: string; topK?: string; type?: string; tags?: string } }>(
    '/api/memory/search',
    async (request, reply) => {
      const { q, topK, type, tags } = request.query;
      if (!q) return reply.status(400).send({ error: 'q (query) is required' });

      const results = await searchMemory(q, {
        topK: topK ? Number(topK) : undefined,
        type: type || undefined,
        tags: tags ? parseTags(tags) : undefined,
      });
      return { results };
    },
  );

  // GET /api/memory/:id — recall a specific memory
  server.get<{ Params: { id: string } }>('/api/memory/:id', async (request, reply) => {
    const entries = recallMemory(request.params.id);
    if (entries.length === 0) return reply.status(404).send({ error: 'Memory not found' });
    return entries[0];
  });

  // DELETE /api/memory/:id — delete a memory
  server.delete<{ Params: { id: string } }>('/api/memory/:id', async (request, reply) => {
    const deleted = deleteMemory(request.params.id);
    if (!deleted) return reply.status(404).send({ error: 'Memory not found' });
    return { deleted: true };
  });
}
