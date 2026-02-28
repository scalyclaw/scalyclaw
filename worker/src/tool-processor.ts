import type { Job } from 'bullmq';
import { join, dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from '@scalyclaw/shared/core/logger.js';
import { PATHS } from '@scalyclaw/shared/core/paths.js';
import { isJobCancelled } from '@scalyclaw/shared/queue/cancel.js';
import { registerAbort, unregisterAbort } from '@scalyclaw/shared/queue/cancel-signal.js';
import { executeSkill } from './execute-skill.js';
import { executeCode } from './execute-code.js';
import { executeCommand } from './execute-command.js';
import { getOrFetchSkill } from './skill-cache.js';
import { ensureInstalled } from './skill-setup.js';
import type { SkillExecutionData, ToolExecutionData } from '@scalyclaw/shared/queue/jobs.js';

// ─── Worker config (set by index.ts after bootstrap) ───

let workerNodeUrl = '';
let workerNodeToken = '';
let workerProcessId = '';

export function setWorkerConfig(nodeUrl: string, nodeToken: string, processId: string): void {
  workerNodeUrl = nodeUrl;
  workerNodeToken = nodeToken;
  workerProcessId = processId;
}

// ─── Pre-fetch workspace files from node ───

const PREFETCH_TIMEOUT_MS = 15_000;

async function prefetchWorkspaceFiles(files: string[]): Promise<void> {
  if (!workerNodeUrl) return;
  for (const rel of files) {
    try {
      const url = `${workerNodeUrl}/api/worker/workspace?path=${encodeURIComponent(rel)}`;
      const headers: Record<string, string> = {};
      if (workerNodeToken) headers['Authorization'] = `Bearer ${workerNodeToken}`;

      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        log('warn', `Failed to prefetch workspace file: ${rel}`, { status: res.status });
        continue;
      }

      const destPath = resolve(PATHS.workspace, rel);
      if (!destPath.startsWith(resolve(PATHS.workspace) + '/')) {
        log('warn', `Workspace file path traversal blocked: ${rel}`);
        continue;
      }
      await mkdir(dirname(destPath), { recursive: true });
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(destPath, buffer);
      log('info', `Prefetched workspace file: ${rel}`);
    } catch (err) {
      log('warn', `Failed to prefetch workspace file: ${rel}`, { error: String(err) });
    }
  }
}

// ─── Annotate worker results with file paths for transfer ───

interface WorkerFileEntry {
  /** Path the worker API can serve (workspace-relative, or _skills/-prefixed for skill-dir files) */
  src: string;
  /** Path to save on the node's workspace (always workspace-relative) */
  dest: string;
}

/**
 * Scans a worker execution result for absolute workspace/skill-dir paths,
 * rewrites them to workspace-relative paths, and adds _workerFiles/_workerProcessId
 * so the node can download them.
 */
function annotateWorkerResult(resultJson: string): string {
  if (!workerProcessId) return resultJson;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return resultJson; // Not valid JSON — skip
  }

  // Only annotate results that have stdout
  const stdout = parsed.stdout;
  if (typeof stdout !== 'string' || !stdout.trim()) return resultJson;

  // Try to parse stdout as JSON; if not JSON, scan as plain text
  const workspacePrefix = PATHS.workspace.endsWith('/') ? PATHS.workspace : PATHS.workspace + '/';
  const skillsPrefix = PATHS.skills.endsWith('/') ? PATHS.skills : PATHS.skills + '/';
  const workerFiles: WorkerFileEntry[] = [];

  let stdoutParsed: unknown;
  try {
    stdoutParsed = JSON.parse(stdout);
  } catch {
    stdoutParsed = null;
  }

  if (stdoutParsed !== null && typeof stdoutParsed === 'object') {
    // Scan all string values in the JSON for workspace/skill-dir absolute paths
    const rewritten = rewritePaths(stdoutParsed, workspacePrefix, skillsPrefix, workerFiles);
    parsed.stdout = JSON.stringify(rewritten);
  } else {
    // Plain text: scan for absolute paths matching either prefix.
    // Match greedily until a file extension (.\w{1,10}), allowing spaces in filenames.
    // Falls back to the old space-breaking pattern for extensionless paths.
    const extPattern = `(?:${escapeRegex(workspacePrefix)}|${escapeRegex(skillsPrefix)})[^"'\\n\\r]*\\.\\w{1,10}(?=[\\s"'\\]\\),;]|$)`;
    const noExtPattern = `(?:${escapeRegex(workspacePrefix)}|${escapeRegex(skillsPrefix)})[^\\s"'\\]\\)]+`;
    const pathRegex = new RegExp(`${extPattern}|${noExtPattern}`, 'g');
    let match: RegExpExecArray | null;
    let newStdout = stdout;
    while ((match = pathRegex.exec(stdout)) !== null) {
      const absPath = match[0];
      const entry = makeFileEntry(absPath, workspacePrefix, skillsPrefix);
      if (entry) {
        workerFiles.push(entry);
        newStdout = newStdout.split(absPath).join(entry.dest);
      }
    }
    if (newStdout !== stdout) {
      parsed.stdout = newStdout;
    }
  }

  if (workerFiles.length === 0) return resultJson;

  parsed._workerFiles = workerFiles;
  parsed._workerProcessId = workerProcessId;
  log('info', 'Annotated worker result with files', { files: workerFiles, processId: workerProcessId });
  return JSON.stringify(parsed);
}

