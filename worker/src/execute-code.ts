import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { log } from '@scalyclaw/shared/core/logger.js';
import { spawnProcess } from './subprocess.js';
import { PATHS } from '@scalyclaw/shared/core/paths.js';
import { EXECUTION_TIMEOUT_MS } from '@scalyclaw/shared/const/constants.js';
import { EXEC_DIR, JOB_FIELD_DENIED_COMMANDS, JOB_FIELD_SECRETS } from './const/constants.js';

const LANG_CONFIG: Record<string, { ext: string; cmd: string; args: (f: string) => string[] }> = {
  javascript: { ext: '.js',  cmd: 'bun',  args: (f) => ['run', f] },
  python:     { ext: '.py',  cmd: 'uv',   args: (f) => ['run', f] },
  bash:       { ext: '.sh',  cmd: 'bash', args: (f) => [f] },
};

export async function executeCode(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const language = (input.language as string)?.toLowerCase();
  const code = input.code as string;

  if (!language || !code) {
    return JSON.stringify({ error: 'Missing required fields: language, code' });
  }

  const lang = LANG_CONFIG[language];
  if (!lang) {
    return JSON.stringify({ error: `Unsupported language: "${language}". Supported: ${Object.keys(LANG_CONFIG).join(', ')}` });
  }

  // Defense in depth: check denied patterns passed from orchestrator (normalized matching)
  const denied = (input[JOB_FIELD_DENIED_COMMANDS] as string[]) ?? [];
  if (denied.length > 0) {
    const normalized = code.toLowerCase().replace(/\s+/g, ' ');
    const match = denied.find(p => {
      const re = new RegExp(`\\b${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return re.test(normalized);
    });
    if (match) {
      return JSON.stringify({ error: `Command blocked by Command Shield: matches denied pattern "${match}"` });
    }
  }

  const secrets = (input[JOB_FIELD_SECRETS] as Record<string, string>) ?? {};
  const execDir = join(PATHS.workspace, EXEC_DIR);
  await mkdir(execDir, { recursive: true });

  const tmpFile = join(execDir, `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${lang.ext}`);
  await writeFile(tmpFile, code, 'utf-8');

  log('debug', 'execute_code', { language, codeLength: code.length });

  try {
    const result = await spawnProcess({
      cmd: lang.cmd,
      args: lang.args(tmpFile),
      cwd: process.env.HOME ?? PATHS.workspace,
      timeoutMs: EXECUTION_TIMEOUT_MS,
      workspacePath: PATHS.workspace,
      extraEnv: secrets,
      label: 'execute_code',
      signal,
    });

    log('debug', 'execute_code done', { language, exitCode: result.exitCode, stdoutLen: result.stdout.length });
    return JSON.stringify(result);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
