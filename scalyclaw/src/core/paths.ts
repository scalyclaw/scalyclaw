import { join } from 'node:path';
import { mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.scalyclaw');

let BASE = DEFAULT_BASE;

export function getBasePath(): string {
  return BASE;
}

/** Set the base path from config. Call before ensureDirectories(). */
export function setBasePath(path: string): void {
  // Resolve ~ to homedir
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    path = join(homedir(), path.slice(2));
  }
  BASE = path;
}

/** Dynamic PATHS object — always reflects current BASE */
export const PATHS = {
  get base() { return BASE; },
  get workspace() { return join(BASE, 'workspace'); },
  get logs() { return join(BASE, 'logs'); },
  get skills() { return join(BASE, 'skills'); },
  get agents() { return join(BASE, 'agents'); },
  get mind() { return join(BASE, 'mind'); },
  get database() { return join(BASE, 'database'); },
  get dbFile() { return join(BASE, 'database', 'scalyclaw.db'); },
  get configFile() { return join(homedir(), '.scalyclaw', 'scalyclaw.json'); },
};

// ── Setup config (scalyclaw.json) ──

export interface SetupConfig {
  homeDir: string;
  redis: {
    host: string;
    port: number;
    password: string | null;
    tls: boolean;
  };
}

/** Read and parse ~/.scalyclaw/scalyclaw.json. Throws if missing. */
export function loadSetupConfig(): SetupConfig {
  const path = PATHS.configFile;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SetupConfig;
  } catch (err) {
    throw new Error(`Setup config not found at ${path}. Run "bun run scalyclaw:node setup" first.`);
  }
}

/** Write setup config to ~/.scalyclaw/scalyclaw.json. Creates directory if needed. */
export function writeSetupConfig(config: SetupConfig): void {
  const path = PATHS.configFile;
  mkdirSync(join(homedir(), '.scalyclaw'), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/** Create all directories if they don't exist. Call once at startup. */
export function ensureDirectories(): void {
  for (const dir of [PATHS.base, PATHS.workspace, PATHS.logs, PATHS.skills, PATHS.agents, PATHS.mind, PATHS.database]) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Worker setup config (worker.json) ──

export interface WorkerSetupConfig {
  homeDir: string;
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

/** Copy mind/ reference docs from project source to data dir. Call after ensureDirectories(). */
export function syncMindFiles(): void {
  const sourceDir = join(process.cwd(), 'mind');
  try {
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        copyFileSync(join(sourceDir, entry.name), join(PATHS.mind, entry.name));
      }
    }
  } catch {
    // mind/ source dir missing — skip (e.g. standalone worker without source)
  }
}
