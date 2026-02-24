import { getRedis } from './redis.js';
import { log } from './logger.js';

const SECRET_PREFIX = 'scalyclaw:secret:';
const VAR_PATTERN = /\$\{(\w+)\}/g;

export async function resolveSecret(name: string): Promise<string | null> {
  const redis = getRedis();
  const value = await redis.get(`${SECRET_PREFIX}${name}`);
  if (value !== null) return value;

  // Fallback to environment variable
  const envValue = process.env[name];
  if (envValue !== undefined) return envValue;

  return null;
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
