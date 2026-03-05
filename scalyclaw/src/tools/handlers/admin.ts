import { log } from '@scalyclaw/shared/core/logger.js';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, getConfigRef, saveConfig, updateConfig, publishConfigReload, redactConfig, type ScalyClawConfig } from '../../core/config.js';
import { getAllSkills, getSkill, loadSkills, deleteSkill } from '@scalyclaw/shared/skills/skill-loader.js';
import { publishSkillReload } from '../../skills/skill-store.js';
import { runSkillGuard } from '../../guards/guard.js';
import { PATHS } from '../../core/paths.js';
import { checkBudget, buildModelPricing } from '../../core/budget.js';
import { getUsageStats, getCostStats } from '../../core/db.js';
import { listProcesses } from '@scalyclaw/shared/core/registry.js';
import { getQueue, QUEUE_NAMES, type QueueKey } from '@scalyclaw/shared/queue/queue.js';
import { getConnectionStatuses } from '../../mcp/mcp-manager.js';
import { storeSecret, resolveSecret, deleteSecret, listSecrets } from '../../core/vault.js';

// ─── Model Management ───

export function handleListModels(): string {
  const config = getConfigRef();
  const chatModels = config.models.models.map(m => ({
    id: m.id, name: m.name, provider: m.provider, enabled: m.enabled,
    capabilities: {
      tool: m.toolEnabled, image: m.imageEnabled, audio: m.audioEnabled,
      video: m.videoEnabled, document: m.documentEnabled, reasoning: m.reasoningEnabled,
    },
  }));
  const embeddingModels = config.models.embeddingModels.map(m => ({
    id: m.id, name: m.name, provider: m.provider, enabled: m.enabled,
    dimensions: m.dimensions,
  }));
  return JSON.stringify({ chatModels, embeddingModels });
}

export async function handleToggleModel(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  const enabled = input.enabled as boolean;
  if (!id || typeof enabled !== 'boolean') {
    return JSON.stringify({ error: 'Missing required fields: id, enabled' });
  }

  const config = getConfig();
  const chat = config.models.models.find(m => m.id === id);
  const embed = config.models.embeddingModels.find(m => m.id === id);
  if (!chat && !embed) {
    return JSON.stringify({ error: `Model "${id}" not found` });
  }
  if (chat) chat.enabled = enabled;
  if (embed) embed.enabled = enabled;
  await saveConfig(config);
  await publishConfigReload().catch(err => log('warn', 'Failed to publish config reload', { error: String(err) }));
  return JSON.stringify({ toggled: true, id, enabled });
}

// ─── Skill Management ───

export function handleListSkills(): string {
  const config = getConfigRef();
  const loaded = getAllSkills();
  const skills = loaded.map(s => {
    const configEntry = config.skills.find(cs => cs.id === s.id);
    return {
      id: s.id, name: s.name, description: s.description,
      enabled: configEntry?.enabled ?? true,
      hasScript: !!s.scriptPath,
      language: s.scriptLanguage,
    };
  });
  return JSON.stringify({ skills });
}

