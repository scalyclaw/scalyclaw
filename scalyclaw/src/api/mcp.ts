import type { FastifyInstance } from 'fastify';
import { getConfig, saveConfig, type McpServerConfig } from '../core/config.js';
import { validateId } from '../core/validation.js';
import { getConnectionStatuses, reloadServers, reconnectServer } from '../mcp/mcp-manager.js';
import { publishMcpReload } from '../mcp/mcp-store.js';

export function registerMcpRoutes(server: FastifyInstance): void {
  // GET /api/mcp — list all MCP servers with connection status + tools
  server.get('/api/mcp', async () => {
    const config = getConfig();
    const statuses = getConnectionStatuses();
    const statusMap = new Map(statuses.map(s => [s.id, s]));

    const servers = Object.entries(config.mcpServers).map(([id, cfg]) => {
      const status = statusMap.get(id);
      return {
        id,
        ...cfg,
        status: status?.status ?? 'disconnected',
        error: status?.error,
        toolCount: status?.toolCount ?? 0,
        tools: status?.tools ?? [],
      };
    });

    return { servers };
  });

  // POST /api/mcp — add a new MCP server
  server.post<{
    Body: { id: string } & McpServerConfig;
  }>('/api/mcp', async (request, reply) => {
    const { id, ...cfg } = request.body ?? {} as { id: string } & McpServerConfig;
    if (!id || (!cfg.command && !cfg.url)) {
      return reply.status(400).send({ error: 'id and either command (stdio) or url (http/sse) are required' });
    }
    if (!validateId(id)) return reply.status(400).send({ error: 'Invalid MCP server id' });

    const config = getConfig();
    if (config.mcpServers[id]) {
      return reply.status(409).send({ error: `MCP server "${id}" already exists` });
    }

    config.mcpServers[id] = cfg;
    await saveConfig(config);
    await reloadServers(config.mcpServers);
    await publishMcpReload();
    return { created: true, id };
  });

  // PUT /api/mcp/:id — update an MCP server
  server.put<{
    Params: { id: string };
    Body: Partial<McpServerConfig>;
  }>('/api/mcp/:id', async (request, reply) => {
    const { id } = request.params;
    const config = getConfig();

    if (!config.mcpServers[id]) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    config.mcpServers[id] = { ...config.mcpServers[id], ...request.body };
    await saveConfig(config);
    await reloadServers(config.mcpServers);
    await publishMcpReload();
    return { updated: true };
  });

  // PATCH /api/mcp/:id — toggle enabled
  server.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>('/api/mcp/:id', async (request, reply) => {
    const { id } = request.params;
    const { enabled } = request.body ?? {};
    const config = getConfig();

    if (!config.mcpServers[id]) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    config.mcpServers[id].enabled = enabled;
    await saveConfig(config);
    await reloadServers(config.mcpServers);
    await publishMcpReload();
    return { enabled };
  });

  // DELETE /api/mcp/:id — remove an MCP server
  server.delete<{ Params: { id: string } }>('/api/mcp/:id', async (request, reply) => {
    const { id } = request.params;
    const config = getConfig();

    if (!config.mcpServers[id]) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    delete config.mcpServers[id];
    await saveConfig(config);
    await reloadServers(config.mcpServers);
    await publishMcpReload();
    return { deleted: true };
  });

  // POST /api/mcp/:id/reconnect — force reconnect
  server.post<{ Params: { id: string } }>('/api/mcp/:id/reconnect', async (request, reply) => {
    const { id } = request.params;
    const config = getConfig();

    if (!config.mcpServers[id]) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    await reconnectServer(id, config.mcpServers[id]);
    return { reconnected: true };
  });
}
