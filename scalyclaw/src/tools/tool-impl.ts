import { access, mkdir, readdir, readFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { log } from '@scalyclaw/shared/core/logger.js';
import { storeSecret, resolveSecret, deleteSecret, listSecrets, getAllSecrets } from '../core/vault.js';
import { storeMemory, searchMemory, recallMemory, deleteMemory, updateMemory } from '../memory/memory.js';
import { createReminder, createRecurrentReminder, createTask, createRecurrentTask, listReminders, listTasks, cancelReminder, cancelTask } from '../scheduler/scheduler.js';
import { enqueueJob, getQueue, getQueueEvents, QUEUE_NAMES, type QueueKey } from '@scalyclaw/shared/queue/queue.js';
import { getAllAgents, loadAllAgents, createAgent, updateAgent, deleteAgent } from '../agents/agent-loader.js';
import { readWorkspaceFile, writeWorkspaceFile, readWorkspaceFileLines, appendWorkspaceFile, patchWorkspaceFile, diffWorkspaceFiles, getFileInfo, copyWorkspaceFile, copyWorkspaceFolder, deleteWorkspaceFile, deleteWorkspaceFolder, renameWorkspaceFile, renameWorkspaceFolder, resolveFilePath } from '../core/workspace.js';
import { getAllSkills, getSkill, loadSkills, deleteSkill } from '@scalyclaw/shared/skills/skill-loader.js';
import { runSkillGuard } from '../guards/guard.js';
import { publishSkillReload } from '../skills/skill-store.js';
import { publishAgentReload } from '../agents/agent-store.js';
import { publishProgress } from '../queue/progress.js';
import { PATHS } from '../core/paths.js';
import { randomUUID } from 'node:crypto';
import type { ToolExecutionData } from '@scalyclaw/shared/queue/jobs.js';
import { getConfig, getConfigRef, saveConfig, updateConfig, publishConfigReload, redactConfig, type ScalyClawConfig } from '../core/config.js';
import { listProcesses } from '@scalyclaw/shared/core/registry.js';
import { checkBudget, buildModelPricing } from '../core/budget.js';
import { getUsageStats, getCostStats } from '../core/db.js';
import { registerTool, executeTool, type ToolContext } from './tool-registry.js';
import { DIRECT_TOOL_NAMES_SET } from './tools.js';
import { COMPACT_CONTEXT_PROMPT } from '../prompt/compact.js';
import { requestJobCancel } from '@scalyclaw/shared/queue/cancel.js';

export type { ToolContext } from './tool-registry.js';

// ═══════════════════════════════════════════════════════════════════
// TOOL ROUTER — dispatches by tool name to the right execution path
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
  // Resolve secrets on orchestrator and pass in job data for remote workers
  if (queueKey === 'tools') {
    const secrets = await getAllSecrets();
    payload = { ...payload, _secrets: secrets };
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

  // Race the BullMQ wait against the AbortSignal so cancellation is responsive
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
        // Clean up listener if waitPromise settles first
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
    // On abort or timeout, cancel the worker-side job so it doesn't run forever
    await requestJobCancel(jobId).catch(() => {});
    throw err;
  }

  // Bridge worker files to node workspace if annotated
  if (queueKey === 'tools') {
    result = await downloadWorkerFiles(result);
  }

  return result;
}

// ─── Worker file bridge ───

/**
 * After receiving a tools-queue result, check if the worker annotated it
 * with _workerFiles / _workerProcessId. If so, download each file from
 * the worker's /api/files endpoint and save to the local workspace.
 */
async function downloadWorkerFiles(rawResult: string): Promise<string> {
  let outer: Record<string, unknown>;
  try {
    outer = JSON.parse(rawResult);
  } catch {
    return rawResult;
  }

  // The result may have stdout as a JSON string (skill execution result)
  const stdoutStr = outer.stdout;
  if (typeof stdoutStr !== 'string') return rawResult;

  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(stdoutStr);
  } catch {
    // stdout may not be JSON (e.g. plain text) — check outer level directly
    inner = outer;
  }

  // Check both inner (parsed stdout) and outer levels for worker annotations
  const workerFiles = (inner._workerFiles ?? outer._workerFiles) as Array<{ src: string; dest: string }> | undefined;
  const workerProcId = (inner._workerProcessId ?? outer._workerProcessId) as string | undefined;
  if (!Array.isArray(workerFiles) || !workerProcId || workerFiles.length === 0) {
    return rawResult;
  }

  // Look up worker in Redis registry
  let workerHost: string;
  let workerPort: number;
  let workerToken: string | null;
  try {
    const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
    const redis = getRedis();
    const procData = await redis.get(`scalyclaw:proc:${workerProcId}`);
    if (!procData) {
      log('warn', 'Worker process not found in registry', { processId: workerProcId });
      return rawResult;
    }
    const procInfo = JSON.parse(procData) as { host: string; port: number; authToken?: string | null };
    workerHost = procInfo.host;
    workerPort = procInfo.port;
    workerToken = procInfo.authToken ?? null;
  } catch (err) {
    log('warn', 'Failed to look up worker process', { processId: workerProcId, error: String(err) });
    return rawResult;
  }

  const protocol = 'http';
  const baseUrl = `${protocol}://${workerHost}:${workerPort}`;

  // Download each file (entries are { src, dest } objects)
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
      // Path traversal protection: ensure destination stays within workspace
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

  // Strip _workerFiles and _workerProcessId from both levels
  delete outer._workerFiles;
  delete outer._workerProcessId;
  if (inner !== outer) {
    delete inner._workerFiles;
    delete inner._workerProcessId;
    outer.stdout = JSON.stringify(inner);
  }
  return JSON.stringify(outer);
}

async function dispatchTool(toolName: string, payload: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const queueKey = TOOL_QUEUE[toolName];
  if (queueKey) {
    if (queueKey === 'agents') {
      // Budget enforcement — checked here on orchestrator (workers are stateless, no DB)
      const budgetStatus = checkBudget();
      if (!budgetStatus.allowed) {
        const agentId = payload.agentId as string;
        log('warn', `Agent "${agentId}" blocked by budget limit`);
        return JSON.stringify({
          error: `Budget limit exceeded — daily: $${budgetStatus.currentDayCost.toFixed(2)}/$${budgetStatus.dailyLimit}, monthly: $${budgetStatus.currentMonthCost.toFixed(2)}/$${budgetStatus.monthlyLimit}.`,
        });
      }
      return await enqueueAndWait('agents', toolName, payload, ctx, 300_000);
    }
    return await enqueueAndWait(queueKey, toolName, payload, ctx, 300_000);
  }
  if (toolName.startsWith('mcp_')) {
    const { callMcpTool } = await import('../mcp/mcp-manager.js');
    return await callMcpTool(toolName, payload);
  }
  return await executeTool(toolName, payload, ctx);
}

