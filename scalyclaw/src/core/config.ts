import { getRedis } from './redis.js';
import { log } from './logger.js';
import { createReloadChannel } from './reload-channel.js';

const CONFIG_KEY = 'scalyclaw:config';

const configReload = createReloadChannel('scalyclaw:config:reload');
export const publishConfigReload = configReload.publish;
export const subscribeToConfigReload = configReload.subscribe;

// ─── Error ──────────────────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ─── Types ──────────────────────────────────────────────────────────

export interface McpServerConfig {
  // Transport — auto-detected from fields if omitted
  transport?: 'stdio' | 'http' | 'sse';

  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // http / sse
  url?: string;
  headers?: Record<string, string>;

  // Common (defaults to true)
  enabled?: boolean;
}

export interface ScalyClawConfig {
  orchestrator: {
    id: string;
    maxIterations: number;
    models: { model: string; weight: number; priority: number }[];
    skills: string[];
    agents: { id: string; enabled: boolean; maxIterations: number; models: { model: string; weight: number; priority: number }[]; skills: string[]; tools: string[]; mcpServers: string[] }[];
  };
  gateway: {
    host: string;
    port: number;
    bind: string;
    authType: string;
    authValue: string | null;
    tls: { cert: string; key: string };
    cors: string[];
  };
  logs: { level: string; format: string; type: string };
  memory: {
    topK: number;
    scoreThreshold: number;
    embeddingModel: string;
  };
  queue: {
    lockDuration: number;
    stalledInterval: number;
    limiter: { max: number; duration: number };
    removeOnComplete: { age: number; count: number };
    removeOnFail: { age: number };
  };
  models: {
    providers: Record<string, {
      apiKey?: string;
      baseUrl?: string;
    }>;
    models: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      priority: number;
      weight: number;
      temperature: number;
      maxTokens: number;
      contextWindow: number;
      toolEnabled: boolean;
      imageEnabled: boolean;
      audioEnabled: boolean;
      videoEnabled: boolean;
      documentEnabled: boolean;
      reasoningEnabled: boolean;
      inputPricePerMillion: number;
      outputPricePerMillion: number;
    }[];
    embeddingModels: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      priority: number;
      weight: number;
      dimensions: number;
      inputPricePerMillion: number;
      outputPricePerMillion: number;
    }[];
  };
  guards: {
    message: {
      enabled: boolean;
      model: string;
      echoGuard: { enabled: boolean; similarityThreshold: number };
      contentGuard: { enabled: boolean };
    };
    skill: { enabled: boolean; model: string };
    agent: { enabled: boolean; model: string };
  };
  budget: {
    monthlyLimit: number;
    dailyLimit: number;
    hardLimit: boolean;
    alertThresholds: number[];
  };
  proactive: {
    enabled: boolean;
    model: string;
    cronPattern: string;
    idleThresholdMinutes: number;
    cooldownSeconds: number;
    maxPerDay: number;
    quietHours: {
      enabled: boolean;
      start: number;
      end: number;
      timezone: string;
    };
    triggers: {
      undeliveredResults: boolean;
      firedScheduledItems: boolean;
      unansweredMessages: boolean;
    };
  };
  channels: Record<string, Record<string, unknown>>;
  skills: { id: string; enabled: boolean }[];
  mcpServers: Record<string, McpServerConfig>;
}

// ─── Defaults ───────────────────────────────────────────────────────

export const CONFIG_DEFAULTS: ScalyClawConfig = {
  orchestrator: { id: 'default', maxIterations: 50, models: [], skills: [], agents: [] },
  gateway: {
    host: '127.0.0.1',
    port: 3000,
    bind: '127.0.0.1',
    authType: 'none',
    authValue: null,
    tls: { cert: '', key: '' },
    cors: ['*'],
  },
  logs: { level: 'info', format: 'json', type: 'console' },
  memory: { topK: 10, scoreThreshold: 0.5, embeddingModel: 'auto' },
  queue: {
    lockDuration: 120_000,
    stalledInterval: 30_000,
    limiter: { max: 10, duration: 1000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800 },
  },
  models: { providers: {}, models: [], embeddingModels: [] },
  budget: { monthlyLimit: 0, dailyLimit: 0, hardLimit: false, alertThresholds: [50, 80, 90] },
  proactive: {
    enabled: true,
    model: '',
    cronPattern: '*/15 * * * *',
    idleThresholdMinutes: 120,
    cooldownSeconds: 14400,
    maxPerDay: 3,
    quietHours: { enabled: true, start: 22, end: 8, timezone: 'UTC' },
    triggers: { undeliveredResults: true, firedScheduledItems: true, unansweredMessages: true },
  },
  guards: {
    message: {
      enabled: true,
      model: '',
      echoGuard: { enabled: true, similarityThreshold: 0.9 },
      contentGuard: { enabled: true },
    },
    skill: { enabled: true, model: '' },
    agent: { enabled: true, model: '' },
  },
  channels: {},
  skills: [],
  mcpServers: {},
};

