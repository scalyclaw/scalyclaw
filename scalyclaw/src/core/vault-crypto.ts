import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// ─── Constants ───

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = Buffer.from('scalyclaw-vault-kdf-salt-v1');
const PASSWORD_FILE = join(homedir(), 'scalyclaw.ps');

// ─── Password File ───

export function ensurePasswordFile(): void {
  try {
    statSync(PASSWORD_FILE);
  } catch {
    const password = randomBytes(64).toString('base64');
    const tmp = join(tmpdir(), `.scalyclaw-ps-${process.pid}-${Date.now()}`);
    writeFileSync(tmp, password + '\n', { mode: 0o600 });
    mkdirSync(dirname(PASSWORD_FILE), { recursive: true });
    renameSync(tmp, PASSWORD_FILE);
  }
}

export function readPassword(): string {
  try {
    return readFileSync(PASSWORD_FILE, 'utf-8').trim();
  } catch {
    throw new Error(`Vault password file not found at ${PASSWORD_FILE}. Run ensurePasswordFile() first.`);
  }
}

// ─── Key Derivation + Cache ───

let cachedKey: Buffer | null = null;
let cachedMtime = 0;

export function deriveKey(password: string): Buffer {
  return scryptSync(password, SALT, 32) as Buffer;
}

export function getKey(): Buffer {
  const mtime = statSync(PASSWORD_FILE).mtimeMs;
  if (cachedKey && mtime === cachedMtime) return cachedKey;
  const password = readPassword();
  cachedKey = deriveKey(password);
  cachedMtime = mtime;
  return cachedKey;
}

export function invalidateKeyCache(): void {
  cachedKey = null;
  cachedMtime = 0;
}

// ─── Encrypt / Decrypt ───

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptWithKey(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf-8');
}

export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getKey());
}

export function decrypt(ciphertext: string): string {
  return decryptWithKey(ciphertext, getKey());
}

// ─── Rotation ───

export function rotatePassword(): { oldKey: Buffer; newKey: Buffer } {
  const oldPassword = readPassword();
  const oldKey = deriveKey(oldPassword);

  const newPassword = randomBytes(64).toString('base64');
  const tmp = join(tmpdir(), `.scalyclaw-ps-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, newPassword + '\n', { mode: 0o600 });
  renameSync(tmp, PASSWORD_FILE);

  const newKey = deriveKey(newPassword);
  invalidateKeyCache();

  return { oldKey, newKey };
}
