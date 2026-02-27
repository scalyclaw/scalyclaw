import { spawn } from 'node:child_process';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnOptions {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  input?: string;
  workspacePath: string;
  extraEnv?: Record<string, string>;
  label?: string;
  signal?: AbortSignal;
}

/**
 * Spawn a child process with the given env vars.
 * Does NOT read from vault — secrets come from job data.
 */
export function spawnProcess(opts: SpawnOptions): Promise<SpawnResult> {
  const { cmd, args, cwd, timeoutMs, input, workspacePath, extraEnv, label = 'subprocess', signal } = opts;

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
        WORKSPACE_DIR: workspacePath,
      },
    });

    // AbortSignal support — kill the child process on abort
    const onAbort = () => {
      child.kill('SIGTERM');
      // Force kill after 3s if still alive
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000).unref();
    };
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let stdout = '';
    let stderr = '';
    const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout.on('data', (data: Buffer) => {
      if (!stdoutTruncated) {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT);
          stdoutTruncated = true;
        }
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      if (!stderrTruncated) {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT);
          stderrTruncated = true;
        }
      }
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      log('debug', `${label}: done`, { cmd, exitCode: code, stdoutLen: stdout.length, stderrLen: stderr.length });
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      log('error', `${label}: failed`, { cmd, error: String(err) });
      resolve({ stdout: stdout.trim(), stderr: (stderr || String(err)).trim(), exitCode: 1 });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}
