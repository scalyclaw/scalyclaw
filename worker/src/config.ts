import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

export interface WorkerSetupConfig {
  homeDir: string;
  advertiseHost?: string;
  gateway: {
    host: string;
    port: number;
    tls: boolean;
    authToken: string | null;
  };
  redis: {
    host: string;
    port: number;
    password: string | null;
    tls: boolean;
  };
  node: {
    url: string;
    token: string;
  };
  concurrency: number;
}

const DEFAULT_WORKER_CONFIG_DIR = join(homedir(), '.scalyclaw-worker');

/** Read and parse worker.json. Throws if missing. */
export function loadWorkerSetupConfig(configPath?: string): WorkerSetupConfig {
  const path = configPath ?? join(DEFAULT_WORKER_CONFIG_DIR, 'worker.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as WorkerSetupConfig;
  } catch (err) {
    throw new Error(`Worker config not found at ${path}. Run "bun run scalyclaw:worker setup" first.`);
  }
}

/** Write worker config to worker.json inside homeDir. Creates directory if needed. */
export function writeWorkerSetupConfig(config: WorkerSetupConfig): void {
  const resolvedHome = config.homeDir.startsWith('~/') || config.homeDir.startsWith('~\\')
    ? join(homedir(), config.homeDir.slice(2))
    : config.homeDir;
  mkdirSync(resolvedHome, { recursive: true });
  const path = join(resolvedHome, 'worker.json');
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
