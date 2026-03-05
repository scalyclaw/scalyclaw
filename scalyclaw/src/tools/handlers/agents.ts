import { log } from '@scalyclaw/shared/core/logger.js';
import { getAllAgents, createAgent, updateAgent, deleteAgent } from '../../agents/agent-loader.js';
import { publishAgentReload } from '../../agents/agent-store.js';
import { getConfig, getConfigRef, saveConfig } from '../../core/config.js';
import { runAgentGuard } from '../../guards/guard.js';
import { getSkill } from '@scalyclaw/shared/skills/skill-loader.js';
import { getConnectionStatuses } from '../../mcp/mcp-manager.js';
import { AGENT_ELIGIBLE_TOOL_NAMES } from '../tools.js';

export function handleListAgents(): string {
  const agents = getAllAgents().map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    models: a.models.map(m => m.model),
    skills: a.skills,
    tools: a.tools,
    mcpServers: a.mcpServers,
  }));
  return JSON.stringify({ agents });
}

export async function handleCreateAgent(input: Record<string, unknown>): Promise<string> {
  let id = input.id as string;
  const name = input.name as string;
  const description = input.description as string;
  const systemPrompt = input.systemPrompt as string;
  const modelId = input.modelId as string | undefined;
  const skills = Array.isArray(input.skills) ? (input.skills as string[]) : undefined;
  const tools = Array.isArray(input.tools) ? (input.tools as string[]) : undefined;
  const mcpServers = Array.isArray(input.mcpServers) ? (input.mcpServers as string[]) : undefined;
  const maxIterations = typeof input.maxIterations === 'number' ? input.maxIterations : undefined;

  if (!id || !name || !description || !systemPrompt) {
    return JSON.stringify({ error: 'Missing required fields: id, name, description, systemPrompt' });
  }

  if (!id.endsWith('-agent')) id = `${id}-agent`;

  log('debug', 'create_agent', { id, name, modelId, skills, tools, mcpServers, maxIterations });

  const guardResult = await runAgentGuard(id, { name, description, systemPrompt, skills });
  if (!guardResult.passed) {
    return JSON.stringify({ error: `Agent guard blocked: ${guardResult.reason}` });
  }

  if (tools) {
    const eligibleSet = new Set(AGENT_ELIGIBLE_TOOL_NAMES);
    const unknown = tools.filter(t => !eligibleSet.has(t));
    if (unknown.length > 0) {
      return JSON.stringify({ error: `Unknown tools: ${unknown.join(', ')}. Available: ${AGENT_ELIGIBLE_TOOL_NAMES.join(', ')}` });
    }
  }

  if (skills) {
    const unknown = skills.filter(s => !getSkill(s));
    if (unknown.length > 0) {
      return JSON.stringify({ error: `Unknown skills: ${unknown.join(', ')}. Register them first with register_skill.` });
    }
  }

  if (mcpServers) {
    const connectedIds = new Set(getConnectionStatuses().map(s => s.id));
    const unknown = mcpServers.filter(s => !connectedIds.has(s));
    if (unknown.length > 0) {
      return JSON.stringify({ error: `Unknown MCP servers: ${unknown.join(', ')}. Available: ${[...connectedIds].join(', ') || 'none'}` });
    }
  }

  const models = modelId
    ? [{ model: modelId, weight: 1, priority: 1 }]
    : [{ model: 'auto', weight: 1, priority: 1 }];

  try {
    await createAgent(id, name, description, systemPrompt, models, skills, maxIterations, tools, mcpServers);
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
    return JSON.stringify({ created: true, id, name });
  } catch (err) {
    log('error', 'create_agent failed', { error: String(err) });
    return JSON.stringify({ error: `Failed to create agent: ${String(err)}` });
  }
}

export async function handleUpdateAgent(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  if (!id) {
    return JSON.stringify({ error: 'Missing required field: id' });
  }

  log('debug', 'update_agent', { id });

  const updates: Parameters<typeof updateAgent>[1] = {};
  if (input.name) updates.name = input.name as string;
  if (input.description) updates.description = input.description as string;
  if (input.systemPrompt) updates.systemPrompt = input.systemPrompt as string;
  if (input.modelId) {
    updates.models = [{ model: input.modelId as string, weight: 1, priority: 1 }];
  }
  if (Array.isArray(input.skills)) updates.skills = input.skills as string[];
  if (Array.isArray(input.tools)) updates.tools = input.tools as string[];
  if (Array.isArray(input.mcpServers)) updates.mcpServers = input.mcpServers as string[];
  if (typeof input.maxIterations === 'number') updates.maxIterations = input.maxIterations;

  try {
    const updated = await updateAgent(id, updates);
    if (!updated) {
      return JSON.stringify({ error: `Agent "${id}" not found. Create it first with create_agent.` });
    }
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
    return JSON.stringify({ updated: true, id });
  } catch (err) {
    log('error', 'update_agent failed', { error: String(err) });
    return JSON.stringify({ error: `Failed to update agent: ${String(err)}` });
  }
}

export async function handleDeleteAgent(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  if (!id) {
    return JSON.stringify({ error: 'Missing required field: id' });
  }

  log('debug', 'delete_agent', { id });

  try {
    const deleted = await deleteAgent(id);
    await publishAgentReload().catch((err2) => log('warn', 'Failed to publish agent reload', { error: String(err2) }));
    return JSON.stringify({ deleted, id });
  } catch (err) {
    log('error', 'delete_agent failed', { error: String(err) });
    return JSON.stringify({ error: `Failed to delete agent: ${String(err)}` });
  }
}

/** Validate agentId → find in config → mutate → save → publish */
export async function withAgentConfig(
  agentId: string,
  mutate: (agent: { id: string; enabled: boolean; maxIterations: number; models: { model: string; weight: number; priority: number }[]; skills: string[]; tools: string[]; mcpServers: string[] }) => Record<string, unknown>,
): Promise<string> {
  if (!agentId) return JSON.stringify({ error: 'Missing required field: agentId' });
  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === agentId);
  if (!agent) return JSON.stringify({ error: `Agent "${agentId}" not found in config` });
  const result = mutate(agent);
  await saveConfig(config);
  await publishAgentReload().catch(e => log('warn', 'Agent reload failed', { error: String(e) }));
  return JSON.stringify({ updated: true, agentId, ...result });
}