// ─── Deep Merge ─────────────────────────────────────────────────────

/** Keys whose values are dynamic records or arrays — kept as-is from loaded data */
const DYNAMIC_KEYS = new Set([
  'channels', 'mcpServers', 'providers', 'models', 'embeddingModels', 'agents', 'skills', 'cors', 'alertThresholds',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Recursively fill missing keys from defaults. Dynamic keys keep loaded value as-is. */
function deepMerge(loaded: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const result = { ...loaded };
  for (const key of Object.keys(defaults)) {
    if (DYNAMIC_KEYS.has(key)) {
      // Keep loaded value if present, else use default
      if (!(key in result)) {
        result[key] = defaults[key];
      }
      continue;
    }
    if (isPlainObject(defaults[key]) && isPlainObject(result[key])) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        defaults[key] as Record<string, unknown>,
      );
    } else if (!(key in result)) {
      result[key] = defaults[key];
    }
  }
  return result;
}

// ─── Validation ─────────────────────────────────────────────────────

export function validateConfig(config: unknown): asserts config is ScalyClawConfig {
  if (!isPlainObject(config)) {
    throw new ConfigError('Config must be a plain object');
  }

  const c = config as Record<string, unknown>;

  // orchestrator
  if (!isPlainObject(c.orchestrator)) throw new ConfigError('Missing or invalid "orchestrator" section');
  const orch = c.orchestrator as Record<string, unknown>;
  if (typeof orch.id !== 'string') throw new ConfigError('orchestrator.id must be a string');
  if (typeof orch.maxIterations !== 'number' || orch.maxIterations < 1) {
    throw new ConfigError('orchestrator.maxIterations must be a positive number');
  }
  if (!Array.isArray(orch.models)) throw new ConfigError('orchestrator.models must be an array');

  // gateway
  if (!isPlainObject(c.gateway)) throw new ConfigError('Missing or invalid "gateway" section');
  const gw = c.gateway as Record<string, unknown>;
  if (typeof gw.port !== 'number') throw new ConfigError('gateway.port must be a number');
  if (typeof gw.authType !== 'string') throw new ConfigError('gateway.authType must be a string');

  // logs
  if (!isPlainObject(c.logs)) throw new ConfigError('Missing or invalid "logs" section');
  const logs = c.logs as Record<string, unknown>;
  if (typeof logs.level !== 'string') throw new ConfigError('logs.level must be a string');

  // memory
  if (!isPlainObject(c.memory)) throw new ConfigError('Missing or invalid "memory" section');

  // queue
  if (!isPlainObject(c.queue)) throw new ConfigError('Missing or invalid "queue" section');

  // models
  if (!isPlainObject(c.models)) throw new ConfigError('Missing or invalid "models" section');
  const models = c.models as Record<string, unknown>;
  if (!Array.isArray(models.models)) throw new ConfigError('models.models must be an array');
  if (!Array.isArray(models.embeddingModels)) throw new ConfigError('models.embeddingModels must be an array');

  // guards
  if (!isPlainObject(c.guards)) throw new ConfigError('Missing or invalid "guards" section');

  // budget (optional — filled by defaults)
  if (c.budget !== undefined) {
    if (!isPlainObject(c.budget)) throw new ConfigError('"budget" must be an object');
    const b = c.budget as Record<string, unknown>;
    if (typeof b.monthlyLimit !== 'number' || b.monthlyLimit < 0) throw new ConfigError('budget.monthlyLimit must be a non-negative number');
    if (typeof b.dailyLimit !== 'number' || b.dailyLimit < 0) throw new ConfigError('budget.dailyLimit must be a non-negative number');
    if (typeof b.hardLimit !== 'boolean') throw new ConfigError('budget.hardLimit must be a boolean');
    if (!Array.isArray(b.alertThresholds)) throw new ConfigError('budget.alertThresholds must be an array');
  }

  // proactive (optional — filled by defaults)
  if (c.proactive !== undefined) {
    if (!isPlainObject(c.proactive)) throw new ConfigError('"proactive" must be an object');
    const p = c.proactive as Record<string, unknown>;
    if (typeof p.enabled !== 'boolean') throw new ConfigError('proactive.enabled must be a boolean');
    if (typeof p.cronPattern !== 'string') throw new ConfigError('proactive.cronPattern must be a string');
    if (typeof p.idleThresholdMinutes !== 'number' || p.idleThresholdMinutes < 1) throw new ConfigError('proactive.idleThresholdMinutes must be a positive number');
    if (typeof p.cooldownSeconds !== 'number' || p.cooldownSeconds < 0) throw new ConfigError('proactive.cooldownSeconds must be a non-negative number');
    if (typeof p.maxPerDay !== 'number' || p.maxPerDay < 1) throw new ConfigError('proactive.maxPerDay must be a positive number');
  }
}

