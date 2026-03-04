import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { WHICH_TIMEOUT_MS } from './const/constants.js';

const RUNTIMES = ['bun', 'uv', 'cargo'] as const;

/** Cached bin directories for each runtime (null = not found). */
const runtimeBinDirs: Record<string, string | null> = {};

for (const cmd of RUNTIMES) {
  let binDir: string | null = null;
  try {
    // For bun: check if the current process IS bun
    if (cmd === 'bun' && process.argv[0]?.includes('bun')) {
      binDir = dirname(process.argv[0]);
    }
    if (!binDir) {
      const which = spawnSync('which', [cmd], { stdio: 'pipe', timeout: WHICH_TIMEOUT_MS });
      const resolved = which.stdout?.toString().trim();
      binDir = resolved ? dirname(resolved) : null;
    }
  } catch {
    binDir = null;
  }
  runtimeBinDirs[cmd] = binDir;
}

/** Extra env vars for worker subprocesses (ensures bun/uv/cargo are on PATH). */
export function getWorkerExtraEnv(): Record<string, string> {
  const currentPath = process.env.PATH ?? '';
  const extraDirs: string[] = [];

  for (const cmd of RUNTIMES) {
    const dir = runtimeBinDirs[cmd];
    if (dir && !currentPath.includes(dir)) {
      extraDirs.push(dir);
    }
  }

  if (extraDirs.length === 0) return {};
  return { PATH: `${extraDirs.join(':')}:${currentPath}` };
}
