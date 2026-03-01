import { readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PATHS } from '../core/paths.js';
import { getConfig, getConfigRef, saveConfig } from '../core/config.js';
import { SKILL_CREATOR_PROMPT } from '../prompt/skill-creator.js';
import { AGENT_ELIGIBLE_TOOL_NAMES } from '../tools/tools.js';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  maxIterations: number;
  models: { model: string; weight: number; priority: number }[];
  skills: string[] | null;
  tools: string[];
  mcpServers: string[];
  systemPrompt: string;
}

const loadedAgents = new Map<string, AgentDefinition>();

/** Load all agents from the agents directory on startup */
export async function loadAllAgents(): Promise<Map<string, AgentDefinition>> {
  loadedAgents.clear();

  // Load builtin skill-creator-agent
  const config = getConfigRef();
  const defaultModel = config.orchestrator.models[0] ?? config.models.models.find(m => m.enabled);
  const modelEntry = defaultModel
    ? [{ model: 'model' in defaultModel ? (defaultModel as { model: string }).model : (defaultModel as { id: string }).id, weight: 1, priority: 1 }]
    : config.orchestrator.models;

  loadedAgents.set('skill-creator-agent', {
    id: 'skill-creator-agent',
    name: 'Skill Creator',
    description: 'Builtin agent that creates new skills. Knows skill structure, languages, conventions, and testing workflow.',
    enabled: true,
    maxIterations: 25,
    models: modelEntry,
    skills: null,
    tools: [...AGENT_ELIGIBLE_TOOL_NAMES],
    mcpServers: [],
    systemPrompt: SKILL_CREATOR_PROMPT,
  });
  log('info', 'Loaded builtin agent: skill-creator-agent');

  // Load user-created agents from the agents directory
  try {
    const entries = await readdir(PATHS.agents, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await loadAgentFromDir(entry.name);
      }
    }
  } catch {
    log('debug', 'No agents directory found');
  }

  log('info', `Loaded ${loadedAgents.size} agents`);
  return loadedAgents;
}

