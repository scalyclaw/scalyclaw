import { getRedis } from '../core/redis.js';
import { log } from '../core/logger.js';
import { randomUUID } from 'node:crypto';

// ─── Types ───

export type SessionState = 'IDLE' | 'PROCESSING' | 'TOOL_EXEC' | 'RESPONDING' | 'DRAINING' | 'CANCELLING';

export interface SessionInfo {
  sessionId: string;
  state: SessionState;
  startedAt: string;
  heartbeat: string;
  round: number;
  toolName: string;
}

const SESSION_PREFIX = 'scalyclaw:session:';
const SESSION_SAFETY_TTL_MS = 300_000; // 5 min auto-expire
const STALE_THRESHOLD_MS = 60_000; // 60s without heartbeat = stale

// ─── Lua Scripts ───

/** Atomically acquire a session if none exists (or existing is stale) */
const ACQUIRE_LUA = `
local key = KEYS[1]
local sessionId = ARGV[1]
local now = ARGV[2]
local staleTTL = tonumber(ARGV[3])
local safetyTTL = tonumber(ARGV[4])

local existing = redis.call('HGET', key, 'heartbeat')
if existing then
  local elapsed = tonumber(now) - tonumber(existing)
  if elapsed < staleTTL then
    return 0 -- session is active, can't acquire
  end
  -- stale session — take over
  redis.call('DEL', key)
end

redis.call('HSET', key,
  'sessionId', sessionId,
  'state', 'PROCESSING',
  'startedAt', now,
  'heartbeat', now,
  'round', '0',
  'toolName', ''
)
redis.call('PEXPIRE', key, safetyTTL)
return 1
`;

/** Release session only if we own it */
const RELEASE_LUA = `
local key = KEYS[1]
local sessionId = ARGV[1]
local current = redis.call('HGET', key, 'sessionId')
if current == sessionId then
  redis.call('DEL', key)
  return 1
end
return 0
`;

/** Update heartbeat + state, only if we own the session. Never overwrite CANCELLING. */
const HEARTBEAT_LUA = `
local key = KEYS[1]
local sessionId = ARGV[1]
local now = ARGV[2]
local state = ARGV[3]
local round = ARGV[4]
local toolName = ARGV[5]
local safetyTTL = tonumber(ARGV[6])

local current = redis.call('HGET', key, 'sessionId')
if current ~= sessionId then
  return 0
end

local currentState = redis.call('HGET', key, 'state')
if currentState == 'CANCELLING' then
  redis.call('HSET', key, 'heartbeat', now)
  redis.call('PEXPIRE', key, safetyTTL)
  return 2
end

redis.call('HSET', key, 'heartbeat', now, 'state', state)
if round ~= '' then
  redis.call('HSET', key, 'round', round)
end
if toolName ~= '' then
  redis.call('HSET', key, 'toolName', toolName)
end
redis.call('PEXPIRE', key, safetyTTL)
return 1
`;

/** Set state to CANCELLING if session exists */
const CANCEL_LUA = `
local key = KEYS[1]
local existing = redis.call('HGET', key, 'sessionId')
if not existing then
  return 0
end
redis.call('HSET', key, 'state', 'CANCELLING')
return 1
`;

// ─── Public API ───

export async function acquireSession(channelId: string): Promise<{ acquired: boolean; sessionId: string }> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;
  const sessionId = randomUUID();
  const now = String(Date.now());

  const result = await redis.eval(
    ACQUIRE_LUA, 1, key,
    sessionId, now, String(STALE_THRESHOLD_MS), String(SESSION_SAFETY_TTL_MS),
  ) as number;

  if (result === 1) {
    log('debug', 'Session acquired', { channelId, sessionId });
    return { acquired: true, sessionId };
  }

  log('debug', 'Session not acquired — channel busy', { channelId });
  return { acquired: false, sessionId: '' };
}

export async function releaseSession(channelId: string, sessionId: string): Promise<void> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;

  const result = await redis.eval(RELEASE_LUA, 1, key, sessionId) as number;
  log('debug', 'Session released', { channelId, sessionId, released: result === 1 });
}

export async function heartbeat(
  channelId: string,
  sessionId: string,
  state: SessionState,
  extra?: { round?: number; toolName?: string },
): Promise<boolean> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;
  const now = String(Date.now());

  const result = await redis.eval(
    HEARTBEAT_LUA, 1, key,
    sessionId, now, state,
    extra?.round !== undefined ? String(extra.round) : '',
    extra?.toolName ?? '',
    String(SESSION_SAFETY_TTL_MS),
  ) as number;

  return result === 1;
}

export async function getSession(channelId: string): Promise<SessionInfo | null> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;
  const data = await redis.hgetall(key);

  if (!data || !data.sessionId) return null;

  return {
    sessionId: data.sessionId,
    state: data.state as SessionState,
    startedAt: data.startedAt,
    heartbeat: data.heartbeat,
    round: Number(data.round) || 0,
    toolName: data.toolName || '',
  };
}

export async function requestCancel(channelId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;

  const result = await redis.eval(CANCEL_LUA, 1, key) as number;
  log('info', 'Cancel requested', { channelId, cancelled: result === 1 });
  return result === 1;
}

export async function isStale(channelId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;
  const hb = await redis.hget(key, 'heartbeat');
  if (!hb) return false; // no session = not stale
  return Date.now() - Number(hb) > STALE_THRESHOLD_MS;
}

export async function getSessionState(channelId: string): Promise<SessionState | null> {
  const redis = getRedis();
  const key = `${SESSION_PREFIX}${channelId}`;
  const state = await redis.hget(key, 'state');
  return (state as SessionState) || null;
}

// ─── withSession helper ───

export async function withSession<T>(
  channelId: string,
  fn: (sessionId: string) => Promise<T>,
  onBusy?: () => Promise<void>,
): Promise<T | null> {
  const { acquired, sessionId } = await acquireSession(channelId);
  if (!acquired) {
    if (onBusy) await onBusy();
    return null;
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      await releaseSession(channelId, sessionId);
    } catch (err) {
      log('error', 'Failed to release session', { channelId, sessionId, error: String(err) });
    }
  }
}
