import { access, mkdir, readdir, readFile, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getAllSecrets } from '../core/vault.js';
import { enqueueJob, getQueue, getQueueEvents, type QueueKey } from '@scalyclaw/shared/queue/queue.js';
import { EXECUTION_TIMEOUT_MS, PROCESS_KEY_PREFIX } from '@scalyclaw/shared/const/constants.js';
import { getSkill } from '@scalyclaw/shared/skills/skill-loader.js';
import { runCommandShield } from '../guards/guard.js';
import { PATHS } from '../core/paths.js';
import { randomUUID } from 'node:crypto';
import type { ToolExecutionData } from '@scalyclaw/shared/queue/jobs.js';
import { getConfigRef } from '../core/config.js';
import { checkBudget } from '../core/budget.js';
import { registerTool, executeTool, type ToolContext } from './tool-registry.js';
import { TOOL_NAMES_SET } from './tools.js';
import { requestJobCancel } from '@scalyclaw/shared/queue/cancel.js';

// Ensure all tool handlers are registered (safe: jobs.ts uses lazy import back to tool-impl)
import './tool-registration.js';

export type { ToolContext } from './tool-registry.js';

// ─── Scoped secret resolution ───

let cachedSecretValues: string[] | null = null;
let cachedSecretAge = 0;

/** Redact known secret values from error messages to prevent leakage. */
export async function redactSecrets(text: string): Promise<string> {
  if (!cachedSecretValues || Date.now() - cachedSecretAge > 60_000) {
    try {
      const secrets = await getAllSecrets();
      cachedSecretValues = Object.values(secrets).filter(v => v.length >= 8);
      cachedSecretAge = Date.now();
    } catch {
      if (!cachedSecretValues) return text;
    }
  }
  let safe = text;
  for (const val of cachedSecretValues!) {
    if (safe.includes(val)) {
      safe = safe.replaceAll(val, '[REDACTED]');
    }
  }
  return safe;
}

/** Extract secret names referenced as env-style vars in text. */
function extractSecretRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) refs.add(m[1]);
  for (const m of text.matchAll(/\$([A-Z_][A-Z0-9_]*)\b/g)) refs.add(m[1]);
  return refs;
}

/**
 * Resolve only the vault secrets actually needed by a tool job.
 */
async function resolveNeededSecrets(
  toolName: string,
  payload: Record<string, unknown>,
): Promise<Record<string, string>> {
  const allSecrets = await getAllSecrets();
  if (Object.keys(allSecrets).length === 0) return {};

  let refs = new Set<string>();

  if (toolName === 'execute_skill') {
    const skillId = payload.skillId as string;
    if (skillId) {
      const skill = getSkill(skillId);
      if (skill) {
        refs = extractSecretRefs(skill.markdown);
        const inp = payload.input as string;
        if (inp) for (const r of extractSecretRefs(inp)) refs.add(r);
      }
    }
  } else if (toolName === 'execute_code') {
    const code = payload.code as string;
    if (code) refs = extractSecretRefs(code);
  } else if (toolName === 'execute_command') {
    const cmd = (payload.command ?? payload.code ?? payload.script) as string;
    if (cmd) refs = extractSecretRefs(cmd);
  }

  if (refs.size === 0) return {};

  const scoped: Record<string, string> = {};
  for (const name of refs) {
    if (name in allSecrets) scoped[name] = allSecrets[name];
  }
  return scoped;
}

// ─── Workspace file reference scanning ───

function extractWorkspaceRefs(text: string): string[] {
  const refs = new Set<string>();
  const regex = /workspace\/[^\s"'`\n\r)}\]]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rel = match[0].slice('workspace/'.length);
    if (rel && !rel.includes('..') && !rel.includes('\0')) {
      refs.add(rel);
    }
  }
  return [...refs];
}

