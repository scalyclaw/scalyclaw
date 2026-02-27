import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PATHS } from '../core/paths.js';
import { getAllAgents } from '../agents/agent-loader.js';
import { getAllSkills } from '@scalyclaw/shared/skills/skill-loader.js';
import { getConnectionStatuses } from '../mcp/mcp-manager.js';
import { ORCHESTRATOR_SECTION } from './orchestrator.js';
import { homeSection } from './home.js';
import { MEMORY_SECTION } from './memory.js';
import { VAULT_SECTION } from './vault.js';
import { AGENTS_SECTION } from './agents.js';
import { SKILLS_SECTION } from './skills.js';

const MIND_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md'];

// ─── Prompt Cache ───

let cachedPrompt: string | null = null;

export function invalidatePromptCache(): void {
  cachedPrompt = null;
}

export async function buildSystemPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;

  const parts: string[] = [];

  // 1. Load user-editable mind files from disk
  for (const file of MIND_FILES) {
    try {
      const content = await readFile(join(PATHS.mind, file), 'utf-8');
      parts.push(content);
      log('debug', `Prompt: mind/${file}`, { length: content.length });
    } catch {
      log('debug', `Prompt: mind/${file} not found — skipping`);
    }
  }

  // 2. Append code-defined system sections
  parts.push(ORCHESTRATOR_SECTION);
  parts.push(homeSection(PATHS.base));
  parts.push(MEMORY_SECTION);
  parts.push(VAULT_SECTION);
  parts.push(AGENTS_SECTION);
  parts.push(SKILLS_SECTION);

  // 3. Available skills (listed for reference — invoked via submit_job)
  const skills = getAllSkills();
  if (skills.length > 0) {
    const lines = skills.map(s => `- **${s.id}** — ${s.name}: ${s.description}${s.scriptPath ? ` (${s.scriptLanguage})` : ' (markdown-only)'}`);
    parts.push(`## Registered Skills — prefer these over native tools\n${lines.join('\n')}\nExecute via \`submit_job({ toolName: "execute_skill", payload: { skillId: "<id>", input: "<json>" } })\`.`);
    log('debug', 'Prompt: added skills', { count: skills.length });
  }

  // 4. Available agents (delegated via submit_job + delegate_agent)
  const agents = getAllAgents();
  if (agents.length > 0) {
    const lines = agents.map(a => `- **${a.id}** — ${a.name}: ${a.description} (model: ${a.models[0]?.model ?? 'default'})`);
    parts.push(`## Registered Agents — delegate when one matches\n${lines.join('\n')}\nDelegate via \`submit_job({ toolName: "delegate_agent", payload: { agentId: "<id>", task: "..." } })\`.`);
    log('debug', 'Prompt: added agents', { count: agents.length });
  }

  // 5. Connected MCP servers
  const mcpStatuses = getConnectionStatuses();
  const connectedMcp = mcpStatuses.filter(s => s.status === 'connected');
  if (connectedMcp.length > 0) {
    const lines = connectedMcp.map(s => {
      const toolNames = s.tools.map(t => `\`${t.name}\``).join(', ');
      return `- **${s.id}** (${s.transport}) — ${s.toolCount} tool(s): ${toolNames}`;
    });
    parts.push(`## Connected MCP Servers\n${lines.join('\n')}\nMCP tools are available as first-class tools — call them directly by name (e.g. \`mcp_<server>_<tool>\`).`);
    log('debug', 'Prompt: added MCP servers', { count: connectedMcp.length });
  }

  const prompt = parts.filter(Boolean).join('\n\n');
  log('debug', 'System prompt assembled', { totalLength: prompt.length, parts: parts.filter(Boolean).length });
  cachedPrompt = prompt;
  return prompt;
}
