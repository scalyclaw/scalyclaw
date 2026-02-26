import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

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

/** Extra env vars for worker subprocesses (ensures bun is on PATH). */
export function getWorkerExtraEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (bunBinDir && !process.env.PATH?.includes(bunBinDir)) {
    env.PATH = `${bunBinDir}:${process.env.PATH ?? ''}`;
  }
  return env;
}