async function resolveWorkspaceFiles(
  toolName: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  let text = '';
  if (toolName === 'execute_skill') {
    const inp = payload.input as string;
    if (inp) text = inp;
  } else if (toolName === 'execute_code') {
    const code = payload.code as string;
    if (code) text = code;
  } else if (toolName === 'execute_command') {
    const cmd = (payload.command ?? payload.code ?? payload.script) as string;
    if (cmd) text = cmd;
  }
  if (!text) return [];

  const candidates = extractWorkspaceRefs(text);
  if (candidates.length === 0) return [];

  const existing: string[] = [];
  for (const rel of candidates) {
    const full = resolve(PATHS.workspace, rel);
    if (!full.startsWith(resolve(PATHS.workspace) + '/')) continue;
    try {
      const st = await stat(full);
      if (st.isFile()) existing.push(rel);
    } catch { /* doesn't exist */ }
  }
  return existing;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL ROUTER
// ═══════════════════════════════════════════════════════════════════

/** Tools routed to a specific BullMQ queue; everything else runs locally */
const TOOL_QUEUE: Partial<Record<string, QueueKey>> = {
  execute_command: 'tools',
  execute_skill:   'tools',
  execute_code:    'tools',
  delegate_agent:  'agents',
};

async function enqueueAndWait(
  queueKey: QueueKey,
  toolName: string,
  payload: Record<string, unknown>,
  ctx: ToolContext,
  timeoutMs: number,
): Promise<string> {
  if (queueKey === 'tools') {
    const config = getConfigRef();
    const denied = config.guards.commandShield?.enabled ? config.guards.commandShield.denied : [];
    const secrets = await resolveNeededSecrets(toolName, payload);
    const workspaceFiles = await resolveWorkspaceFiles(toolName, payload);
    payload = {
      ...payload,
      _secrets: secrets,
      _deniedCommands: denied,
      ...(workspaceFiles.length > 0 ? { _workspaceFiles: workspaceFiles } : {}),
    };
  }

  const toolCallId = randomUUID();
  const jobData: ToolExecutionData = {
    toolCallId,
    toolName,
    input: payload,
  };

  const agentData = queueKey === 'agents'
    ? {
        channelId: ctx.channelId,
        task: (payload.task as string) ?? '',
        agentId: (payload.agentId as string) ?? '',
        context: (payload.context as string) ?? '',
      }
    : null;

  if (agentData && !agentData.task) {
    return JSON.stringify({ error: 'delegate_agent requires a "task" parameter describing what the agent should do.' });
  }
  if (agentData && !agentData.agentId) {
    return JSON.stringify({ error: 'delegate_agent requires an "agentId" parameter. Use list_agents to find available agents.' });
  }

  const jobId = await enqueueJob({
    name: queueKey === 'agents' ? 'agent-task' : 'tool-execution',
    data: agentData ?? jobData,
    opts: { attempts: 1, ...(queueKey === 'agents' ? { priority: 1 } : {}) },
  });

  const job = await getQueue(queueKey).getJob(jobId);
  if (!job) {
    return JSON.stringify({ error: `Failed to retrieve job ${jobId}` });
  }

  const events = getQueueEvents(queueKey);

  let result: string;
  try {
    const waitPromise = job.waitUntilFinished(events, timeoutMs);

    if (ctx.signal) {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (ctx.signal!.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        const onAbort = () => reject(new Error('Aborted'));
        ctx.signal!.addEventListener('abort', onAbort, { once: true });
        waitPromise.then(
          () => ctx.signal!.removeEventListener('abort', onAbort),
          () => ctx.signal!.removeEventListener('abort', onAbort),
        );
      });
      result = await Promise.race([waitPromise, abortPromise]) as string;
    } else {
      result = await waitPromise as string;
    }
  } catch (err) {
    await requestJobCancel(jobId).catch(() => {});
    throw err;
  }

  if (queueKey === 'tools') {
    result = await downloadWorkerFiles(result);
  }

  return result;
}

// ─── Worker file bridge ───

async function downloadWorkerFiles(rawResult: string): Promise<string> {
  let outer: Record<string, unknown>;
  try {
    outer = JSON.parse(rawResult);
  } catch {
    return rawResult;
  }

  const stdoutStr = outer.stdout;
  if (typeof stdoutStr !== 'string') return rawResult;

  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(stdoutStr);
  } catch {
    inner = outer;
  }

  const workerFiles = (inner._workerFiles ?? outer._workerFiles) as Array<{ src: string; dest: string }> | undefined;
  const workerProcId = (inner._workerProcessId ?? outer._workerProcessId) as string | undefined;
  if (!Array.isArray(workerFiles) || !workerProcId || workerFiles.length === 0) {
    return rawResult;
  }

  let workerHost: string;
  let workerPort: number;
  let workerToken: string | null;
  let workerTls: boolean;
  try {
    const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
    const redis = getRedis();
    const procData = await redis.get(`${PROCESS_KEY_PREFIX}${workerProcId}`);
    if (!procData) {
      log('warn', 'Worker process not found in registry', { processId: workerProcId });
      return rawResult;
    }
    const procInfo = JSON.parse(procData) as { host: string; port: number; authToken?: string | null; tls?: boolean };
    workerHost = procInfo.host;
    workerPort = procInfo.port;
    workerToken = procInfo.authToken ?? null;
    workerTls = procInfo.tls ?? false;
  } catch (err) {
    log('warn', 'Failed to look up worker process', { processId: workerProcId, error: String(err) });
    return rawResult;
  }

  const protocol = workerTls ? 'https' : 'http';
  const baseUrl = `${protocol}://${workerHost}:${workerPort}`;

  for (const entry of workerFiles) {
    const src = entry.src;
    const dest = entry.dest;
    try {
      const url = `${baseUrl}/api/files?path=${encodeURIComponent(src)}`;
      const headers: Record<string, string> = {};
      if (workerToken) headers['Authorization'] = `Bearer ${workerToken}`;

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        log('warn', `Failed to download worker file: ${src}`, { status: resp.status });
        continue;
      }

      const destPath = resolve(PATHS.workspace, dest);
      if (!destPath.startsWith(resolve(PATHS.workspace) + '/')) {
        log('warn', `Worker file path traversal blocked: ${dest}`);
        continue;
      }
      await mkdir(dirname(destPath), { recursive: true });
      const buffer = Buffer.from(await resp.arrayBuffer());
      await fsWriteFile(destPath, buffer);
      log('info', `Downloaded worker file: ${src} → ${dest}`, { destPath });
    } catch (err) {
      log('warn', `Failed to download worker file: ${src}`, { error: String(err) });
    }
  }

  const destMap = new Map<string, string>();
  for (const entry of workerFiles) {
    const dest = entry.dest;
    if (!dest.startsWith('workspace/') && !dest.startsWith('workspace\\')) {
      destMap.set(dest, `workspace/${dest}`);
    }
  }

  delete outer._workerFiles;
  delete outer._workerProcessId;
  if (inner !== outer) {
    delete inner._workerFiles;
    delete inner._workerProcessId;
    if (destMap.size > 0) rewriteStringValues(inner, destMap);
    outer.stdout = JSON.stringify(inner);
  } else if (destMap.size > 0) {
    rewriteStringValues(outer, destMap);
  }
  return JSON.stringify(outer);
}