// ═══════════════════════════════════════════════════════════════════
// LLM-FACING TOOL HANDLERS (the 3 submission methods)
// ═══════════════════════════════════════════════════════════════════

async function handleSubmitJob(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const toolName = input.toolName as string;
  const payload = (input.payload as Record<string, unknown>) ?? {};
  if (!toolName) return JSON.stringify({ error: 'Missing required field: toolName' });

  // Runtime enforcement: block inner tool names not in allowed set
  if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
    log('warn', `Job tool "${toolName}" blocked — not in allowed set`, { channelId: ctx.channelId });
    return JSON.stringify({ error: `Tool "${toolName}" is not available to this agent.` });
  }

  // Server-side skill enforcement for scoped agents
  if (toolName === 'execute_skill' && ctx.allowedSkillIds) {
    const skillId = payload.skillId as string;
    if (!ctx.allowedSkillIds.includes(skillId)) {
      return JSON.stringify({ error: `Skill "${skillId}" is not available to this agent.` });
    }
  }

  log('info', 'Tool call', { tool: toolName, payload, channelId: ctx.channelId });
  try {
    const result = await dispatchTool(toolName, payload, ctx);
    // Log errors returned as JSON (not thrown)
    try {
      const parsed = JSON.parse(result);
      if (parsed.error) {
        log('warn', `Tool "${toolName}" returned error`, { error: parsed.error, payload });
      }
    } catch { /* not JSON, that's fine */ }
    return result;
  } catch (err) {
    log('error', `Tool "${toolName}" threw`, { error: String(err), payload });
    return JSON.stringify({ error: `Tool "${toolName}" failed: ${String(err)}` });
  }
}

async function handleSubmitParallelJobs(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const jobs = input.jobs as Array<{ toolName: string; payload?: Record<string, unknown> }>;
  if (!Array.isArray(jobs) || jobs.length === 0) return JSON.stringify({ error: 'Missing or empty: jobs' });

  log('debug', 'submit_parallel_jobs', { count: jobs.length, channelId: ctx.channelId });
  const results = await Promise.all(
    jobs.map(async (j, i) => {
      try {
        const result = await dispatchTool(j.toolName, j.payload ?? {}, ctx);
        return { index: i, toolName: j.toolName, result };
      } catch (err) {
        return { index: i, toolName: j.toolName, error: String(err) };
      }
    })
  );
  return JSON.stringify({ results });
}

// ═══════════════════════════════════════════════════════════════════
// JOB MANAGEMENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

async function handleGetJobInfo(input: Record<string, unknown>): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });

  log('debug', 'get_job', { jobId });
  const { getJobStatus } = await import('@scalyclaw/shared/queue/queue.js');
  const info = await getJobStatus(jobId);
  return JSON.stringify(info);
}

async function handleListActiveJobs(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as QueueKey | undefined;
  const status = input.status as string | undefined;
  const limit = (input.limit as number) ?? 20;

  // BullMQ v5: 'prioritized' jobs are logically 'waiting' — include both
  const baseStatuses = status
    ? [status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed']
    : ['waiting', 'active', 'delayed'] as const;
  const statuses = baseStatuses.includes('waiting' as any)
    ? [...baseStatuses, 'prioritized' as any]
    : [...baseStatuses];

  const queuesToSearch = queueKey
    ? [{ key: queueKey, q: getQueue(queueKey) }]
    : Object.keys(QUEUE_NAMES).map(k => ({ key: k, q: getQueue(k as QueueKey) }));

  const jobs: Record<string, unknown>[] = [];
  for (const { key, q } of queuesToSearch) {
    const qJobs = await q.getJobs(statuses, 0, limit - 1);
    for (const j of qJobs) {
      const state = await j.getState();
      jobs.push({
        id: j.id,
        queue: key,
        name: j.name,
        state: state === 'prioritized' ? 'waiting' : state,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
      });
      if (jobs.length >= limit) break;
    }
    if (jobs.length >= limit) break;
  }

  log('debug', 'list_active_jobs', { count: jobs.length, queueKey, status });
  return JSON.stringify({ jobs });
}

async function handleStopJob(input: Record<string, unknown>): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });

  log('debug', 'stop_job', { jobId });

  const { getJobStatus } = await import('@scalyclaw/shared/queue/queue.js');
  const info = await getJobStatus(jobId);
  if (info.state === 'not_found') {
    return JSON.stringify({ error: `Job "${jobId}" not found`, jobId });
  }

  if (info.state === 'completed' || info.state === 'failed') {
    return JSON.stringify({ stopped: false, jobId, reason: `Job already in terminal state: ${info.state}` });
  }

  await requestJobCancel(jobId);
  log('info', 'Job stop requested', { jobId, previousState: info.state });
  return JSON.stringify({ stopped: true, jobId, previousState: info.state });
}

/** Meta tools that always pass through — infrastructure, not selectable */
const META_TOOLS = new Set(['submit_job', 'submit_parallel_jobs', 'get_job', 'list_active_jobs', 'stop_job']);