export async function handleToggleSkill(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  const enabled = input.enabled as boolean;
  if (!id || typeof enabled !== 'boolean') {
    return JSON.stringify({ error: 'Missing required fields: id, enabled' });
  }

  const config = getConfig();
  const idx = config.skills.findIndex(s => s.id === id);
  if (idx >= 0) {
    config.skills[idx].enabled = enabled;
  } else {
    config.skills.push({ id, enabled });
  }
  await saveConfig(config);
  await publishSkillReload().catch(err => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  return JSON.stringify({ toggled: true, id, enabled });
}

export async function handleDeleteSkill(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  if (!id) return JSON.stringify({ error: 'Missing required field: id' });

  log('debug', 'delete_skill', { id });

  try {
    await deleteSkill(id);
    const config = getConfig();
    config.skills = config.skills.filter(s => s.id !== id);
    await saveConfig(config);
    await publishSkillReload().catch(err => log('warn', 'Failed to publish skill reload', { error: String(err) }));
    return JSON.stringify({ deleted: true, id });
  } catch (err) {
    log('error', 'delete_skill failed', { error: String(err) });
    return JSON.stringify({ error: `Failed to delete skill: ${String(err)}` });
  }
}

export async function handleRegisterSkill(input: Record<string, unknown>): Promise<string> {
  let id = input.id as string;
  if (!id) return JSON.stringify({ error: 'Missing required field: id' });

  if (!id.endsWith('-skill')) id = `${id}-skill`;

  log('info', 'register_skill', { id });

  const skillDir = join(PATHS.skills, id);
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    await access(skillMdPath);
  } catch {
    return JSON.stringify({ error: `SKILL.md not found at skills/${id}/SKILL.md — write the file first.` });
  }

  await loadSkills();

  const skill = getSkill(id);
  if (!skill) {
    return JSON.stringify({ error: `Skill "${id}" failed to load after reload. Check SKILL.md frontmatter.` });
  }
  if (!skill.scriptPath || !skill.scriptLanguage) {
    return JSON.stringify({ error: `Skill "${id}" is missing "script" or "language" in SKILL.md frontmatter.` });
  }

  let scriptContents: string | undefined;
  try {
    const entries = await readdir(skillDir, { recursive: true, withFileTypes: true });
    const parts: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === 'SKILL.md') continue;
      const entryPath = join(entry.parentPath ?? entry.path, entry.name);
      const content = await readFile(entryPath, 'utf-8');
      const relPath = entryPath.slice(skillDir.length + 1);
      parts.push(`### ${relPath}\n\`\`\`\n${content}\n\`\`\``);
    }
    if (parts.length > 0) scriptContents = parts.join('\n\n');
  } catch (err) {
    log('warn', 'register_skill: failed to read script files for guard', { error: String(err) });
  }

  try {
    const guardResult = await runSkillGuard(id, skill.markdown, scriptContents);
    if (!guardResult.passed) {
      await deleteSkill(id);
      return JSON.stringify({
        error: `Skill guard rejected "${id}": ${guardResult.reason ?? 'security violation'}`,
        guardResult,
      });
    }
  } catch (err) {
    log('error', 'register_skill: guard threw', { error: String(err) });
    return JSON.stringify({ error: `Skill guard error: ${String(err)}` });
  }

  const config = getConfig();
  const idx = config.skills.findIndex(s => s.id === id);
  if (idx >= 0) {
    config.skills[idx].enabled = true;
  } else {
    config.skills.push({ id, enabled: true });
  }
  await saveConfig(config);

  await publishSkillReload().catch(err => log('warn', 'Failed to publish skill reload', { error: String(err) }));

  log('info', 'register_skill complete', { id });
  return JSON.stringify({
    registered: true,
    id,
    name: skill.name,
    description: skill.description,
    language: skill.scriptLanguage,
  });
}

// ─── Guards ───

export function handleListGuards(): string {
  const config = getConfigRef();
  const g = config.guards;
  return JSON.stringify({
    guards: {
      message: {
        enabled: g.message.enabled,
        model: g.message.model,
        echoGuard: g.message.echoGuard,
        contentGuard: g.message.contentGuard,
      },
      skill: { enabled: g.skill.enabled, model: g.skill.model },
      agent: { enabled: g.agent.enabled, model: g.agent.model },
      commandShield: {
        enabled: g.commandShield.enabled,
        deniedCount: g.commandShield.denied.length,
        allowedCount: g.commandShield.allowed.length,
      },
    },
  });
}

export async function handleToggleGuard(input: Record<string, unknown>): Promise<string> {
  const guard = input.guard as string;
  const enabled = input.enabled as boolean;
  if (!guard || typeof enabled !== 'boolean') {
    return JSON.stringify({ error: 'Missing required fields: guard, enabled' });
  }
  if (guard !== 'message' && guard !== 'skill' && guard !== 'agent' && guard !== 'commandShield') {
    return JSON.stringify({ error: `Invalid guard: "${guard}". Must be message, skill, agent, or commandShield.` });
  }

  await updateConfig(draft => {
    if (guard === 'commandShield') {
      draft.guards.commandShield.enabled = enabled;
    } else {
      draft.guards[guard].enabled = enabled;
    }
  });
  await publishConfigReload().catch(err => log('warn', 'Failed to publish config reload', { error: String(err) }));
  return JSON.stringify({ toggled: true, guard, enabled });
}

// ─── Config ───

export function handleGetConfig(input: Record<string, unknown>): string {
  const config = getConfigRef();
  const redacted = redactConfig(config);
  const section = input.section as string | undefined;
  if (section) {
    if (!(section in redacted)) {
      return JSON.stringify({ error: `Unknown config section: "${section}"` });
    }
    return JSON.stringify({ section, config: (redacted as Record<string, unknown>)[section] });
  }
  return JSON.stringify({ config: redacted });
}

const IMMUTABLE_CONFIG_FIELDS: Record<string, string[]> = {
  gateway: ['authType', 'authValue', 'tls', 'bind', 'host', 'port'],
  guards: ['message.enabled', 'skill.enabled', 'agent.enabled', 'commandShield.enabled', 'commandShield.denied'],
};