/** Build a { src, dest } entry from an absolute path matching workspace or skills prefix.
 *  src is base-relative (e.g. "workspace/file.txt" or "skills/youtube/output.mp4")
 *  so the node can fetch via the worker's /api/files endpoint which resolves against PATHS.base. */
function makeFileEntry(absPath: string, workspacePrefix: string, skillsPrefix: string): WorkerFileEntry | null {
  if (absPath.startsWith(workspacePrefix)) {
    const rel = absPath.slice(workspacePrefix.length);
    return { src: 'workspace/' + rel, dest: rel };
  }
  if (absPath.startsWith(skillsPrefix)) {
    const relFromSkills = absPath.slice(skillsPrefix.length); // e.g. "youtube-skill/output.mp4"
    const slashIdx = relFromSkills.indexOf('/');
    const dest = slashIdx >= 0 ? relFromSkills.slice(slashIdx + 1) : relFromSkills;
    return { src: 'skills/' + relFromSkills, dest };
  }
  return null;
}

/** Recursively scan/rewrite absolute workspace/skill-dir paths in a JSON value */
function rewritePaths(value: unknown, workspacePrefix: string, skillsPrefix: string, collected: WorkerFileEntry[]): unknown {
  if (typeof value === 'string') {
    const entry = makeFileEntry(value, workspacePrefix, skillsPrefix);
    if (entry) {
      collected.push(entry);
      return entry.dest;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(v => rewritePaths(v, workspacePrefix, skillsPrefix, collected));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewritePaths(v, workspacePrefix, skillsPrefix, collected);
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

  // Create an AbortController — pub/sub fires instantly, polling is fallback
  const ac = new AbortController();
  registerAbort(jobId, ac);
  const cancelPoll = setInterval(async () => {
    try {
      if (await isJobCancelled(jobId)) {
        ac.abort();
        clearInterval(cancelPoll);
      }
    } catch { /* Redis unavailable — keep going */ }
  }, 2_000);
  cancelPoll.unref();

  // Pre-fetch workspace files referenced in job data
  const workspaceFiles = (input._workspaceFiles as string[]) ?? [];
  if (workspaceFiles.length > 0) {
    await prefetchWorkspaceFiles(workspaceFiles);
  }

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
    return annotateWorkerResult(result);
  } catch (err) {
    log('error', `Tool execution failed: ${toolName}`, { jobId, toolCallId, error: String(err) });
    return JSON.stringify({ error: `Tool "${toolName}" failed: ${String(err)}` });
  } finally {
    clearInterval(cancelPoll);
    unregisterAbort(jobId);
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
    timeoutMs: skill.timeout ?? 18_000_000, // 5 hours default
    secrets,
    signal,
  });
  return JSON.stringify(result);
}

// ─── Skill execution (direct queue job) ───

async function processSkillExecution(job: Job<SkillExecutionData>): Promise<string> {
  const { skillId, input, timeoutMs, secrets, _workspaceFiles } = job.data;
  const jobId = job.id!;
  log('info', 'Executing skill on worker', { jobId, skillId });

  const ac = new AbortController();
  registerAbort(jobId, ac);
  const cancelPoll = setInterval(async () => {
    try {
      if (await isJobCancelled(jobId)) {
        ac.abort();
        clearInterval(cancelPoll);
      }
    } catch { /* Redis unavailable — keep going */ }
  }, 2_000);
  cancelPoll.unref();

  try {
    // Pre-fetch workspace files if provided
    if (_workspaceFiles && _workspaceFiles.length > 0) {
      await prefetchWorkspaceFiles(_workspaceFiles);
    }

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
      secrets,
      signal: ac.signal,
    });

    log('info', 'Skill execution complete', { jobId, skillId, exitCode: result.exitCode });
    return annotateWorkerResult(JSON.stringify(result));
  } finally {
    clearInterval(cancelPoll);
    unregisterAbort(jobId);
  }
}
