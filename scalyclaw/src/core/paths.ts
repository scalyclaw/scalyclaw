import { join } from 'node:path';
import { mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

// Re-export generic parts from shared
export { PATHS, setBasePath, getBasePath } from '@scalyclaw/shared/core/paths.js';
import { PATHS } from '@scalyclaw/shared/core/paths.js';

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
