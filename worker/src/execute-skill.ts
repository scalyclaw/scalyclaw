import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { log } from '@scalyclaw/scalyclaw/core/logger.js';
import { spawnProcess, spawnWithSecrets } from '@scalyclaw/scalyclaw/core/subprocess.js';

let bunBinDir: string | null = null;
try {
  bunBinDir = dirname(process.argv[0]);
  if (!bunBinDir || !process.argv[0].includes('bun')) {
    const which = spawnSync('which', ['bun'], { stdio: 'pipe', timeout: 5000 });
    const resolved = which.stdout?.toString().trim();
    bunBinDir = resolved ? dirname(resolved) : null;
  }
} catch {
  bunBinDir = null;
}

export interface SkillExecutionParams {
  skillId: string;
  input: string;
  scriptPath: string;
  scriptLanguage: string;
  skillDir: string;
  workspacePath: string;
  timeoutMs: number;
  secrets?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SkillExecutionResult {
  skillId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeSkill(params: SkillExecutionParams): Promise<SkillExecutionResult> {
  const { skillId, input, scriptPath, scriptLanguage, skillDir, workspacePath, timeoutMs, secrets, signal } = params;

  let cmd: string;
  let args: string[];

  if (scriptLanguage === 'python') {
    cmd = 'uv';
    args = ['run', scriptPath];
  } else if (scriptLanguage === 'javascript') {
    cmd = 'bun';
    args = ['run', scriptPath];
  } else if (scriptLanguage === 'rust') {
    cmd = 'cargo';
    args = ['run', '--release', '--quiet'];
  } else if (scriptLanguage === 'bash') {
    cmd = 'bash';
    args = [scriptPath];
  } else {
    return { skillId, stdout: '', stderr: `Unsupported script language: ${scriptLanguage}`, exitCode: 1 };
  }

  log('debug', 'execute-skill: executing', { skillId, cmd, args, language: scriptLanguage });

  const extraEnv: Record<string, string> = {};
  if (bunBinDir && !process.env.PATH?.includes(bunBinDir)) {
    extraEnv.PATH = `${bunBinDir}:${process.env.PATH ?? ''}`;
  }

  const spawnOpts = {
    cmd,
    args,
    cwd: skillDir,
    timeoutMs,
    input,
    workspacePath,
    label: 'execute-skill',
    signal,
  };

  const result = secrets
    ? await spawnProcess({ ...spawnOpts, extraEnv: { ...secrets, ...extraEnv } })
    : await spawnWithSecrets({ ...spawnOpts, extraEnv });

  return { skillId, ...result };
}