function rewriteStringValues(obj: Record<string, unknown>, destMap: Map<string, string>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      const replacement = destMap.get(val);
      if (replacement) obj[key] = replacement;
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (typeof val[i] === 'string') {
          const replacement = destMap.get(val[i]);
          if (replacement) val[i] = replacement;
        } else if (val[i] && typeof val[i] === 'object') {
          rewriteStringValues(val[i] as Record<string, unknown>, destMap);
        }
      }
    } else if (val && typeof val === 'object') {
      rewriteStringValues(val as Record<string, unknown>, destMap);
    }
  }
}

export async function dispatchTool(toolName: string, payload: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  // Command Shield — block dangerous commands before enqueue
  if (toolName === 'execute_command' || toolName === 'execute_code') {
    const commandText = (payload.command ?? payload.code) as string;
    if (commandText) {
      const shieldResult = runCommandShield(commandText);
      if (!shieldResult.passed) {
        log('warn', 'Command blocked by Command Shield', { toolName, reason: shieldResult.reason });
        return JSON.stringify({ error: shieldResult.reason });
      }
    }
  }

  const queueKey = TOOL_QUEUE[toolName];
  if (queueKey) {
    if (queueKey === 'agents') {
      const budgetStatus = checkBudget();
      if (!budgetStatus.allowed) {
        const agentId = payload.agentId as string;
        log('warn', `Agent "${agentId}" blocked by budget limit`);
        return JSON.stringify({
          error: `Budget limit exceeded — daily: $${budgetStatus.currentDayCost.toFixed(2)}/$${budgetStatus.dailyLimit}, monthly: $${budgetStatus.currentMonthCost.toFixed(2)}/$${budgetStatus.monthlyLimit}.`,
        });
      }
      return await enqueueAndWait('agents', toolName, payload, ctx, EXECUTION_TIMEOUT_MS);
    }
    return await enqueueAndWait(queueKey, toolName, payload, ctx, EXECUTION_TIMEOUT_MS);
  }
  if (toolName.startsWith('mcp_')) {
    const { callMcpTool } = await import('../mcp/mcp-manager.js');
    return await callMcpTool(toolName, payload);
  }
  return await executeTool(toolName, payload, ctx);
}

/** Execute an LLM-facing tool */
export async function executeAssistantTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  // Runtime enforcement: block tools not in allowed set (if scoped)
  if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
    log('warn', `Tool "${toolName}" blocked — not in allowed set`, { channelId: ctx.channelId });
    return JSON.stringify({ error: `Tool "${toolName}" is not available to this agent.` });
  }

  if (TOOL_NAMES_SET.has(toolName)) {
    log('info', 'Tool call', { tool: toolName, channelId: ctx.channelId });
    try {
      const result = await dispatchTool(toolName, input, ctx);
      try {
        const p = JSON.parse(result);
        if (p.error) log('warn', `Tool "${toolName}" returned error`, { error: p.error });
      } catch { /* not JSON */ }
      return result;
    } catch (err) {
      log('error', `Tool "${toolName}" threw`, { error: String(err) });
      return JSON.stringify({ error: `Tool "${toolName}" failed: ${String(err)}` });
    }
  }

  if (toolName.startsWith('mcp_')) {
    log('info', 'MCP tool call', { tool: toolName, channelId: ctx.channelId });
    try {
      const { callMcpTool } = await import('../mcp/mcp-manager.js');
      return await callMcpTool(toolName, input);
    } catch (err) {
      log('error', `MCP tool "${toolName}" failed`, { error: String(err) });
      return JSON.stringify({ error: `MCP tool "${toolName}" failed: ${String(err)}` });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
