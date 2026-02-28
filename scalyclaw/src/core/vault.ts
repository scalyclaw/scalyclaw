import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import {
  encrypt, decrypt, decryptWithKey, encryptWithKey,
  rotatePassword, getKey,
} from './vault-crypto.js';
import { SECRET_KEY_PREFIX, VAULT_RECOVERY_KEY, RECOVERY_KEY_TTL_S, SECRET_CACHE_TTL_MS } from '../const/constants.js';

const VAR_PATTERN = /\$\{(\w+)\}/g;

// ─── Decrypt with recovery-key fallback ───

async function decryptWithRecovery(raw: string): Promise<string> {
  try {
    return decrypt(raw);
  } catch {
    // Primary key failed — check for recovery key from a recent rotation
    const redis = getRedis();
    const recoveryHex = await redis.get(VAULT_RECOVERY_KEY);
    if (recoveryHex) {
      try {
        return decryptWithKey(raw, Buffer.from(recoveryHex, 'hex'));
      } catch {
        // Recovery key also failed
      }
    }
    throw new Error('Failed to decrypt vault secret (no valid key)');
  }
}

// ─── Core CRUD ───

export async function resolveSecret(name: string): Promise<string | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SECRET_KEY_PREFIX}${name}`);
  if (raw === null) return null;
  return decryptWithRecovery(raw);
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
  const encrypted = encrypt(value);
  await redis.set(`${SECRET_KEY_PREFIX}${name}`, encrypted);
  invalidateSecretCache();
}

export async function deleteSecret(name: string): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.del(`${SECRET_KEY_PREFIX}${name}`);
  invalidateSecretCache();
  return count > 0;
}

export async function listSecrets(): Promise<string[]> {
  const redis = getRedis();
  const keys = await redis.keys(`${SECRET_KEY_PREFIX}*`);
  return keys.map(k => k.slice(SECRET_KEY_PREFIX.length));
}

// ─── Secret Cache (for bulk resolution into env vars) ───

let secretCache: Map<string, string> | null = null;
let secretCacheAge = 0;
const SECRET_CACHE_TTL = SECRET_CACHE_TTL_MS;

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
      try {
        const decrypted = await decryptWithRecovery(value);
        secretCache.set(names[i], decrypted);
      } catch (e) {
        log('warn', `Vault: failed to decrypt secret "${names[i]}"`, { error: String(e) });
      }
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

// ─── Key Rotation ───

export async function rotateAllSecrets(): Promise<void> {
  const redis = getRedis();
  const currentKey = getKey();

  // 1. Read all secrets
  const names = await listSecrets();
  if (names.length === 0) {
    // Still rotate the password even with no secrets
    rotatePassword();
    log('info', 'Vault key rotation complete (no secrets to re-encrypt)');
    return;
  }

  const pipeline = redis.pipeline();
  for (const name of names) {
    pipeline.get(`${SECRET_KEY_PREFIX}${name}`);
  }
  const results = await pipeline.exec();

  // 2. Decrypt all with current key
  const plaintexts: Array<{ name: string; value: string }> = [];
  for (let i = 0; i < names.length; i++) {
    const [err, raw] = results![i];
    if (err || typeof raw !== 'string') continue;
    try {
      const value = decryptWithKey(raw, currentKey);
      plaintexts.push({ name: names[i], value });
    } catch (e) {
      log('warn', `Vault rotation: failed to decrypt "${names[i]}", skipping`, { error: String(e) });
    }
  }

  // 3. Set recovery key (old derived key — scrypt output, not the password)
  await redis.set(VAULT_RECOVERY_KEY, currentKey.toString('hex'), 'EX', RECOVERY_KEY_TTL_S);

  // 4. Rotate password file → new key
  const { newKey } = rotatePassword();

  // 5. Re-encrypt all with new key
  const writePipeline = redis.pipeline();
  for (const { name, value } of plaintexts) {
    const encrypted = encryptWithKey(value, newKey);
    writePipeline.set(`${SECRET_KEY_PREFIX}${name}`, encrypted);
  }
  await writePipeline.exec();

  // 6. Clean up recovery key
  await redis.del(VAULT_RECOVERY_KEY);

  // 7. Invalidate caches
  invalidateSecretCache();

  log('info', 'Vault key rotation complete', { secretCount: plaintexts.length });
}
