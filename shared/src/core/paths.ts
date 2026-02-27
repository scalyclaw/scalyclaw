import { join } from 'node:path';
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
