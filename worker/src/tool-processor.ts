import type { Job } from 'bullmq';
import { join } from 'node:path';
import { log } from '@scalyclaw/scalyclaw/core/logger.js';
import { PATHS } from '@scalyclaw/scalyclaw/core/paths.js';
import { isJobCancelled } from '@scalyclaw/scalyclaw/queue/cancel.js';
import { executeSkill } from './execute-skill.js';
import { executeCode } from './execute-code.js';
import { executeCommand } from './execute-command.js';
import { getOrFetchSkill } from './skill-cache.js';
import { ensureInstalled } from './skill-setup.js';
import type { SkillExecutionData, ToolExecutionData } from '@scalyclaw/scalyclaw/queue/jobs.js';

// ─── Worker config (set by index.ts after bootstrap) ───

let workerNodeUrl = '';
let workerNodeToken = '';
let workerProcessId = '';

export function setWorkerConfig(nodeUrl: string, nodeToken: string, processId: string): void {
  workerNodeUrl = nodeUrl;
  workerNodeToken = nodeToken;
  workerProcessId = processId;
}

// ─── Annotate skill results with workspace file paths ───

/**
 * Scans a skill execution result for absolute workspace paths,
 * rewrites them to workspace-relative paths, and adds _workerFiles/_workerProcessId
 * so the node can download them.
 */
function annotateSkillResult(resultJson: string): string {
  if (!workerProcessId) return resultJson;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return resultJson; // Not valid JSON — skip
  }

  // Only annotate successful skill results that have stdout
  const stdout = parsed.stdout;
  if (typeof stdout !== 'string' || !stdout.trim()) return resultJson;

  // Try to parse stdout as JSON; if not JSON, scan as plain text
  const workspacePrefix = PATHS.workspace.endsWith('/') ? PATHS.workspace : PATHS.workspace + '/';
  const workerFiles: string[] = [];

  let stdoutParsed: unknown;
  try {
    stdoutParsed = JSON.parse(stdout);
  } catch {
    stdoutParsed = null;
  }

  if (stdoutParsed !== null && typeof stdoutParsed === 'object') {
    // Scan all string values in the JSON for workspace absolute paths
    const rewritten = rewritePaths(stdoutParsed, workspacePrefix, workerFiles);
    parsed.stdout = JSON.stringify(rewritten);
  } else {
    // Plain text: scan for absolute paths
    const pathRegex = new RegExp(escapeRegex(workspacePrefix) + '[^\\s"\'\\]\\)]+', 'g');
    let match: RegExpExecArray | null;
    let newStdout = stdout;
    while ((match = pathRegex.exec(stdout)) !== null) {
      const absPath = match[0];
      const relPath = absPath.slice(workspacePrefix.length);
      workerFiles.push(relPath);
      newStdout = newStdout.split(absPath).join(relPath);
    }
    if (newStdout !== stdout) {
      parsed.stdout = newStdout;
    }
  }

  if (workerFiles.length === 0) return resultJson;

  parsed._workerFiles = workerFiles;
  parsed._workerProcessId = workerProcessId;
  log('info', 'Annotated skill result with worker files', { files: workerFiles, processId: workerProcessId });
  return JSON.stringify(parsed);
}