// ─── Cache ──────────────────────────────────────────────────────────

let cachedConfig: Readonly<ScalyClawConfig> | null = null;

// ─── Load ───────────────────────────────────────────────────────────

export async function loadConfig(): Promise<ScalyClawConfig> {
  const redis = getRedis();
  const raw = await redis.get(CONFIG_KEY);
  if (!raw) {
    throw new ConfigError(`Config not found at Redis key "${CONFIG_KEY}"`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ConfigError('Config in Redis is not valid JSON');
  }

  // Strip legacy fields that belong in scalyclaw.json, not in Redis config
  delete parsed.homeDir;
  delete parsed.redis;

  // Fill missing keys from defaults
  const merged = deepMerge(parsed, CONFIG_DEFAULTS as unknown as Record<string, unknown>) as unknown as ScalyClawConfig;

  // Validate
  validateConfig(merged);

  // Atomic swap: freeze a clone for the cache, keep merged mutable for return
  cachedConfig = Object.freeze(structuredClone(merged));

  // Log summary
  const providerNames = Object.keys(merged.models.providers);
  const channelNames = Object.keys(merged.channels).filter(k => (merged.channels[k] as Record<string, unknown>).enabled);
  const g = merged.guards;
  const activeGuards = [
    g.message.enabled && `message(echo=${g.message.echoGuard.enabled},content=${g.message.contentGuard.enabled})`,
    g.skill.enabled && 'skill',
    g.agent.enabled && 'agent',
  ].filter(Boolean);
  log('info', 'Config loaded from Redis', {
    chatModels: merged.models.models.length,
    embeddingModels: merged.models.embeddingModels.length,
    providers: providerNames.join(', '),
    channels: channelNames.join(', '),
    guards: activeGuards.length ? activeGuards.join(', ') : '(none)',
    logLevel: merged.logs.level,
  });

  return merged;
}

// ─── Accessors ──────────────────────────────────────────────────────

/** Returns a deep clone — safe for mutation workflows (API routes that mutate-then-save). */
export function getConfig(): ScalyClawConfig {
  if (!cachedConfig) throw new ConfigError('Config not loaded — call loadConfig first');
  return structuredClone(cachedConfig) as ScalyClawConfig;
}

/** Returns the frozen cached object — zero-cost read-only access. Callers must not mutate. */
export function getConfigRef(): Readonly<ScalyClawConfig> {
  if (!cachedConfig) throw new ConfigError('Config not loaded — call loadConfig first');
  return cachedConfig;
}

// ─── Save ───────────────────────────────────────────────────────────

export async function saveConfig(config: ScalyClawConfig): Promise<void> {
  validateConfig(config);
  const redis = getRedis();
  await redis.set(CONFIG_KEY, JSON.stringify(config));
  cachedConfig = Object.freeze(structuredClone(config));
}

// ─── Atomic Update ──────────────────────────────────────────────────

/** Clone -> apply updater -> validate -> save to Redis -> update cache. */
export async function updateConfig(updater: (draft: ScalyClawConfig) => void): Promise<ScalyClawConfig> {
  const draft = getConfig(); // already a clone
  updater(draft);
  await saveConfig(draft);
  return draft;
}

// ─── Redact ──────────────────────────────────────────────────────────

/** Return a deep clone with sensitive fields masked. Safe for API responses. */
export function redactConfig(config: Readonly<ScalyClawConfig>): Record<string, unknown> {
  const clone = structuredClone(config);
  for (const p of Object.values(clone.models.providers)) {
    if (p.apiKey) p.apiKey = '***';
  }
  if (clone.gateway.authValue) clone.gateway.authValue = '***';
  return clone as unknown as Record<string, unknown>;
}
