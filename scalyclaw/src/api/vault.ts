import type { FastifyInstance } from 'fastify';
import { listSecrets, resolveSecret, storeSecret, deleteSecret } from '../core/vault.js';
import { validateId } from '../core/validation.js';

export function registerVaultRoutes(server: FastifyInstance): void {
  // GET /api/vault — list secret names (not values)
  server.get('/api/vault', async () => {
    const names = await listSecrets();
    return { secrets: names };
  });

  // POST /api/vault — store a secret
  server.post<{ Body: { name: string; value: string } }>('/api/vault', async (request, reply) => {
    const { name, value } = request.body ?? {};
    if (!name || !value) return reply.status(400).send({ error: 'name and value are required' });
    if (!validateId(name)) return reply.status(400).send({ error: 'Invalid secret name' });

    await storeSecret(name, value);
    return { stored: true, name };
  });

  // POST /api/vault/:name/reveal — reveal a secret value (POST to avoid leaking in logs/history)
  server.post<{ Params: { name: string }; Body: { confirm: boolean } }>('/api/vault/:name/reveal', async (request, reply) => {
    if (!request.body?.confirm) return reply.status(400).send({ error: 'Body must include { "confirm": true }' });
    const value = await resolveSecret(request.params.name);
    if (value === null) return reply.status(404).send({ error: 'Secret not found' });
    return { name: request.params.name, value };
  });

  // DELETE /api/vault/:name — delete a secret
  server.delete<{ Params: { name: string } }>('/api/vault/:name', async (request, reply) => {
    const deleted = await deleteSecret(request.params.name);
    if (!deleted) return reply.status(404).send({ error: 'Secret not found' });
    return { deleted: true };
  });
}
