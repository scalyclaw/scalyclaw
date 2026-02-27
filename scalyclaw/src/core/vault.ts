import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';

const SECRET_PREFIX = 'scalyclaw:secret:';
const VAR_PATTERN = /\$\{(\w+)\}/g;

export async function resolveSecret(name: string): Promise<string | null> {
  const redis = getRedis();
  const value = await redis.get(`${SECRET_PREFIX}${name}`);
  return value;
}

export async function resolveSecrets(obj: unknown): Promise<unknown> {
  if (typeof obj === 'string') {
    return resolveStringSecrets(obj);
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => resolveSecrets(item)));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = await resolveSecrets(value);
    }
    return result;
  }
  return obj;
}

async function resolveStringSecrets(str: string): Promise<string> {
  const matches = [...str.matchAll(VAR_PATTERN)];
  if (matches.length === 0) return str;

  let result = str;
  for (const match of matches) {
    const varName = match[1];
    const value = await resolveSecret(varName);
    if (value === null) {
      log('warn', `Vault: unresolved secret \${${varName}}`);
      continue;
    }
    result = result.replace(match[0], value);
  }
  return result;
}

export async function storeSecret(name: string, value: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${SECRET_PREFIX}${name}`, value);
}

export async function deleteSecret(name: string): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.del(`${SECRET_PREFIX}${name}`);
  return count > 0;
}

export async function listSecrets(): Promise<string[]> {
  const redis = getRedis();
  const keys = await redis.keys(`${SECRET_PREFIX}*`);
  return keys.map(k => k.slice(SECRET_PREFIX.length));
}

// ─── Secret Cache (for bulk resolution into env vars) ───

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

/** Resolve all vault secrets as a flat map (for passing in job data). */
export async function getAllSecrets(): Promise<Record<string, string>> {
  return getSecretEnv();
}
