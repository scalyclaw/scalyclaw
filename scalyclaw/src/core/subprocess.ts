import { spawn } from 'node:child_process';
import { log } from './logger.js';
import { listSecrets } from './vault.js';
import { getRedis } from './redis.js';

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

// ─── Secret Cache ───

let secretCache: Map<string, string> | null = null;
let secretCacheAge = 0;
const SECRET_CACHE_TTL = 30_000;

async function getSecretEnv(): Promise<Record<string, string>> {
  if (secretCache && Date.now() - secretCacheAge < SECRET_CACHE_TTL) {
    return Object.fromEntries(secretCache);
  }
  const names = await listSecrets();
  if (names.length === 0) {
    secretCache = new Map();
    secretCacheAge = Date.now();
    return {};
  }

  // Pipeline: fetch all secrets in a single Redis round-trip
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const name of names) {
    pipeline.get(`scalyclaw:secret:${name}`);
  }
  const results = await pipeline.exec();

  secretCache = new Map();
  for (let i = 0; i < names.length; i++) {
    const [err, value] = results![i];
    if (!err && typeof value === 'string') {
      secretCache.set(names[i], value);
    } else {
      // Fallback to env var
      const envValue = process.env[names[i]];
      if (envValue !== undefined) secretCache.set(names[i], envValue);
    }
  }
  secretCacheAge = Date.now();
  return Object.fromEntries(secretCache);
}

/** Invalidate the secret cache (e.g. after storing a new secret) */
export function invalidateSecretCache(): void {
  secretCache = null;
  secretCacheAge = 0;
}

/**
 * Spawn a child process with the given env vars.
 * Does NOT read from vault — use when secrets are passed explicitly (e.g. from job data).
 */
export function spawnProcess(opts: SpawnOptions): Promise<SpawnResult> {
  const { cmd, args, cwd, timeoutMs, input, workspacePath, extraEnv, label = 'subprocess', signal } = opts;

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        LANG: process.env.LANG ?? '',
        TERM: process.env.TERM ?? '',
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

/**
 * Resolve all vault secrets and spawn a child process with them as env vars.
 * Use for local execution only — for worker jobs, resolve secrets on the
 * orchestrator and pass them via job data to spawnProcess() instead.
 */
export async function spawnWithSecrets(opts: SpawnOptions): Promise<SpawnResult> {
  const secretEnv = await getSecretEnv();
  return spawnProcess({
    ...opts,
    extraEnv: { ...secretEnv, ...opts.extraEnv },
  });
}

/** Resolve all vault secrets as a flat map (for passing in job data). */
export async function getAllSecrets(): Promise<Record<string, string>> {
  return getSecretEnv();
}
