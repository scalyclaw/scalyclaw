import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PATHS } from '../core/paths.js';
import { getAllAgents } from '../agents/agent-loader.js';
import { getAllSkills } from '@scalyclaw/shared/skills/skill-loader.js';
import { getConnectionStatuses } from '../mcp/mcp-manager.js';
import { coreInstructionsSection } from './core-instructions.js';
import { KNOWLEDGE_SECTION } from './knowledge.js';
import { EXTENSIONS_SECTION } from './extensions.js';

const MIND_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md'];

const MAX_DYNAMIC_ENTRIES = 20;
const MAX_DESCRIPTION_LENGTH = 80;

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

  // 2. Append 3 code-defined system sections
  parts.push(coreInstructionsSection(PATHS.base));
  parts.push(KNOWLEDGE_SECTION);
  parts.push(EXTENSIONS_SECTION);

  // 3. Available skills (listed for reference — invoked via submit_job)
  const skills = getAllSkills();
  if (skills.length > 0) {
    const entries = skills.slice(0, MAX_DYNAMIC_ENTRIES);
    const lines = entries.map(s => {
      const desc = s.description.length > MAX_DESCRIPTION_LENGTH
        ? s.description.slice(0, MAX_DESCRIPTION_LENGTH) + '...'
        : s.description;
      return `- **${s.id}** — ${s.name}: ${desc}${s.scriptPath ? ` (${s.scriptLanguage})` : ' (markdown-only)'}`;
    });
    const overflow = skills.length > MAX_DYNAMIC_ENTRIES
      ? `\n(${skills.length - MAX_DYNAMIC_ENTRIES} more — use \`system_info({ section: "skills" })\` for full list)`
      : '';
    parts.push(`## Registered Skills — prefer these over native tools\n${lines.join('\n')}${overflow}\nExecute via \`submit_job({ toolName: "execute_skill", payload: { skillId: "<id>", input: "<json>" } })\`.`);
    log('debug', 'Prompt: added skills', { count: skills.length });
  }

  // 4. Available agents (delegated via submit_job + delegate_agent)
  const agents = getAllAgents();
  if (agents.length > 0) {
    const entries = agents.slice(0, MAX_DYNAMIC_ENTRIES);
    const lines = entries.map(a => {
      const desc = a.description.length > MAX_DESCRIPTION_LENGTH
        ? a.description.slice(0, MAX_DESCRIPTION_LENGTH) + '...'
        : a.description;
      return `- **${a.id}** — ${a.name}: ${desc} (model: ${a.models[0]?.model ?? 'default'})`;
    });
    const overflow = agents.length > MAX_DYNAMIC_ENTRIES
      ? `\n(${agents.length - MAX_DYNAMIC_ENTRIES} more — use \`system_info({ section: "agents" })\` for full list)`
      : '';
    parts.push(`## Registered Agents — delegate when one matches\n${lines.join('\n')}${overflow}\nDelegate via \`submit_job({ toolName: "delegate_agent", payload: { agentId: "<id>", task: "..." } })\`.`);
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