/** Recursively scan/rewrite absolute workspace paths in a JSON value */
function rewritePaths(value: unknown, prefix: string, collected: string[]): unknown {
  if (typeof value === 'string') {
    if (value.startsWith(prefix)) {
      const rel = value.slice(prefix.length);
      collected.push(rel);
      return rel;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(v => rewritePaths(v, prefix, collected));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewritePaths(v, prefix, collected);
    }
    return out;
  }
  return value;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Worker job processor (scalyclaw-tools queue) ───

export async function processToolJob(job: Job): Promise<string> {
  log('info', `Processing tool job: ${job.name}`, { jobId: job.id });

  switch (job.name) {
    case 'tool-execution':
      return await processToolExecution(job as Job<ToolExecutionData>);
    case 'skill-execution':
      return await processSkillExecution(job as Job<SkillExecutionData>);
    default:
      throw new Error(`Unknown tool job type: ${job.name}`);
  }
}

// ─── Tool execution ───

async function processToolExecution(job: Job<ToolExecutionData>): Promise<string> {
  const { toolCallId, toolName, input } = job.data;
  const jobId = job.id!;
  log('info', 'Executing tool on worker', { jobId, toolCallId, toolName });

  // Create an AbortController that fires when the job is cancelled via Redis
  const ac = new AbortController();
  const cancelPoll = setInterval(async () => {
    try {
      if (await isJobCancelled(jobId)) {
        ac.abort();
        clearInterval(cancelPoll);
      }
    } catch { /* Redis unavailable — keep going */ }
  }, 2_000);

  const start = Date.now();
  try {
    let result: string;
    switch (toolName) {
      case 'execute_skill':
        result = await handleInvokeSkill(input, ac.signal);
        break;
      case 'execute_code':
        result = await executeCode(input, ac.signal);
        break;
      case 'execute_command':
        result = await executeCommand(input, ac.signal);
        break;
      default:
        result = JSON.stringify({ error: `Unknown tool "${toolName}" — worker only handles execute_skill, execute_code, execute_command` });
    }
    log('info', `Tool execution complete: ${toolName}`, { jobId, toolCallId, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    log('error', `Tool execution failed: ${toolName}`, { jobId, toolCallId, error: String(err) });
    return JSON.stringify({ error: `Tool "${toolName}" failed: ${String(err)}` });
  } finally {
    clearInterval(cancelPoll);
  }
}

// ─── execute_skill on worker (fetches from node API if not on disk) ───

async function handleInvokeSkill(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const skillId = input.skillId as string;
  const skillInput = (input.input as string) ?? '';
  if (!skillId) return JSON.stringify({ error: 'Missing required field: skillId' });

  const skill = await getOrFetchSkill(skillId, workerNodeUrl, workerNodeToken);
  if (!skill) return JSON.stringify({ error: `Skill "${skillId}" not found on worker or node.` });
  if (!skill.scriptPath || !skill.scriptLanguage) {
    return JSON.stringify({ skillId, type: 'markdown', content: skill.markdown });
  }

  const skillDir = join(PATHS.skills, skillId);
  try {
    await ensureInstalled(skill, skillDir);
  } catch (err) {
    return JSON.stringify({ error: `Skill "${skillId}" dependency install failed: ${String(err)}` });
  }

  const secrets = (input._secrets as Record<string, string>) ?? undefined;
  const result = await executeSkill({
    skillId,
    input: skillInput,
    scriptPath: skill.scriptPath,
    scriptLanguage: skill.scriptLanguage,
    skillDir,
    workspacePath: PATHS.workspace,
    timeoutMs: 30_000,
    secrets,
    signal,
  });
  return annotateSkillResult(JSON.stringify(result));
}

// ─── Skill execution (direct queue job) ───

async function processSkillExecution(job: Job<SkillExecutionData>): Promise<string> {
  const { skillId, input, timeoutMs } = job.data;
  log('info', 'Executing skill on worker', { jobId: job.id, skillId });

  const skill = await getOrFetchSkill(skillId, workerNodeUrl, workerNodeToken);
  if (!skill?.scriptPath || !skill.scriptLanguage) {
    return JSON.stringify({ skillId, stdout: '', stderr: `Skill "${skillId}" not found or has no script`, exitCode: 1 });
  }

  const skillDir = join(PATHS.skills, skillId);
  try {
    await ensureInstalled(skill, skillDir);
  } catch (err) {
    return JSON.stringify({ skillId, stdout: '', stderr: `Dependency install failed: ${String(err)}`, exitCode: 1 });
  }

  const result = await executeSkill({
    skillId,
    input,
    scriptPath: skill.scriptPath,
    scriptLanguage: skill.scriptLanguage,
    skillDir,
    workspacePath: PATHS.workspace,
    timeoutMs,
  });

  log('info', 'Skill execution complete', { jobId: job.id, skillId, exitCode: result.exitCode });
  return annotateSkillResult(JSON.stringify(result));
}