function checkImmutableFields(section: string, values: Record<string, unknown>): string | null {
  const blocked = IMMUTABLE_CONFIG_FIELDS[section];
  if (!blocked) return null;
  for (const field of blocked) {
    const parts = field.split('.');
    if (parts.length === 1) {
      if (parts[0] in values) return `${section}.${field}`;
    } else {
      const top = values[parts[0]];
      if (top !== undefined && typeof top === 'object' && top !== null && parts[1] in (top as Record<string, unknown>)) {
        return `${section}.${field}`;
      }
    }
  }
  return null;
}

export async function handleUpdateConfig(input: Record<string, unknown>): Promise<string> {
  const section = input.section as string;
  const values = input.values as Record<string, unknown>;
  if (!section || !values || typeof values !== 'object') {
    return JSON.stringify({ error: 'Missing required fields: section, values' });
  }

  const config = getConfigRef();
  if (!(section in config)) {
    return JSON.stringify({ error: `Unknown config section: "${section}"` });
  }

  const protectedField = checkImmutableFields(section, values);
  if (protectedField) {
    return JSON.stringify({ error: `Cannot modify protected field: ${protectedField}` });
  }

  await updateConfig(draft => {
    const target = draft[section as keyof ScalyClawConfig];
    if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
      Object.assign(target, values);
    }
  });
  await publishConfigReload().catch(err => log('warn', 'Failed to publish config reload', { error: String(err) }));
  return JSON.stringify({ updated: true, section });
}

// ─── Usage ───

export function handleGetUsage(): string {
  const pricing = buildModelPricing();
  const budget = checkBudget();
  const costStats = getCostStats(pricing);
  const usageStats = getUsageStats();

  return JSON.stringify({
    budget: {
      dailyLimit: budget.dailyLimit,
      monthlyLimit: budget.monthlyLimit,
      hardLimit: budget.hardLimit,
      currentDayCost: Math.round(budget.currentDayCost * 10000) / 10000,
      currentMonthCost: Math.round(budget.currentMonthCost * 10000) / 10000,
    },
    today: {
      cost: Math.round(costStats.currentDayCost * 10000) / 10000,
      inputTokens: usageStats.byDay.find(d => d.date === new Date().toISOString().slice(0, 10))?.inputTokens ?? 0,
      outputTokens: usageStats.byDay.find(d => d.date === new Date().toISOString().slice(0, 10))?.outputTokens ?? 0,
    },
    month: {
      cost: Math.round(costStats.currentMonthCost * 10000) / 10000,
      inputTokens: usageStats.totalInputTokens,
      outputTokens: usageStats.totalOutputTokens,
    },
    byModel: costStats.byModel.map(m => ({
      model: m.model,
      provider: m.provider,
      calls: m.calls,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cost: Math.round(m.totalCost * 10000) / 10000,
    })),
    byType: usageStats.byType,
    messageCount: usageStats.messageCount,
  });
}

// ─── Queue/Process Management ───

export async function handleListQueues(): Promise<string> {
  const results: Record<string, unknown>[] = [];
  for (const [key, name] of Object.entries(QUEUE_NAMES)) {
    const q = getQueue(key as QueueKey);
    const counts = await q.getJobCounts();
    const isPaused = await q.isPaused();
    results.push({ key, name, paused: isPaused, ...counts });
  }
  return JSON.stringify({ queues: results });
}

export async function handlePauseQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  if (!queueKey || !(queueKey in QUEUE_NAMES)) {
    return JSON.stringify({ error: `Invalid queue key: "${queueKey}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}` });
  }
  const q = getQueue(queueKey as QueueKey);
  await q.pause();
  log('info', `Queue paused: ${queueKey}`);
  return JSON.stringify({ paused: true, queue: queueKey });
}

export async function handleResumeQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  if (!queueKey || !(queueKey in QUEUE_NAMES)) {
    return JSON.stringify({ error: `Invalid queue key: "${queueKey}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}` });
  }
  const q = getQueue(queueKey as QueueKey);
  await q.resume();
  log('info', `Queue resumed: ${queueKey}`);
  return JSON.stringify({ resumed: true, queue: queueKey });
}

export async function handleCleanQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  const status = input.status as string;
  const age = (input.age as number) ?? 86_400_000;

  if (!queueKey || !(queueKey in QUEUE_NAMES)) {
    return JSON.stringify({ error: `Invalid queue key: "${queueKey}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}` });
  }
  if (status !== 'completed' && status !== 'failed') {
    return JSON.stringify({ error: `Invalid status: "${status}". Must be "completed" or "failed".` });
  }

  const q = getQueue(queueKey as QueueKey);
  const removed = await q.clean(age, 1000, status);
  log('info', `Queue cleaned: ${queueKey}`, { status, age, removedCount: removed.length });
  return JSON.stringify({ cleaned: true, queue: queueKey, status, removedCount: removed.length });
}

// ─── Vault ───

export { storeSecret, resolveSecret, deleteSecret, listSecrets };
export { listProcesses };
