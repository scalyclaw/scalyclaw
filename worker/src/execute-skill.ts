import { log } from '@scalyclaw/shared/core/logger.js';
import { spawnProcess } from './subprocess.js';
import { getWorkerExtraEnv } from './worker-env.js';

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

  const extraEnv = getWorkerExtraEnv();

  const result = await spawnProcess({
    cmd,
    args,
    cwd: skillDir,
    timeoutMs,
    input,
    workspacePath,
    extraEnv: { ...secrets, ...extraEnv },
    label: 'execute-skill',
    signal,
  });

  return { skillId, ...result };
}