/** Load a single agent from its directory */
async function loadAgentFromDir(agentId: string): Promise<void> {
  const dirPath = join(PATHS.agents, agentId);
  const mdPath = join(dirPath, 'AGENT.md');

  try {
    const markdown = await readFile(mdPath, 'utf-8');

    // Parse frontmatter or headers for name/description
    let name = agentId;
    let description = '';

    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      const descMatch = fm.match(/description:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    } else {
      const nameMatch = markdown.match(/^#\s+(.+)$/m);
      const descMatch = markdown.match(/## Description\s+(.+)$/m);
      if (nameMatch) name = nameMatch[1];
      if (descMatch) description = descMatch[1];
    }

    // Get model config from Redis config
    const config = getConfigRef();
    const agentConfig = config.orchestrator.agents.find(a => a.id === agentId);

    // Skip disabled agents
    const enabled = agentConfig?.enabled ?? true;
    if (!enabled) {
      log('info', `Skipping disabled agent: ${agentId}`);
      return;
    }

    loadedAgents.set(agentId, {
      id: agentId,
      name,
      description,
      enabled,
      maxIterations: agentConfig?.maxIterations ?? 25,
      models: agentConfig?.models ?? config.orchestrator.models,
      skills: agentConfig?.skills ?? [],
      tools: agentConfig?.tools ?? [...AGENT_ELIGIBLE_TOOL_NAMES],
      mcpServers: agentConfig?.mcpServers ?? [],
      systemPrompt: markdown,
    });

    log('info', `Loaded agent: ${agentId}`, { name, hasConfig: !!agentConfig });
  } catch (err) {
    log('warn', `Failed to load agent: ${agentId}`, { error: String(err) });
  }
}

/** Get a loaded agent by ID */
export function getAgent(agentId: string): AgentDefinition | undefined {
  return loadedAgents.get(agentId);
}

/** Get all loaded agents */
export function getAllAgents(): AgentDefinition[] {
  return [...loadedAgents.values()];
}

/** Load a single agent (used by agent-runner) */
export async function loadAgent(agentId: string): Promise<AgentDefinition | null> {
  if (loadedAgents.has(agentId)) return loadedAgents.get(agentId)!;

  // Try loading from disk
  await loadAgentFromDir(agentId);
  return loadedAgents.get(agentId) ?? null;
}

/** Create a new agent — writes files to disk and registers in config */
export async function createAgent(
  agentId: string,
  name: string,
  description: string,
  systemPrompt: string,
  models?: { model: string; weight: number; priority: number }[],
  skills?: string[],
  maxIterations?: number,
  tools?: string[],
  mcpServers?: string[],
): Promise<void> {
  // Enforce -agent suffix
  if (!agentId.endsWith('-agent')) agentId = `${agentId}-agent`;
  const dirPath = join(PATHS.agents, agentId);
  await mkdir(dirPath, { recursive: true });

  // Write AGENT.md with frontmatter
  const markdown = `---
name: ${name}
description: ${description}
---

${systemPrompt}`;

  await writeFile(join(dirPath, 'AGENT.md'), markdown, 'utf-8');

  // Register in config (clone to avoid mutating cache if save fails)
  const config = getConfig();
  const agentModels = models ?? config.orchestrator.models;
  const agentSkills = skills ?? [];
  const agentTools = tools ?? [...AGENT_ELIGIBLE_TOOL_NAMES];
  const agentMcpServers = mcpServers ?? [];
  const agentMaxIterations = maxIterations ?? 25;

  const existing = config.orchestrator.agents.findIndex(a => a.id === agentId);
  const entry = { id: agentId, enabled: true, maxIterations: agentMaxIterations, models: agentModels, skills: agentSkills, tools: agentTools, mcpServers: agentMcpServers };

  if (existing >= 0) {
    config.orchestrator.agents[existing] = entry;
  } else {
    config.orchestrator.agents.push(entry);
  }

  await saveConfig(config);

  // Reload into memory
  loadedAgents.set(agentId, {
    id: agentId,
    name,
    description,
    enabled: true,
    maxIterations: agentMaxIterations,
    models: agentModels,
    skills: agentSkills,
    tools: agentTools,
    mcpServers: agentMcpServers,
    systemPrompt: markdown,
  });

  log('info', `Agent created: ${agentId}`, { name, maxIterations: agentMaxIterations, models: agentModels.length, skills: agentSkills.length, tools: agentTools.length, mcpServers: agentMcpServers.length });
}

/** Update an existing agent's prompt and/or config */
export async function updateAgent(
  agentId: string,
  updates: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    maxIterations?: number;
    models?: { model: string; weight: number; priority: number }[];
    skills?: string[];
    tools?: string[];
    mcpServers?: string[];
  },
): Promise<boolean> {
  const current = loadedAgents.get(agentId);
  if (!current) return false;

  const name = updates.name ?? current.name;
  const description = updates.description ?? current.description;
  const systemPrompt = updates.systemPrompt ?? current.systemPrompt;
  const maxIterations = updates.maxIterations ?? current.maxIterations;
  const models = updates.models ?? current.models;
  const skills = updates.skills ?? current.skills;
  const tools = updates.tools ?? current.tools;
  const mcpServers = updates.mcpServers ?? current.mcpServers;

  // Rewrite AGENT.md
  const dirPath = join(PATHS.agents, agentId);
  const markdown = `---
name: ${name}
description: ${description}
---

${systemPrompt}`;

  await writeFile(join(dirPath, 'AGENT.md'), markdown, 'utf-8');

  // Update config (clone to avoid mutating cache if save fails)
  const config = getConfig();
  const idx = config.orchestrator.agents.findIndex(a => a.id === agentId);
  const entry = { id: agentId, enabled: config.orchestrator.agents[idx]?.enabled ?? true, maxIterations, models, skills, tools, mcpServers };
  if (idx >= 0) {
    config.orchestrator.agents[idx] = entry;
  } else {
    config.orchestrator.agents.push(entry);
  }
  await saveConfig(config);

  // Update in memory
  loadedAgents.set(agentId, { id: agentId, name, description, enabled: current.enabled, maxIterations, models, skills, tools, mcpServers, systemPrompt: markdown });

  log('info', `Agent updated: ${agentId}`);
  return true;
}

/** Delete an agent — removes files and unregisters from config */
export async function deleteAgent(agentId: string): Promise<boolean> {
  const dirPath = join(PATHS.agents, agentId);

  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  // Remove from config (clone to avoid mutating cache if save fails)
  const config = getConfig();
  const idx = config.orchestrator.agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    config.orchestrator.agents.splice(idx, 1);
    await saveConfig(config);
  }

  const existed = loadedAgents.delete(agentId);
  log('info', `Agent deleted: ${agentId}`, { existed });
  return existed;
}
