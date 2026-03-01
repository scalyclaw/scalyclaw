import { Database } from 'bun:sqlite';
import { getLoadablePath } from 'sqlite-vec';
import { log } from '@scalyclaw/shared/core/logger.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../const/constants.js';

let db: Database | null = null;
let vecAvailable = false;

export function initDatabase(dbPath: string, dimensions: number): Database {
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    db.loadExtension(getLoadablePath());
    vecAvailable = true;
  } catch (err) {
    vecAvailable = false;
    log('warn', 'sqlite-vec extension failed to load — vector search will be unavailable', { error: String(err) });
  }

  runMigrations(db, dimensions);
  log('info', 'SQLite database initialized', { path: dbPath, vecAvailable });
  return db;
}

export function isVecAvailable(): boolean {
  return vecAvailable;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized — call initDatabase first');
  return db;
}

function runMigrations(db: Database, dimensions: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel     TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE TABLE IF NOT EXISTS usage_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT DEFAULT (datetime('now')),
      model         TEXT NOT NULL,
      provider      TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      type          TEXT NOT NULL,
      agent_id      TEXT,
      channel_id    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
  `);

  // ─── Memory schema v2 ───
  migrateMemorySchema(db, dimensions);

  log('info', 'Database migrations complete');
}

function migrateMemorySchema(db: Database, dimensions: number): void {
  const hasSubject = db.prepare(
    "SELECT COUNT(*) as c FROM pragma_table_info('memories') WHERE name = 'subject'"
  ).get() as { c: number };

  if (hasSubject.c > 0) return; // already on v2

  // Drop old tables (order matters for FKs)
  db.exec('DROP TABLE IF EXISTS memory_fts');
  db.exec('DROP TABLE IF EXISTS memory_vec');
  db.exec('DROP TABLE IF EXISTS memory_tags');
  db.exec('DROP TABLE IF EXISTS memories');

  db.exec(`
    CREATE TABLE memories (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      subject     TEXT NOT NULL,
      content     TEXT NOT NULL,
      tags        TEXT,
      source      TEXT,
      confidence  INTEGER DEFAULT 2,
      embedding   BLOB,
      ttl         TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_memories_type ON memories(type);
    CREATE INDEX idx_memories_ttl ON memories(ttl);
    CREATE INDEX idx_memories_confidence ON memories(confidence);
    CREATE INDEX idx_memories_updated ON memories(updated_at);

    CREATE TABLE memory_tags (
      memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag         TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag)
    );
    CREATE INDEX idx_memory_tags_tag ON memory_tags(tag);
  `);

  if (vecAvailable) {
    db.exec(`
      CREATE VIRTUAL TABLE memory_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      );
    `);
  }

  db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, subject, content, tags, type UNINDEXED);`);

  log('info', 'Memory schema v2 created');
}

// ─── Message helpers ───

export interface Message {
  id: number;
  channel: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

export function storeMessage(channelId: string, role: string, content: string, metadata?: Record<string, unknown>): number {
  const d = getDb();
  d.prepare(
    'INSERT INTO messages (channel, role, content, metadata) VALUES (?, ?, ?, ?)'
  ).run(channelId, role, content, metadata ? JSON.stringify(metadata) : null);

  const msgId = (d.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

  log('debug', 'Message stored', { channelId, role, msgId, contentLength: content.length });
  return msgId;
}

export function getChannelMessages(channelId: string, limit: number = 50): Message[] {
  const d = getDb();
  return d.prepare(
    `SELECT * FROM messages
     WHERE channel = ?
       AND (metadata IS NULL OR json_extract(metadata, '$.blocked') IS NOT 1)
       AND (metadata IS NULL OR json_extract(metadata, '$.source') NOT IN ('reminder', 'recurrent-reminder', 'task', 'recurrent-task', 'proactive'))
     ORDER BY id DESC LIMIT ?`
  ).all(channelId, limit).reverse() as Message[];
}

export function getAllRecentMessages(limit: number = 50): Message[] {
  const d = getDb();
  const messages = d.prepare(
    `SELECT * FROM messages
     WHERE (metadata IS NULL OR json_extract(metadata, '$.blocked') IS NOT 1)
     ORDER BY id DESC LIMIT ?`
  ).all(limit).reverse() as Message[];
  log('debug', 'Retrieved recent messages (all channels)', { requested: limit, returned: messages.length });
  return messages;
}

export function clearMessages(): void {
  const d = getDb();
  d.prepare('DELETE FROM messages').run();
  log('info', 'Cleared all messages');
}

// ─── Usage helpers ───

export interface UsageParams {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  type: 'orchestrator' | 'agent' | 'guard' | 'memory' | 'proactive';
  agentId?: string;
  channelId?: string;
}

export function recordUsage(params: UsageParams): void {
  const d = getDb();
  d.prepare(
    'INSERT INTO usage_logs (model, provider, input_tokens, output_tokens, type, agent_id, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(params.model, params.provider, params.inputTokens, params.outputTokens, params.type, params.agentId ?? null, params.channelId ?? null);
}

export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; calls: number }>;
  byDay: Array<{ date: string; inputTokens: number; outputTokens: number; calls: number }>;
  byType: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  messageCount: number;
}

export function getUsageStats(from?: string, to?: string): UsageStats {
  const d = getDb();
  let where = '';
  const params: string[] = [];
  if (from) { where += ' AND timestamp >= ?'; params.push(from); }
  if (to) {
    const toValue = to.length === 10 ? `${to} 23:59:59` : to;
    where += ' AND timestamp <= ?';
    params.push(toValue);
  }

  const totals = d.prepare(
    `SELECT COALESCE(SUM(input_tokens),0) as ti, COALESCE(SUM(output_tokens),0) as to_, COUNT(*) as cnt FROM usage_logs WHERE 1=1${where}`
  ).get(...params) as { ti: number; to_: number; cnt: number };

  const byModel = d.prepare(
    `SELECT model, provider, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, COUNT(*) as calls FROM usage_logs WHERE 1=1${where} GROUP BY model, provider ORDER BY calls DESC`
  ).all(...params) as UsageStats['byModel'];

  const byDay = d.prepare(
    `SELECT DATE(timestamp) as date, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, COUNT(*) as calls FROM usage_logs WHERE 1=1${where} GROUP BY DATE(timestamp) ORDER BY date DESC`
  ).all(...params) as UsageStats['byDay'];

  const byTypeRows = d.prepare(
    `SELECT type, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, COUNT(*) as calls FROM usage_logs WHERE 1=1${where} GROUP BY type`
  ).all(...params) as Array<{ type: string; inputTokens: number; outputTokens: number; calls: number }>;

  const byType: UsageStats['byType'] = {};
  for (const row of byTypeRows) {
    byType[row.type] = { inputTokens: row.inputTokens, outputTokens: row.outputTokens, calls: row.calls };
  }

  const msgRow = d.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number };

