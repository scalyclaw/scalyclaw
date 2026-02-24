import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { log } from '@scalyclaw/scalyclaw/core/logger.js';
import { spawnProcess } from '@scalyclaw/scalyclaw/core/subprocess.js';
import { PATHS } from '@scalyclaw/scalyclaw/core/paths.js';

export async function executeCommand(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const command = (input.command ?? input.code ?? input.script) as string;
  const stdinInput = (input.input as string) ?? '';

  if (!command) {
    return JSON.stringify({ error: 'Missing required field: command (bash script/command to execute)' });
  }

  const secrets = (input._secrets as Record<string, string>) ?? {};
  const execDir = join(PATHS.workspace, '_exec');
  await mkdir(execDir, { recursive: true });

  const tmpFile = join(execDir, `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`);
  await writeFile(tmpFile, command, 'utf-8');

  log('debug', 'execute_command', { commandLength: command.length });

  try {
    const result = await spawnProcess({
      cmd: 'bash',
      args: [tmpFile],
      cwd: PATHS.workspace,
      timeoutMs: 30_000,
      input: stdinInput,
      workspacePath: PATHS.workspace,
      extraEnv: secrets,
      label: 'execute_command',
      signal,
    });

    log('debug', 'execute_command done', { exitCode: result.exitCode, stdoutLen: result.stdout.length });
    return JSON.stringify(result);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
