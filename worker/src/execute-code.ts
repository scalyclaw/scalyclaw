import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { log } from '@scalyclaw/scalyclaw/core/logger.js';
import { spawnProcess } from '@scalyclaw/scalyclaw/core/subprocess.js';
import { PATHS } from '@scalyclaw/scalyclaw/core/paths.js';

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

  const secrets = (input._secrets as Record<string, string>) ?? {};
  const execDir = join(PATHS.workspace, '_exec');
  await mkdir(execDir, { recursive: true });

  const tmpFile = join(execDir, `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${lang.ext}`);
  await writeFile(tmpFile, code, 'utf-8');

  log('debug', 'execute_code', { language, codeLength: code.length });

  try {
    const result = await spawnProcess({
      cmd: lang.cmd,
      args: lang.args(tmpFile),
      cwd: PATHS.workspace,
      timeoutMs: 30_000,
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
