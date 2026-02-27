import { getConfigRef } from '../core/config.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { recordUsage } from '../core/db.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { similarity } from './similarity.js';
import {
  ECHO_GUARD_SYSTEM_PROMPT,
  CONTENT_SECURITY_SYSTEM_PROMPT,
  SKILL_GUARD_SYSTEM_PROMPT,
  AGENT_GUARD_SYSTEM_PROMPT,
} from '../prompt/guard.js';
import type { GuardResult } from './types.js';

// ─── Internal helper ───

interface SecurityAnalysis {
  safe: boolean;
  reason: string;
  threats: string[];
}

function resolveGuardModel(model?: string): string {
  if (model) return model;
  const config = getConfigRef();
  const selected = selectModel(
    config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })),
  );
  if (!selected) throw new Error('No enabled chat model available for guard');
  return selected;
}

async function guardLlmCall(systemPrompt: string, userContent: string, guardModel?: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const modelId = resolveGuardModel(guardModel);
  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);

  const response = await provider.chat({
    model,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    temperature: 0.0,
    maxTokens: 1024,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'guard',
  });

  return {
    text: response.content,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

function parseSecurityResponse(text: string): SecurityAnalysis {
  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in guard response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.safe !== 'boolean') throw new Error('Missing "safe" field in guard response');

  return {
    safe: parsed.safe,
    reason: parsed.reason ?? '',
    threats: Array.isArray(parsed.threats) ? parsed.threats : [],
  };
}

// ─── Guard Layers ───