  return {
    totalInputTokens: totals.ti,
    totalOutputTokens: totals.to_,
    byModel,
    byDay,
    byType,
    messageCount: msgRow.cnt,
  };
}

// ─── Cost helpers ───

export type ModelPricing = Record<string, { inputPricePerMillion: number; outputPricePerMillion: number }>;

export interface CostStats {
  totalCost: number;
  byModel: Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; inputCost: number; outputCost: number; totalCost: number; calls: number }>;
  byDay: Array<{ date: string; cost: number; inputTokens: number; outputTokens: number }>;
  currentMonthCost: number;
  currentDayCost: number;
}

export function getCostStats(pricing: ModelPricing, from?: string, to?: string): CostStats {
  const d = getDb();
  let where = '';
  const params: string[] = [];
  if (from) { where += ' AND timestamp >= ?'; params.push(from); }
  if (to) {
    const toValue = to.length === 10 ? `${to} 23:59:59` : to;
    where += ' AND timestamp <= ?';
    params.push(toValue);
  }

  const byModelRows = d.prepare(
    `SELECT model, provider, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, COUNT(*) as calls
     FROM usage_logs WHERE 1=1${where} GROUP BY model, provider ORDER BY calls DESC`
  ).all(...params) as Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; calls: number }>;

  const byModel = byModelRows.map((row) => {
    const p = pricing[row.model] ?? { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    const inputCost = (row.inputTokens / 1_000_000) * p.inputPricePerMillion;
    const outputCost = (row.outputTokens / 1_000_000) * p.outputPricePerMillion;
    return { ...row, inputCost, outputCost, totalCost: inputCost + outputCost };
  });

  const byDayRows = d.prepare(
    `SELECT DATE(timestamp) as date, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens
     FROM usage_logs WHERE 1=1${where} GROUP BY DATE(timestamp) ORDER BY date DESC`
  ).all(...params) as Array<{ date: string; inputTokens: number; outputTokens: number }>;

  // For per-day cost we need to sum model-level costs per day — simpler: compute from per-model-per-day
  const perModelDay = d.prepare(
    `SELECT DATE(timestamp) as date, model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens
     FROM usage_logs WHERE 1=1${where} GROUP BY DATE(timestamp), model`
  ).all(...params) as Array<{ date: string; model: string; inputTokens: number; outputTokens: number }>;

  const dayCostMap = new Map<string, number>();
  for (const row of perModelDay) {
    const p = pricing[row.model] ?? { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    const cost = (row.inputTokens / 1_000_000) * p.inputPricePerMillion + (row.outputTokens / 1_000_000) * p.outputPricePerMillion;
    dayCostMap.set(row.date, (dayCostMap.get(row.date) ?? 0) + cost);
  }

  const byDay = byDayRows.map((row) => ({
    ...row,
    cost: dayCostMap.get(row.date) ?? 0,
  }));

  const totalCost = byModel.reduce((s, r) => s + r.totalCost, 0);

  // Current month / day costs
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const monthRows = d.prepare(
    `SELECT model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens
     FROM usage_logs WHERE timestamp >= ? GROUP BY model`
  ).all(monthStart) as Array<{ model: string; inputTokens: number; outputTokens: number }>;
  let currentMonthCost = 0;
  for (const row of monthRows) {
    const p = pricing[row.model] ?? { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    currentMonthCost += (row.inputTokens / 1_000_000) * p.inputPricePerMillion + (row.outputTokens / 1_000_000) * p.outputPricePerMillion;
  }

  const dayRows = d.prepare(
    `SELECT model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens
     FROM usage_logs WHERE DATE(timestamp) = ? GROUP BY model`
  ).all(today) as Array<{ model: string; inputTokens: number; outputTokens: number }>;
  let currentDayCost = 0;
  for (const row of dayRows) {
    const p = pricing[row.model] ?? { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    currentDayCost += (row.inputTokens / 1_000_000) * p.inputPricePerMillion + (row.outputTokens / 1_000_000) * p.outputPricePerMillion;
  }

  return { totalCost, byModel, byDay, currentMonthCost, currentDayCost };
}