/** Execute an LLM-facing tool (direct dispatch + meta tools) */
export async function executeAssistantTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  // Runtime enforcement: block tools not in allowed set (if scoped)
  if (ctx.allowedToolNames && !META_TOOLS.has(toolName) && !ctx.allowedToolNames.has(toolName)) {
    log('warn', `Tool "${toolName}" blocked — not in allowed set`, { channelId: ctx.channelId });
    return JSON.stringify({ error: `Tool "${toolName}" is not available to this agent.` });
  }

  // Direct tools → dispatchTool (handles TOOL_QUEUE routing + local executeTool)
  if (DIRECT_TOOL_NAMES_SET.has(toolName)) {
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

  // MCP tools — first-class tool calls (LLM calls them directly by name)
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

  // Meta tools
  switch (toolName) {
    case 'submit_job':              return await handleSubmitJob(input, ctx);
    case 'submit_parallel_jobs':    return await handleSubmitParallelJobs(input, ctx);
    case 'get_job':                 return await handleGetJobInfo(input);
    case 'list_active_jobs':        return await handleListActiveJobs(input);
    case 'stop_job':                return await handleStopJob(input);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════

// ─── Memory ───

async function handleMemoryStore(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const type = input.type as string;
  const subject = input.subject as string;
  const content = input.content as string;
  const tags = (input.tags as string[] | undefined) ?? [];
  const confidence = (input.confidence as number | undefined) ?? 2;
  const ttl = input.ttl as string | undefined;

  const rawSource = input.source as string | undefined;
  const source = rawSource === 'user-stated' || rawSource === 'inferred' ? rawSource : ctx.channelId;

  log('debug', 'memory_store', { type, subject, contentLength: content?.length, tags, ttl });

  // Dedup: search for very similar existing memories before storing
  try {
    const existing = await searchMemory(subject + ' ' + content, { topK: 3, type });
    const duplicate = existing.find((r) => r.score >= 0.92);
    if (duplicate) {
      log('debug', 'memory_store skipped — duplicate found', { existingId: duplicate.id, score: duplicate.score });
      return JSON.stringify({ stored: false, duplicate: true, existingId: duplicate.id, existingSubject: duplicate.subject });
    }
  } catch {
    // If search fails, proceed with store anyway
  }

  const id = await storeMemory({ type, subject, content, tags, source, confidence, ttl });
  log('debug', 'memory_store result', { id });
  return JSON.stringify({ stored: true, id });
}

async function handleMemorySearch(input: Record<string, unknown>): Promise<string> {
  log('debug', 'memory_search', { query: input.query, type: input.type, tags: input.tags, topK: input.topK });
  const results = await searchMemory(input.query as string, {
    type: input.type as string | undefined,
    tags: input.tags as string[] | undefined,
    topK: input.topK as number | undefined,
  });
  log('debug', 'memory_search result', { resultCount: results.length });
  return JSON.stringify({ results });
}

async function handleMemoryRecall(input: Record<string, unknown>): Promise<string> {
  log('debug', 'memory_recall', { id: input.id, type: input.type, tags: input.tags });
  const results = recallMemory(
    input.id as string | undefined,
    {
      type: input.type as string | undefined,
      tags: input.tags as string[] | undefined,
    }
  );
  log('debug', 'memory_recall result', { resultCount: results.length });
  return JSON.stringify({ results });
}

async function handleMemoryUpdate(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  log('debug', 'memory_update', { id });

  const updates: Record<string, unknown> = {};
  if (input.subject !== undefined) updates.subject = input.subject as string;
  if (input.content !== undefined) updates.content = input.content as string;
  if (input.tags !== undefined) updates.tags = input.tags as string[];
  if (input.confidence !== undefined) updates.confidence = input.confidence as number;

  const updated = await updateMemory(id, updates);
  log('debug', 'memory_update result', { id, updated });
  if (!updated) return JSON.stringify({ error: 'Memory not found', id });
  return JSON.stringify({ updated: true, id });
}

function handleMemoryDelete(input: Record<string, unknown>): string {
  const id = input.id as string;
  log('debug', 'memory_delete', { id });
  const deleted = deleteMemory(id);
  log('debug', 'memory_delete result', { id, deleted });
  return JSON.stringify({ deleted, id });
}

// ─── Messaging ───

async function handleSendMessage(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const channelId = (input.channelId as string) || ctx.channelId;
  const text = (input.text ?? input.message ?? input.content ?? input.msg) as string;
  if (!text) return JSON.stringify({ error: 'Missing required field: text' });
  await ctx.sendToChannel(channelId, text);
  return JSON.stringify({ sent: true, channelId });
}

async function handleSendFile(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const filePath = input.path as string;
  const caption = input.caption as string | undefined;

  if (!filePath) {
    return JSON.stringify({ error: 'Missing required field: path' });
  }

  log('debug', 'send_file', { filePath, caption, channelId: ctx.channelId });

  try {
    const resolvedPath = resolveFilePath(filePath);
    await access(resolvedPath);

    const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
    await publishProgress(getRedis(), ctx.channelId, {
      jobId: 'file-send',
      type: 'complete',
      filePath,
      caption,
    });
    return JSON.stringify({ sent: true, path: filePath });
  } catch (err) {
    log('error', 'send_file failed', { error: String(err), filePath });
    return JSON.stringify({ error: `Failed to send file: ${String(err)}` });
  }
}

// ─── Agents (management) ───

function handleListAgents(): string {
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

async function handleCreateAgent(input: Record<string, unknown>): Promise<string> {
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

  // Enforce -agent suffix
  if (!id.endsWith('-agent')) id = `${id}-agent`;

  log('debug', 'create_agent', { id, name, modelId, skills, tools, mcpServers, maxIterations });

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

async function handleUpdateAgent(input: Record<string, unknown>): Promise<string> {
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

async function handleDeleteAgent(input: Record<string, unknown>): Promise<string> {
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

// ─── Vault ───

async function handleVaultStore(input: Record<string, unknown>): Promise<string> {
  const name = input.name as string;
  await storeSecret(name, input.value as string);
  log('info', `Vault: secret "${name}" stored`);
  return JSON.stringify({ stored: true, name });
}

async function handleVaultCheck(input: Record<string, unknown>): Promise<string> {
  const name = input.name as string;
  const value = await resolveSecret(name);
  log('info', `Vault: secret "${name}" check — ${value !== null ? 'exists' : 'not found'}`);
  return JSON.stringify({ found: value !== null, name });
}

async function handleVaultDelete(input: Record<string, unknown>): Promise<string> {
  const name = input.name as string;
  const deleted = await deleteSecret(name);
  log('info', `Vault: secret "${name}" ${deleted ? 'deleted' : 'not found'}`);
  return JSON.stringify({ deleted, name });
}

async function handleVaultList(): Promise<string> {
  const names = await listSecrets();
  log('info', `Vault: listed ${names.length} secrets`);
  return JSON.stringify({ secrets: names });
}

// ─── Scheduling ───

/** Parse a delay value that may be milliseconds (number), seconds (number < 1000), or human-readable ("30s", "5m", "1h") */
function parseDelay(raw: unknown): number | null {
  if (raw == null) return null;
  const str = String(raw).trim().toLowerCase();
  // Human-readable: "30s", "5m", "2h", "1d"
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'ms') return val;
    if (unit.startsWith('s')) return val * 1000;
    if (unit.startsWith('m')) return val * 60_000;
    if (unit.startsWith('h')) return val * 3_600_000;
    if (unit.startsWith('d')) return val * 86_400_000;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Heuristic: if < 1000, treat as seconds (models often confuse ms/s)
  return num < 1000 ? num * 1000 : num;
}

async function handleScheduleReminder(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  // Accept common aliases: text/msg → message, delay/delaySec → delayMs
  const message = (input.message ?? input.text ?? input.msg ?? input.reminder) as string;
  if (!message) return JSON.stringify({ error: 'Missing required field: message (the reminder text)' });

  // Support both relative (delayMs/delay) and absolute (at) scheduling
  let delayMs: number;

  if (input.at != null) {
    // Absolute: ISO-8601 datetime string -> compute delay from now
    const target = new Date(input.at as string);
    if (isNaN(target.getTime())) {
      return JSON.stringify({ error: `Invalid datetime for "at": ${input.at}. Use ISO-8601 format (e.g. "2026-02-23T15:00:00Z").` });
    }
    delayMs = target.getTime() - Date.now();
    if (delayMs <= 0) {
      return JSON.stringify({ error: `The time "${input.at}" is in the past.` });
    }
  } else {
    // Try all common field names for delay
    const rawDelay = input.delayMs ?? input.delay ?? input.delaySec ?? input.delaySeconds ?? input.seconds ?? input.time;
    const parsed = parseDelay(rawDelay);
    if (parsed != null) {
      delayMs = parsed;
    } else {
      return JSON.stringify({ error: 'Missing required field: either "delayMs" (milliseconds) or "at" (ISO-8601 datetime). Example: { "message": "...", "delayMs": 30000 }' });
    }
  }

  log('info', 'schedule_reminder', { message, delayMs, channelId: ctx.channelId });
  const jobId = await createReminder(
    ctx.channelId,
    message,
    delayMs,
    (input.context as string) ?? ''
  );
  return JSON.stringify({ scheduled: true, jobId, type: 'reminder', delayMs });
}

async function handleScheduleRecurrentReminder(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  // Accept common aliases: message/text → task
  const task = (input.task ?? input.message ?? input.text ?? input.msg) as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the recurrent reminder description)' });

  const cron = (input.cron ?? input.cronExpression ?? input.pattern) as string | undefined || undefined;

  // Try to parse interval from various field names
  const rawInterval = input.intervalMs ?? input.interval ?? input.every ?? input.everyMs;
  const parsedInterval = parseDelay(rawInterval);
  const intervalMs = parsedInterval ?? undefined;

  if (!cron && !intervalMs) {
    return JSON.stringify({ error: 'Missing required field: either "cron" (e.g. "*/5 * * * *") or "intervalMs" (e.g. 300000 for 5 min). Example: { "task": "...", "cron": "*/5 * * * *" }' });
  }

  const effectiveCron = cron || undefined;
  const effectiveInterval = cron ? undefined : intervalMs;

  log('info', 'schedule_recurrent_reminder', { task, cron: effectiveCron, intervalMs: effectiveInterval, channelId: ctx.channelId });
  const jobId = await createRecurrentReminder(
    ctx.channelId,
    task,
    {
      cron: effectiveCron,
      intervalMs: effectiveInterval,
      timezone: (input.timezone as string) ?? undefined,
    }
  );
  return JSON.stringify({ scheduled: true, jobId, task, type: 'recurrent-reminder' });
}

async function handleScheduleTask(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const task = (input.task ?? input.message ?? input.text ?? input.description) as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the task description)' });

  // Support both relative (delayMs/delay) and absolute (at) scheduling
  let delayMs: number;

  if (input.at != null) {
    const target = new Date(input.at as string);
    if (isNaN(target.getTime())) {
      return JSON.stringify({ error: `Invalid datetime for "at": ${input.at}. Use ISO-8601 format (e.g. "2026-02-23T15:00:00Z").` });
    }
    delayMs = target.getTime() - Date.now();
    if (delayMs <= 0) {
      return JSON.stringify({ error: `The time "${input.at}" is in the past.` });
    }
  } else {
    const rawDelay = input.delayMs ?? input.delay ?? input.delaySec ?? input.delaySeconds ?? input.seconds ?? input.time;
    const parsed = parseDelay(rawDelay);
    if (parsed != null) {
      delayMs = parsed;
    } else {
      return JSON.stringify({ error: 'Missing required field: either "delayMs" (milliseconds) or "at" (ISO-8601 datetime). Example: { "task": "...", "delayMs": 30000 }' });
    }
  }

  log('info', 'schedule_task', { task, delayMs, channelId: ctx.channelId });
  const jobId = await createTask(ctx.channelId, task, delayMs);
  return JSON.stringify({ scheduled: true, jobId, type: 'task', delayMs });
}

async function handleScheduleRecurrentTask(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const task = (input.task ?? input.message ?? input.text ?? input.description) as string;
  if (!task) return JSON.stringify({ error: 'Missing required field: task (the recurrent task description)' });

  const cron = (input.cron ?? input.cronExpression ?? input.pattern) as string | undefined || undefined;

  const rawInterval = input.intervalMs ?? input.interval ?? input.every ?? input.everyMs;
  const parsedInterval = parseDelay(rawInterval);
  const intervalMs = parsedInterval ?? undefined;

  if (!cron && !intervalMs) {
    return JSON.stringify({ error: 'Missing required field: either "cron" (e.g. "*/5 * * * *") or "intervalMs" (e.g. 300000 for 5 min). Example: { "task": "...", "cron": "*/5 * * * *" }' });
  }

  const effectiveCron = cron || undefined;
  const effectiveInterval = cron ? undefined : intervalMs;

  log('info', 'schedule_recurrent_task', { task, cron: effectiveCron, intervalMs: effectiveInterval, channelId: ctx.channelId });
  const jobId = await createRecurrentTask(
    ctx.channelId,
    task,
    {
      cron: effectiveCron,
      intervalMs: effectiveInterval,
      timezone: (input.timezone as string) ?? undefined,
    }
  );
  return JSON.stringify({ scheduled: true, jobId, task, type: 'recurrent-task' });
}

async function handleListReminders(ctx: ToolContext): Promise<string> {
  const jobs = await listReminders(ctx.channelId);
  log('debug', 'list_reminders', { channelId: ctx.channelId, jobCount: jobs.length });
  return JSON.stringify({ jobs });
}

async function handleListTasks(ctx: ToolContext): Promise<string> {
  const jobs = await listTasks(ctx.channelId);
  log('debug', 'list_tasks', { channelId: ctx.channelId, jobCount: jobs.length });
  return JSON.stringify({ jobs });
}

async function handleCancelReminder(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });
  log('debug', 'cancel_reminder', { jobId, channelId: ctx.channelId });
  const result = await cancelReminder(jobId, ctx.channelId);
  log('debug', 'cancel_reminder result', { jobId, ...result });
  return JSON.stringify({ ...result, jobId });
}

async function handleCancelTask(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const jobId = input.jobId as string;
  if (!jobId) return JSON.stringify({ error: 'Missing required field: jobId' });
  log('debug', 'cancel_task', { jobId, channelId: ctx.channelId });
  const result = await cancelTask(jobId, ctx.channelId);
  log('debug', 'cancel_task result', { jobId, ...result });
  return JSON.stringify({ ...result, jobId });
}

// ─── Model Management ───

function handleListModels(): string {
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

async function handleToggleModel(input: Record<string, unknown>): Promise<string> {
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

function handleListSkills(): string {
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

async function handleToggleSkill(input: Record<string, unknown>): Promise<string> {
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

async function handleDeleteSkill(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  if (!id) return JSON.stringify({ error: 'Missing required field: id' });

  log('debug', 'delete_skill', { id });

  try {
    await deleteSkill(id);

    // Remove from config
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

async function handleRegisterSkill(input: Record<string, unknown>): Promise<string> {
  let id = input.id as string;
  if (!id) return JSON.stringify({ error: 'Missing required field: id' });

  // Enforce -skill suffix
  if (!id.endsWith('-skill')) id = `${id}-skill`;

  log('info', 'register_skill', { id });

  // Verify SKILL.md exists
  const skillDir = join(PATHS.skills, id);
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    await access(skillMdPath);
  } catch {
    return JSON.stringify({ error: `SKILL.md not found at skills/${id}/SKILL.md — write the file first.` });
  }

  // Reload skills from disk
  await loadSkills();

  // Verify it loaded correctly
  const skill = getSkill(id);
  if (!skill) {
    return JSON.stringify({ error: `Skill "${id}" failed to load after reload. Check SKILL.md frontmatter.` });
  }
  if (!skill.scriptPath || !skill.scriptLanguage) {
    return JSON.stringify({ error: `Skill "${id}" is missing "script" or "language" in SKILL.md frontmatter.` });
  }

  // Read all non-SKILL.md files for guard input
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

  // Run skill guard
  try {
    const guardResult = await runSkillGuard(id, skill.markdown, scriptContents);
    if (!guardResult.passed) {
      // Delete skill directory on guard failure
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

  // Register in config if not already present
  const config = getConfig();
  const idx = config.skills.findIndex(s => s.id === id);
  if (idx >= 0) {
    config.skills[idx].enabled = true;
  } else {
    config.skills.push({ id, enabled: true });
  }
  await saveConfig(config);

  // Notify workers
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

// ─── Agent Management (extended) ───

async function handleToggleAgent(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  const enabled = input.enabled as boolean;
  if (!id || typeof enabled !== 'boolean') {
    return JSON.stringify({ error: 'Missing required fields: id, enabled' });
  }

  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === id);
  if (!agent) {
    return JSON.stringify({ error: `Agent "${id}" not found in config` });
  }
  agent.enabled = enabled;
  await saveConfig(config);
  await publishAgentReload().catch(err => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  return JSON.stringify({ toggled: true, id, enabled });
}

async function handleSetAgentModels(input: Record<string, unknown>): Promise<string> {
  const agentId = input.agentId as string;
  const models = input.models as { model: string; weight?: number; priority?: number }[];
  if (!agentId || !Array.isArray(models)) {
    return JSON.stringify({ error: 'Missing required fields: agentId, models' });
  }

  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === agentId);
  if (!agent) {
    return JSON.stringify({ error: `Agent "${agentId}" not found in config` });
  }
  agent.models = models.map(m => ({ model: m.model, weight: m.weight ?? 1, priority: m.priority ?? 1 }));
  await saveConfig(config);
  await publishAgentReload().catch(err => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  return JSON.stringify({ updated: true, agentId, modelCount: agent.models.length });
}

async function handleSetAgentSkills(input: Record<string, unknown>): Promise<string> {
  const agentId = input.agentId as string;
  const skills = input.skills as string[];
  if (!agentId || !Array.isArray(skills)) {
    return JSON.stringify({ error: 'Missing required fields: agentId, skills' });
  }

  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === agentId);
  if (!agent) {
    return JSON.stringify({ error: `Agent "${agentId}" not found in config` });
  }
  agent.skills = skills;
  await saveConfig(config);
  await publishAgentReload().catch(err => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  return JSON.stringify({ updated: true, agentId, skillCount: skills.length });
}

async function handleSetAgentTools(input: Record<string, unknown>): Promise<string> {
  const agentId = input.agentId as string;
  const tools = input.tools as string[];
  if (!agentId || !Array.isArray(tools)) {
    return JSON.stringify({ error: 'Missing required fields: agentId, tools' });
  }

  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === agentId);
  if (!agent) {
    return JSON.stringify({ error: `Agent "${agentId}" not found in config` });
  }
  agent.tools = tools;
  await saveConfig(config);
  await publishAgentReload().catch(err => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  return JSON.stringify({ updated: true, agentId, toolCount: tools.length });
}

async function handleSetAgentMcps(input: Record<string, unknown>): Promise<string> {
  const agentId = input.agentId as string;
  const mcpServers = input.mcpServers as string[];
  if (!agentId || !Array.isArray(mcpServers)) {
    return JSON.stringify({ error: 'Missing required fields: agentId, mcpServers' });
  }

  const config = getConfig();
  const agent = config.orchestrator.agents.find(a => a.id === agentId);
  if (!agent) {
    return JSON.stringify({ error: `Agent "${agentId}" not found in config` });
  }
  agent.mcpServers = mcpServers;
  await saveConfig(config);
  await publishAgentReload().catch(err => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  return JSON.stringify({ updated: true, agentId, mcpServerCount: mcpServers.length });
}

// ─── Guards ───

function handleListGuards(): string {
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
    },
  });
}

async function handleToggleGuard(input: Record<string, unknown>): Promise<string> {
  const guard = input.guard as string;
  const enabled = input.enabled as boolean;
  if (!guard || typeof enabled !== 'boolean') {
    return JSON.stringify({ error: 'Missing required fields: guard, enabled' });
  }
  if (guard !== 'message' && guard !== 'skill' && guard !== 'agent') {
    return JSON.stringify({ error: `Invalid guard: "${guard}". Must be message, skill, or agent.` });
  }

  await updateConfig(draft => { draft.guards[guard].enabled = enabled; });
  await publishConfigReload().catch(err => log('warn', 'Failed to publish config reload', { error: String(err) }));
  return JSON.stringify({ toggled: true, guard, enabled });
}

// ─── Config ───

function handleGetConfig(input: Record<string, unknown>): string {
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

async function handleUpdateConfig(input: Record<string, unknown>): Promise<string> {
  const section = input.section as string;
  const values = input.values as Record<string, unknown>;
  if (!section || !values || typeof values !== 'object') {
    return JSON.stringify({ error: 'Missing required fields: section, values' });
  }

  const config = getConfigRef();
  if (!(section in config)) {
    return JSON.stringify({ error: `Unknown config section: "${section}"` });
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

function handleGetUsage(): string {
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

async function handleListProcesses(): Promise<string> {
  const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
  const processes = await listProcesses(getRedis());
  return JSON.stringify({ processes });
}

async function handleListQueues(): Promise<string> {
  const results: Record<string, unknown>[] = [];
  for (const [key, name] of Object.entries(QUEUE_NAMES)) {
    const q = getQueue(key as QueueKey);
    const counts = await q.getJobCounts();
    const isPaused = await q.isPaused();
    results.push({ key, name, paused: isPaused, ...counts });
  }
  return JSON.stringify({ queues: results });
}

async function handleListJobs(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as QueueKey | undefined;
  const status = input.status as string | undefined;
  const limit = (input.limit as number) ?? 20;

  // BullMQ v5: 'prioritized' jobs are logically 'waiting' — include both
  const baseStatuses = status
    ? [status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed']
    : ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;
  const statuses = baseStatuses.includes('waiting' as any)
    ? [...baseStatuses, 'prioritized' as any]
    : [...baseStatuses];

  const queuesToSearch = queueKey
    ? [{ key: queueKey, q: getQueue(queueKey) }]
    : Object.keys(QUEUE_NAMES).map(k => ({ key: k, q: getQueue(k as QueueKey) }));

  const jobs: Record<string, unknown>[] = [];
  for (const { key, q } of queuesToSearch) {
    const qJobs = await q.getJobs(statuses, 0, limit - 1);
    for (const j of qJobs) {
      const state = await j.getState();
      jobs.push({
        id: j.id,
        queue: key,
        name: j.name,
        state: state === 'prioritized' ? 'waiting' : state,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
      });
      if (jobs.length >= limit) break;
    }
    if (jobs.length >= limit) break;
  }
  return JSON.stringify({ jobs });
}

async function handlePauseQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  if (!queueKey || !(queueKey in QUEUE_NAMES)) {
    return JSON.stringify({ error: `Invalid queue key: "${queueKey}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}` });
  }
  const q = getQueue(queueKey as QueueKey);
  await q.pause();
  log('info', `Queue paused: ${queueKey}`);
  return JSON.stringify({ paused: true, queue: queueKey });
}

async function handleResumeQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  if (!queueKey || !(queueKey in QUEUE_NAMES)) {
    return JSON.stringify({ error: `Invalid queue key: "${queueKey}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}` });
  }
  const q = getQueue(queueKey as QueueKey);
  await q.resume();
  log('info', `Queue resumed: ${queueKey}`);
  return JSON.stringify({ resumed: true, queue: queueKey });
}

async function handleCleanQueue(input: Record<string, unknown>): Promise<string> {
  const queueKey = input.queue as string;
  const status = input.status as string;
  const age = (input.age as number) ?? 86_400_000; // 24h default

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

// ─── File I/O ───

/** Enforce -skill / -agent suffix on skill and agent directory paths */
function enforcePathSuffix(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts[0] === 'skills' && parts.length >= 2 && !parts[1].endsWith('-skill')) {
    parts[1] = `${parts[1]}-skill`;
    return parts.join('/');
  }
  if (parts[0] === 'agents' && parts.length >= 2 && !parts[1].endsWith('-agent')) {
    parts[1] = `${parts[1]}-agent`;
    return parts.join('/');
  }
  return filePath;
}

async function handleReadFile(input: Record<string, unknown>): Promise<string> {
  const content = await readWorkspaceFile(input.path as string);
  return JSON.stringify({ content });
}

async function handleWriteFile(input: Record<string, unknown>): Promise<string> {
  let filePath = (input.path ?? input.filePath ?? input.file) as string;
  if (!filePath) return JSON.stringify({ error: 'Missing required field: path' });
  const content = (input.content ?? input.data ?? input.text) as string;
  if (content == null) return JSON.stringify({ error: 'Missing required field: content' });

  // Enforce naming conventions on skills/ and agents/ paths
  filePath = enforcePathSuffix(filePath);

  await writeWorkspaceFile(filePath, content);

  if (filePath.startsWith('skills/') || filePath.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (filePath.startsWith('agents/') || filePath.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ written: true, path: filePath });
}

async function handleReadFileLines(input: Record<string, unknown>): Promise<string> {
  const path = input.path as string;
  const startLine = input.startLine as number;
  const endLine = input.endLine as number | undefined;
  log('debug', 'read_file_lines', { path, startLine, endLine });
  const result = await readWorkspaceFileLines(path, startLine, endLine);
  return JSON.stringify(result);
}

async function handlePatchFile(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  const search = input.search as string;
  const replace = input.replace as string;
  const all = (input.all as boolean) ?? false;

  if (!path || search === undefined || replace === undefined) {
    return JSON.stringify({ error: 'Missing required fields: path, search, replace' });
  }

  path = enforcePathSuffix(path);
  log('debug', 'patch_file', { path, searchLength: search.length, replaceLength: replace.length, all });
  const result = await patchWorkspaceFile(path, search, replace, all);

  if (!result.matched) {
    return JSON.stringify({ error: 'Search string not found in file', path });
  }

  if (path.startsWith('skills/') || path.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (path.startsWith('agents/') || path.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ patched: true, count: result.count });
}

async function handleAppendFile(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  const content = input.content as string;

  if (!path || content === undefined) {
    return JSON.stringify({ error: 'Missing required fields: path, content' });
  }

  path = enforcePathSuffix(path);
  log('debug', 'append_file', { path, contentLength: content.length });
  await appendWorkspaceFile(path, content);

  if (path.startsWith('skills/') || path.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (path.startsWith('agents/') || path.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ appended: true });
}

async function handleDiffFiles(input: Record<string, unknown>): Promise<string> {
  const pathA = input.pathA as string;
  const pathB = input.pathB as string;

  if (!pathA || !pathB) {
    return JSON.stringify({ error: 'Missing required fields: pathA, pathB' });
  }

  log('debug', 'diff_files', { pathA, pathB });
  const diff = await diffWorkspaceFiles(pathA, pathB);
  return JSON.stringify({ diff });
}

async function handleFileInfo(input: Record<string, unknown>): Promise<string> {
  const path = input.path as string;
  if (!path) {
    return JSON.stringify({ error: 'Missing required field: path' });
  }
  log('debug', 'file_info', { path });
  const info = await getFileInfo(path);
  return JSON.stringify(info);
}

async function handleCopyFile(input: Record<string, unknown>): Promise<string> {
  const src = input.src as string;
  let dest = input.dest as string;
  if (!src || !dest) {
    return JSON.stringify({ error: 'Missing required fields: src, dest' });
  }
  dest = enforcePathSuffix(dest);
  log('debug', 'copy_file', { src, dest });
  await copyWorkspaceFile(src, dest);

  if (dest.startsWith('skills/') || dest.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (dest.startsWith('agents/') || dest.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ copied: true });
}

async function handleCopyFolder(input: Record<string, unknown>): Promise<string> {
  const src = input.src as string;
  let dest = input.dest as string;
  if (!src || !dest) {
    return JSON.stringify({ error: 'Missing required fields: src, dest' });
  }
  dest = enforcePathSuffix(dest);
  log('debug', 'copy_folder', { src, dest });
  const result = await copyWorkspaceFolder(src, dest);

  if (dest.startsWith('skills/') || dest.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (dest.startsWith('agents/') || dest.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ copied: true, count: result.count });
}

async function handleDeleteFile(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  if (!path) {
    return JSON.stringify({ error: 'Missing required field: path' });
  }
  path = enforcePathSuffix(path);
  log('debug', 'delete_file', { path });
  await deleteWorkspaceFile(path);

  if (path.startsWith('skills/') || path.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (path.startsWith('agents/') || path.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ deleted: true });
}

async function handleDeleteFolder(input: Record<string, unknown>): Promise<string> {
  let path = input.path as string;
  if (!path) {
    return JSON.stringify({ error: 'Missing required field: path' });
  }
  path = enforcePathSuffix(path);
  log('debug', 'delete_folder', { path });
  await deleteWorkspaceFolder(path);

  if (path.startsWith('skills/') || path.startsWith('skills\\')) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  } else if (path.startsWith('agents/') || path.startsWith('agents\\')) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ deleted: true });
}

async function handleRenameFile(input: Record<string, unknown>): Promise<string> {
  let src = input.src as string;
  let dest = input.dest as string;
  if (!src || !dest) {
    return JSON.stringify({ error: 'Missing required fields: src, dest' });
  }
  src = enforcePathSuffix(src);
  dest = enforcePathSuffix(dest);
  log('debug', 'rename_file', { src, dest });
  await renameWorkspaceFile(src, dest);

  const affected = [src, dest];
  if (affected.some(p => p.startsWith('skills/') || p.startsWith('skills\\'))) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  }
  if (affected.some(p => p.startsWith('agents/') || p.startsWith('agents\\'))) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ renamed: true });
}

async function handleRenameFolder(input: Record<string, unknown>): Promise<string> {
  let src = input.src as string;
  let dest = input.dest as string;
  if (!src || !dest) {
    return JSON.stringify({ error: 'Missing required fields: src, dest' });
  }
  src = enforcePathSuffix(src);
  dest = enforcePathSuffix(dest);
  log('debug', 'rename_folder', { src, dest });
  await renameWorkspaceFolder(src, dest);

  const affected = [src, dest];
  if (affected.some(p => p.startsWith('skills/') || p.startsWith('skills\\'))) {
    log('info', 'Skills directory changed — reloading skills');
    await loadSkills();
    await publishSkillReload().catch((err) => log('warn', 'Failed to publish skill reload', { error: String(err) }));
  }
  if (affected.some(p => p.startsWith('agents/') || p.startsWith('agents\\'))) {
    log('info', 'Agents directory changed — reloading agents');
    await loadAllAgents();
    await publishAgentReload().catch((err) => log('warn', 'Failed to publish agent reload', { error: String(err) }));
  }

  return JSON.stringify({ renamed: true });
}

// ─── Context ───

async function handleCompactContext(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { messages, modelId } = ctx;
  if (!messages || messages.length <= 2) {
    return JSON.stringify({ compacted: false, reason: 'Nothing to compact' });
  }

  // Look up model config for context window
  const config = getConfigRef();
  const modelEntry = modelId
    ? config.models.models.find(m => m.id === modelId)
    : undefined;
  const contextWindow = modelEntry?.contextWindow ?? 128_000;

  // Estimate current token usage (chars / 3.5 heuristic)
  const estimateChars = (msgs: typeof messages) =>
    msgs.reduce((sum, m) => {
      let chars = m.content.length;
      if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
      return sum + chars;
    }, 0);

  const totalChars = estimateChars(messages);
  const estimatedTokensBefore = Math.round(totalChars / 3.5);

  // Check threshold — only compact if over 90% of context window (unless forced)
  const force = input.force === true;
  if (estimatedTokensBefore < contextWindow * 0.9 && !force) {
    return JSON.stringify({
      compacted: false,
      reason: 'Context usage below threshold',
      estimatedTokens: estimatedTokensBefore,
      contextWindow,
      usage: `${Math.round((estimatedTokensBefore / contextWindow) * 100)}%`,
    });
  }

  // Identify message groups for compaction.
  // A group is either:
  //   - a standalone user/assistant message (no tool_calls)
  //   - an assistant message with tool_calls + all following tool results
  const groups: { startIdx: number; endIdx: number }[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Collect the assistant msg + subsequent tool results
      const start = i;
      i++;
      while (i < messages.length && messages[i].role === 'tool') i++;
      groups.push({ startIdx: start, endIdx: i - 1 });
    } else {
      groups.push({ startIdx: i, endIdx: i });
      i++;
    }
  }

  // Keep the last few groups (target: keep ~50% of context after compaction).
  // Walk backwards, accumulating chars, until we hit 50% budget.
  const targetKeepChars = contextWindow * 3.5 * 0.5;
  let keepChars = 0;
  let keepFromGroup = groups.length;
  for (let g = groups.length - 1; g >= 0; g--) {
    let groupChars = 0;
    for (let j = groups[g].startIdx; j <= groups[g].endIdx; j++) {
      groupChars += messages[j].content.length;
      if (messages[j].tool_calls) groupChars += JSON.stringify(messages[j].tool_calls).length;
    }
    if (keepChars + groupChars > targetKeepChars && keepFromGroup < groups.length) break;
    keepChars += groupChars;
    keepFromGroup = g;
  }

  // Nothing to compact if we'd keep everything
  if (keepFromGroup === 0) {
    return JSON.stringify({ compacted: false, reason: 'All messages within budget' });
  }

  // Collect compaction candidates (all messages before keepFromGroup)
  const compactEndIdx = groups[keepFromGroup].startIdx;
  const candidateMessages = messages.slice(0, compactEndIdx);

  if (candidateMessages.length === 0) {
    return JSON.stringify({ compacted: false, reason: 'No messages eligible for compaction' });
  }

  // Format candidates for summarization
  const formatted = candidateMessages.map(m => {
    let line = `[${m.role}]: ${m.content}`;
    if (m.tool_calls) line += `\n[tool_calls]: ${JSON.stringify(m.tool_calls)}`;
    if (m.tool_call_id) line = `[tool result for ${m.tool_call_id}]: ${m.content}`;
    return line;
  }).join('\n\n');

  // Summarize via LLM call — use auto model selection
  const { parseModelId, selectModel } = await import('../models/provider.js');
  const { getProvider } = await import('../models/registry.js');

  const summaryModelId = selectModel(config.orchestrator.models)
    ?? selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
  if (!summaryModelId) {
    return JSON.stringify({ compacted: false, reason: 'No model available for summarization' });
  }

  const { provider: providerId, model } = parseModelId(summaryModelId);
  const provider = getProvider(providerId);

  const summaryResponse = await provider.chat({
    model,
    systemPrompt: COMPACT_CONTEXT_PROMPT,
    messages: [{ role: 'user', content: formatted }],
    maxTokens: 2048,
    temperature: 0.2,
  });

  const summary = summaryResponse.content;

  // Replace in-place
  const messagesBefore = messages.length;
  messages.splice(0, compactEndIdx);
  messages.unshift({
    role: 'user',
    content: `[Previous conversation summary]\n\n${summary}`,
  });
  const messagesAfter = messages.length;

  const totalCharsAfter = estimateChars(messages);
  const estimatedTokensAfter = Math.round(totalCharsAfter / 3.5);

  log('info', 'compact_context completed', {
    messagesBefore,
    messagesAfter,
    estimatedTokensBefore,
    estimatedTokensAfter,
  });

  return JSON.stringify({
    compacted: true,
    messagesBefore,
    messagesAfter,
    estimatedTokensBefore,
    estimatedTokensAfter,
  });
}

// ═══════════════════════════════════════════════════════════════════
// TOOL REGISTRATION — register all handlers with the shared registry
// ═══════════════════════════════════════════════════════════════════

// Memory
registerTool('memory_store', handleMemoryStore);
registerTool('memory_search', handleMemorySearch);
registerTool('memory_recall', handleMemoryRecall);
registerTool('memory_update', handleMemoryUpdate);
registerTool('memory_delete', handleMemoryDelete);
// Messaging
registerTool('send_message', handleSendMessage);
registerTool('send_file', handleSendFile);
// Agents (management)
registerTool('list_agents', handleListAgents);
registerTool('create_agent', handleCreateAgent);
registerTool('update_agent', handleUpdateAgent);
registerTool('delete_agent', handleDeleteAgent);
// Vault
registerTool('vault_store', handleVaultStore);
registerTool('vault_check', handleVaultCheck);
registerTool('vault_delete', handleVaultDelete);
registerTool('vault_list', handleVaultList);
// Scheduling
registerTool('schedule_reminder', handleScheduleReminder);
registerTool('schedule_recurrent_reminder', handleScheduleRecurrentReminder);
registerTool('schedule_task', handleScheduleTask);
registerTool('schedule_recurrent_task', handleScheduleRecurrentTask);
registerTool('list_reminders', (_input, ctx) => handleListReminders(ctx));
registerTool('list_tasks', (_input, ctx) => handleListTasks(ctx));
registerTool('cancel_reminder', handleCancelReminder);
registerTool('cancel_task', handleCancelTask);
// Model management
registerTool('list_models', handleListModels);
registerTool('toggle_model', handleToggleModel);
// Skill management
registerTool('list_skills', handleListSkills);
registerTool('toggle_skill', handleToggleSkill);
registerTool('delete_skill', handleDeleteSkill);
registerTool('register_skill', handleRegisterSkill);
// Agent management (extended)
registerTool('toggle_agent', handleToggleAgent);
registerTool('set_agent_models', handleSetAgentModels);
registerTool('set_agent_skills', handleSetAgentSkills);
registerTool('set_agent_tools', handleSetAgentTools);
registerTool('set_agent_mcps', handleSetAgentMcps);
// Guards
registerTool('list_guards', handleListGuards);
registerTool('toggle_guard', handleToggleGuard);
// Config
registerTool('get_config', handleGetConfig);
registerTool('update_config', handleUpdateConfig);
// Usage
registerTool('get_usage', handleGetUsage);
// Queue/Process management
registerTool('list_processes', handleListProcesses);
registerTool('list_queues', handleListQueues);
registerTool('list_jobs', handleListJobs);
registerTool('pause_queue', handlePauseQueue);
registerTool('resume_queue', handleResumeQueue);
registerTool('clean_queue', handleCleanQueue);
// File I/O
registerTool('read_file', handleReadFile);
registerTool('read_file_lines', handleReadFileLines);
registerTool('write_file', handleWriteFile);
registerTool('patch_file', handlePatchFile);
registerTool('append_file', handleAppendFile);
registerTool('diff_files', handleDiffFiles);
registerTool('file_info', handleFileInfo);
registerTool('copy_file', handleCopyFile);
registerTool('copy_folder', handleCopyFolder);
registerTool('delete_file', handleDeleteFile);
registerTool('delete_folder', handleDeleteFolder);
registerTool('rename_file', handleRenameFile);
registerTool('rename_folder', handleRenameFolder);
// Context
registerTool('compact_context', handleCompactContext);
