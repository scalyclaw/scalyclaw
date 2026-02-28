import type { Redis } from 'ioredis';
import { hostname } from 'node:os';
import { PROCESS_KEY_PREFIX, PROCESS_TTL_S, PROCESS_HEARTBEAT_MS } from '../const/constants.js';

export interface ProcessInfo {
  id: string;
  type: 'node' | 'worker' | 'dashboard';
  host: string;
  port: number;
  hostname: string;
  startedAt: string;
  uptime: number;
  version: string;
  concurrency: number | null;
  authToken?: string | null;
  tls?: boolean;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let registeredKey: string | null = null;
let registeredInfo: ProcessInfo | null = null;
let startTime: number = 0;

export async function registerProcess(redis: Redis, info: Omit<ProcessInfo, 'uptime'>): Promise<void> {
  const key = PROCESS_KEY_PREFIX + info.id;
  registeredKey = key;
  registeredInfo = { ...info, uptime: 0 };
  startTime = Date.now();

  await redis.set(key, JSON.stringify(registeredInfo), 'EX', PROCESS_TTL_S);

  // Heartbeat: refresh TTL and update uptime
  heartbeatTimer = setInterval(async () => {
    if (!registeredInfo) return;
    registeredInfo.uptime = Math.floor((Date.now() - startTime) / 1000);
    try {
      await redis.set(key, JSON.stringify(registeredInfo), 'EX', PROCESS_TTL_S);
    } catch { /* Redis down — entry will expire, which is correct */ }
  }, PROCESS_HEARTBEAT_MS);
  heartbeatTimer.unref();
}

export async function deregisterProcess(redis: Redis): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (registeredKey) {
    await redis.del(registeredKey).catch(() => {});
    registeredKey = null;
    registeredInfo = null;
  }
}

/** Remove a process entry by its ID (used by CLI to clean up after kill). */
export async function deregisterProcessByKey(redis: Redis, id: string): Promise<void> {
  await redis.del(PROCESS_KEY_PREFIX + id).catch(() => {});
}

export async function listProcesses(redis: Redis): Promise<ProcessInfo[]> {
  const keys = await redis.keys(PROCESS_KEY_PREFIX + '*');
  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const processes: ProcessInfo[] = [];
  for (const raw of values) {
    if (raw) {
      try { processes.push(JSON.parse(raw)); } catch { /* skip corrupt */ }
    }
  }
  // Sort: node → worker → dashboard, then by startedAt
  const typeOrder: Record<string, number> = { node: 0, worker: 1, dashboard: 2 };
  processes.sort((a, b) => {
    const oa = typeOrder[a.type] ?? 9;
    const ob = typeOrder[b.type] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.startedAt.localeCompare(b.startedAt);
  });
  return processes;
}

/** Build a process ID from type, host, and port */
export function processId(type: 'node' | 'worker' | 'dashboard', host: string, port: number): string {
  return `${type}-${host}-${port}`;
}
