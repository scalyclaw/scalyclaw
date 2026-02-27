import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { log } from '@scalyclaw/shared/core/logger.js';
import { spawnProcess } from './subprocess.js';
import { PATHS } from '@scalyclaw/shared/core/paths.js';

export async function executeCommand(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const command = (input.command ?? input.code ?? input.script) as string;
  const stdinInput = (input.input as string) ?? '';

  if (!command) {
    return JSON.stringify({ error: 'Missing required field: command (bash script/command to execute)' });
  }

  // Defense in depth: check denied patterns passed from orchestrator (normalized matching)
  const denied = (input._deniedCommands as string[]) ?? [];
  if (denied.length > 0) {
    const normalized = command.toLowerCase().replace(/\s+/g, ' ');
    const match = denied.find(p => {
      const re = new RegExp(`\\b${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return re.test(normalized);
    });
    if (match) {
      return JSON.stringify({ error: `Command blocked by Command Shield: matches denied pattern "${match}"` });
    }
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
      cwd: process.env.HOME ?? PATHS.workspace,
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
