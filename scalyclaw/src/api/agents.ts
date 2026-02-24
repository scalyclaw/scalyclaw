import type { FastifyInstance } from 'fastify';
import { getAllAgents, getAgent, createAgent, updateAgent, deleteAgent } from '../agents/agent-loader.js';
import { publishAgentReload } from '../agents/agent-store.js';
import { getConfig, saveConfig } from '../core/config.js';
import { validateId } from '../core/validation.js';
import { runAgentGuard } from '../guards/guard.js';
import { AGENT_ELIGIBLE_TOOL_NAMES } from '../tools/tools.js';

export function registerAgentsRoutes(server: FastifyInstance): void {
  // GET /api/agents
  server.get('/api/agents', async () => {
    const agents = getAllAgents();
    const config = getConfig();
    const enabledMap = new Map(config.orchestrator.agents.map(a => [a.id, a.enabled]));
    return {
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        maxIterations: a.maxIterations,
        models: a.models,
        skills: a.skills,
        tools: a.tools,
        mcpServers: a.mcpServers,
        enabled: enabledMap.get(a.id) ?? true,
      })),
    };
  });

  // GET /api/agents/eligible-tools
  server.get('/api/agents/eligible-tools', async () => {
    return { tools: AGENT_ELIGIBLE_TOOL_NAMES };
  });

  // POST /api/agents — create a new agent
  server.post<{
    Body: { id: string; name: string; description: string; systemPrompt: string; maxIterations?: number; models?: { model: string; weight: number; priority: number }[]; skills?: string[]; tools?: string[]; mcpServers?: string[] };
  }>('/api/agents', async (request, reply) => {
    let { id, name, description, systemPrompt, models, skills, maxIterations, tools, mcpServers } = request.body ?? {};
    if (!id || !name || !systemPrompt) return reply.status(400).send({ error: 'id, name, and systemPrompt are required' });
    // Enforce -agent suffix
    if (!id.endsWith('-agent')) id = `${id}-agent`;
    if (!validateId(id)) return reply.status(400).send({ error: 'Invalid agent id' });

    // Run agent guard before creating
    const guardResult = await runAgentGuard(id, {
      name,
      description: description ?? '',
      systemPrompt,
      skills,
    });
    if (!guardResult.passed) {
      return reply.status(403).send({ error: `Agent blocked by security guard: ${guardResult.reason}` });
    }

    await createAgent(id, name, description ?? '', systemPrompt, models, skills, maxIterations, tools, mcpServers);
    await publishAgentReload();
    return { created: true, id };
  });

  // GET /api/agents/:id
  server.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  // PATCH /api/agents/:id — toggle enabled
  server.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/agents/:id',
    async (request, reply) => {
      const { id } = request.params;
      const agent = getAgent(id);
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });

      const { enabled } = request.body ?? {};
      if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled (boolean) is required' });

      if (id === 'skill-creator-agent' && enabled === false) {
        return reply.status(403).send({ error: "Cannot disable built-in agent 'skill-creator-agent'" });
      }

      const config = getConfig();
      const entry = config.orchestrator.agents.find(a => a.id === id);
      if (entry) {
        entry.enabled = enabled;
      } else {
        config.orchestrator.agents.push({ id, enabled, maxIterations: agent.maxIterations, models: agent.models, skills: agent.skills, tools: agent.tools, mcpServers: agent.mcpServers });
      }
      await saveConfig(config);
      await publishAgentReload();
      return { success: true, enabled };
    },
  );

  // PUT /api/agents/:id — update an agent
  server.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; systemPrompt?: string; maxIterations?: number; models?: { model: string; weight: number; priority: number }[]; skills?: string[]; tools?: string[]; mcpServers?: string[] };
  }>('/api/agents/:id', async (request, reply) => {
    if (request.params.id === 'skill-creator-agent') {
      return reply.status(403).send({ error: "Cannot edit built-in agent 'skill-creator-agent'" });
    }

    // Run agent guard before updating — merge with existing agent data
    const existing = getAgent(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    const body = request.body ?? {};
    const guardResult = await runAgentGuard(request.params.id, {
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      systemPrompt: body.systemPrompt ?? existing.systemPrompt,
      skills: body.skills ?? existing.skills,
    });
    if (!guardResult.passed) {
      return reply.status(403).send({ error: `Agent update blocked by security guard: ${guardResult.reason}` });
    }

    const updated = await updateAgent(request.params.id, body);
    if (!updated) return reply.status(404).send({ error: 'Agent not found' });
    await publishAgentReload();
    return { updated: true };
  });

  // DELETE /api/agents/:id
  server.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    if (request.params.id === 'skill-creator-agent') {
      return reply.status(403).send({ error: "Cannot delete built-in agent 'skill-creator-agent'" });
    }

    const deleted = await deleteAgent(request.params.id);
    if (!deleted) return reply.status(404).send({ error: 'Agent not found' });
    await publishAgentReload();
    return { deleted: true };
  });
}