async function runEchoGuard(
  text: string,
  echoGuard: { similarityThreshold?: number },
  model: string | undefined,
  start: number,
): Promise<GuardResult | null> {
  try {
    const threshold = echoGuard.similarityThreshold ?? 0.8;
    const response = await guardLlmCall(ECHO_GUARD_SYSTEM_PROMPT, text, model);
    const score = similarity(text, response.text);

    log('info', 'Echo guard result', { score: score.toFixed(3), threshold, inputLength: text.length });

    if (score < threshold) {
      return {
        passed: false,
        guardType: 'message',
        failedLayer: 'echo',
        reason: `Echo similarity ${score.toFixed(3)} below threshold ${threshold}`,
        score,
        durationMs: Date.now() - start,
      };
    }
    return null;
  } catch (err) {
    log('error', 'Echo guard LLM call failed — blocking message (fail-closed)', { error: String(err) });
    return {
      passed: false,
      guardType: 'message',
      failedLayer: 'echo',
      reason: `Echo guard error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

async function runContentGuard(
  text: string,
  model: string | undefined,
  start: number,
): Promise<GuardResult | null> {
  try {
    const response = await guardLlmCall(CONTENT_SECURITY_SYSTEM_PROMPT, text, model);
    const analysis = parseSecurityResponse(response.text);

    log('info', 'Content guard result', { safe: analysis.safe, threats: analysis.threats });

    if (!analysis.safe) {
      return {
        passed: false,
        guardType: 'message',
        failedLayer: 'content',
        reason: analysis.reason,
        durationMs: Date.now() - start,
      };
    }
    return null;
  } catch (err) {
    log('error', 'Content guard failed — blocking message (fail-closed)', { error: String(err) });
    return {
      passed: false,
      guardType: 'message',
      failedLayer: 'content',
      reason: `Content guard error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Command Shield (deterministic, no LLM) ───

export function runCommandShield(text: string, overrideDenied?: string[]): GuardResult {
  const start = Date.now();
  const config = getConfigRef();
  const shield = config.guards.commandShield;

  if (!shield?.enabled) {
    return { passed: true, guardType: 'command', durationMs: Date.now() - start };
  }

  const denied = overrideDenied ?? shield.denied;
  const lower = text.toLowerCase();

  for (const pattern of denied) {
    if (lower.includes(pattern.toLowerCase())) {
      return {
        passed: false,
        guardType: 'command',
        failedLayer: 'denied',
        reason: `Command blocked: matches denied pattern "${pattern}"`,
        durationMs: Date.now() - start,
      };
    }
  }

  if (shield.allowed.length > 0) {
    const isAllowed = shield.allowed.some(p => lower.includes(p.toLowerCase()));
    if (!isAllowed) {
      return {
        passed: false,
        guardType: 'command',
        failedLayer: 'allowed',
        reason: 'Command blocked: does not match any allowed pattern',
        durationMs: Date.now() - start,
      };
    }
  }

  return { passed: true, guardType: 'command', durationMs: Date.now() - start };
}

// ─── Response Echo Guard ───

export async function runResponseEchoGuard(text: string): Promise<GuardResult> {
  const start = Date.now();
  const config = getConfigRef();

  if (!config.guards?.message?.enabled || !config.guards.message.echoGuard?.enabled) {
    return { passed: true, guardType: 'message', durationMs: Date.now() - start };
  }

  const { model, echoGuard } = config.guards.message;
  const result = await runEchoGuard(text, echoGuard, model, start);
  if (result && !result.passed) return result;

  return { passed: true, guardType: 'message', durationMs: Date.now() - start };
}

// ─── Message Guard ───

export async function runMessageGuard(text: string): Promise<GuardResult> {
  const start = Date.now();
  const config = getConfigRef();

  if (!config.guards?.message?.enabled) {
    return { passed: true, guardType: 'message', durationMs: Date.now() - start };
  }

  const { model, echoGuard, contentGuard } = config.guards.message;
  log('info', 'Running message guard', {
    echoGuard: !!echoGuard?.enabled,
    contentGuard: !!contentGuard?.enabled,
    model: model || '(default)',
  });

  // Run echo + content guards in parallel when both are enabled
  const tasks: Array<Promise<GuardResult | null>> = [];

  if (echoGuard?.enabled) {
    tasks.push(runEchoGuard(text, echoGuard, model, start));
  }
  if (contentGuard?.enabled) {
    tasks.push(runContentGuard(text, model, start));
  }

  const results = await Promise.all(tasks);
  for (const r of results) {
    if (r && !r.passed) return r;
  }

  const durationMs = Date.now() - start;
  log('info', 'Message guard passed', { durationMs });
  return { passed: true, guardType: 'message', durationMs };
}

// ─── Skill Guard ───

export async function runSkillGuard(
  skillId: string,
  markdown: string,
  scriptContents?: string,
): Promise<GuardResult> {
  const start = Date.now();
  const config = getConfigRef();

  if (!config.guards?.skill?.enabled) {
    return { passed: true, guardType: 'skill', durationMs: Date.now() - start };
  }

  const { model } = config.guards.skill;
  const parts = [`# Skill: ${skillId}\n\n## SKILL.md\n${markdown}`];
  if (scriptContents) {
    parts.push(`\n## Script Contents\n\`\`\`\n${scriptContents}\n\`\`\``);
  }

  try {
    const response = await guardLlmCall(SKILL_GUARD_SYSTEM_PROMPT, parts.join('\n'), model);
    const analysis = parseSecurityResponse(response.text);

    log('info', 'Skill guard result', { skillId, safe: analysis.safe, threats: analysis.threats });

    if (!analysis.safe) {
      return {
        passed: false,
        guardType: 'skill',
        failedLayer: 'skill',
        reason: analysis.reason,
        durationMs: Date.now() - start,
      };
    }

    return { passed: true, guardType: 'skill', durationMs: Date.now() - start };
  } catch (err) {
    log('error', 'Skill guard failed — blocking skill (fail-closed)', { skillId, error: String(err) });
    return {
      passed: false,
      guardType: 'skill',
      failedLayer: 'skill',
      reason: `Skill guard error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Agent Guard ───

export async function runAgentGuard(
  agentId: string,
  definition: { name: string; description: string; systemPrompt: string; skills?: string[] },
): Promise<GuardResult> {
  const start = Date.now();
  const config = getConfigRef();

  if (!config.guards?.agent?.enabled) {
    return { passed: true, guardType: 'agent', durationMs: Date.now() - start };
  }

  const { model } = config.guards.agent;
  const content = [
    `# Agent: ${agentId}`,
    `**Name:** ${definition.name}`,
    `**Description:** ${definition.description}`,
    `**Skills:** ${definition.skills?.join(', ') || 'none'}`,
    `\n## System Prompt\n${definition.systemPrompt}`,
  ].join('\n');

  try {
    const response = await guardLlmCall(AGENT_GUARD_SYSTEM_PROMPT, content, model);
    const analysis = parseSecurityResponse(response.text);

    log('info', 'Agent guard result', { agentId, safe: analysis.safe, threats: analysis.threats });

    if (!analysis.safe) {
      return {
        passed: false,
        guardType: 'agent',
        failedLayer: 'agent',
        reason: analysis.reason,
        durationMs: Date.now() - start,
      };
    }

    return { passed: true, guardType: 'agent', durationMs: Date.now() - start };
  } catch (err) {
    log('error', 'Agent guard failed — blocking agent (fail-closed)', { agentId, error: String(err) });
    return {
      passed: false,
      guardType: 'agent',
      failedLayer: 'agent',
      reason: `Agent guard error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}
