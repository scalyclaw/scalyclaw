import { randomUUID } from 'node:crypto';
import { getDb, isVecAvailable } from '../core/db.js';
import { getConfigRef } from '../core/config.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { withRetry } from '@scalyclaw/shared/core/retry.js';
import { EMBEDDING_RETRY_ATTEMPTS } from '../const/constants.js';
import { generateEmbedding, vectorToBlob, isEmbeddingsAvailable } from './embeddings.js';
import { computeCompositeScore, trackAccessBatch } from './scoring.js';
import { cleanupEntityReferences } from './entities.js';

const TTL_FILTER = "(ttl IS NULL OR ttl > datetime('now'))";

// ─── Interfaces ───

export interface MemoryEntry {
  id: string;
  type: string;
  subject: string;
  content: string;
  tags: string | null;
  source: string | null;
  importance: number;
  access_count: number;
  last_accessed_at: string | null;
  consolidated_into: string | null;
  ttl: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemorySearchResult {
  id: string;
  subject: string;
  content: string;
  type: string;
  tags: string[];
  source: string | null;
  importance: number;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface StoreMemoryInput {
  type: string;
  subject: string;
  content: string;
  tags?: string[];
  source?: string;
  importance?: number;
  ttl?: string;
}

export interface UpdateMemoryInput {
  subject?: string;
  content?: string;
  tags?: string[];
  importance?: number;
}

// ─── Tag helpers ───

export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

export function serializeTags(tags: string[]): string | null {
  if (!tags.length) return null;
  return tags.join(',');
}

// ─── Store ───

export async function storeMemory(input: StoreMemoryInput): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const { type, subject, content, tags = [], source = null, importance = 5, ttl } = input;

  log('debug', 'Storing memory', { type, subject, contentLength: content.length, tags, ttl });

  const embeddingText = subject + '\n' + content;
  let embeddingBlob: Buffer | null = null;
  if (isEmbeddingsAvailable()) {
    try {
      const embedding = await withRetry(() => generateEmbedding(embeddingText), {
        attempts: EMBEDDING_RETRY_ATTEMPTS,
        baseDelay: 500,
        label: 'Embedding (store)',
      });
      embeddingBlob = vectorToBlob(embedding);
    } catch (err) {
      log('warn', 'Embedding generation failed — storing without vector', { id, error: String(err) });
    }
  }

  const tagsStr = serializeTags(tags);

  const insertAll = db.transaction(() => {
    db.prepare(
      'INSERT INTO memories (id, type, subject, content, tags, source, importance, embedding, ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, type, subject, content, tagsStr, source, importance, embeddingBlob, ttl ?? null);

    for (const tag of tags) {
      db.prepare('INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)').run(id, tag);
    }

    if (embeddingBlob && isVecAvailable()) {
      db.prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)').run(id, embeddingBlob);
    }

    db.prepare('INSERT INTO memory_fts (id, subject, content, tags, type) VALUES (?, ?, ?, ?, ?)').run(id, subject, content, tagsStr ?? '', type);
  });
  insertAll();

  log('debug', 'Memory stored', { id, type, subject, hasEmbedding: !!embeddingBlob });
  return id;
}

// ─── Update ───

export async function updateMemory(id: string, updates: UpdateMemoryInput): Promise<boolean> {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryEntry | null;
  if (!existing) return false;

  const subject = updates.subject ?? existing.subject;
  const content = updates.content ?? existing.content;
  const importance = updates.importance ?? existing.importance;
  const tags = updates.tags ?? parseTags(existing.tags);
  const tagsStr = serializeTags(tags);

  const needsReembed = updates.subject !== undefined || updates.content !== undefined;
  let embeddingBlob: Buffer | null = null;
  if (needsReembed && isEmbeddingsAvailable()) {
    try {
      const embedding = await withRetry(() => generateEmbedding(subject + '\n' + content), {
        attempts: EMBEDDING_RETRY_ATTEMPTS,
        baseDelay: 500,
        label: 'Embedding (update)',
      });
      embeddingBlob = vectorToBlob(embedding);
    } catch (err) {
      log('warn', 'Embedding regeneration failed during update', { id, error: String(err) });
    }
  }

  const updateAll = db.transaction(() => {
    if (needsReembed && embeddingBlob) {
      db.prepare(
        "UPDATE memories SET subject = ?, content = ?, tags = ?, importance = ?, embedding = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(subject, content, tagsStr, importance, embeddingBlob, id);

      if (isVecAvailable()) {
        db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id);
        db.prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)').run(id, embeddingBlob);
      }
    } else {
      db.prepare(
        "UPDATE memories SET subject = ?, content = ?, tags = ?, importance = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(subject, content, tagsStr, importance, id);
    }

    // Replace tags
    db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
    for (const tag of tags) {
      db.prepare('INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)').run(id, tag);
    }

    // Replace FTS entry
    try {
      db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
    } catch { /* FTS row may not exist */ }
    db.prepare('INSERT INTO memory_fts (id, subject, content, tags, type) VALUES (?, ?, ?, ?, ?)').run(id, subject, content, tagsStr ?? '', existing.type);
  });
  updateAll();

  log('debug', 'Memory updated', { id, subject, reembedded: needsReembed && !!embeddingBlob });
  return true;
}

// ─── Search (vector → FTS fallback) ───

export interface SearchOptions {
  topK?: number;
  type?: string;
  tags?: string[];
  weights?: { semantic?: number; recency?: number; importance?: number };
}

export async function searchMemory(
  query: string,
  options?: SearchOptions,
): Promise<MemorySearchResult[]> {
  const config = getConfigRef();
  const topK = options?.topK ?? config.memory.topK;
  const typeFilter = options?.type;
  const tagsFilter = options?.tags;

  log('debug', 'Searching memory', { query, topK, typeFilter, tagsFilter });

  let results: MemorySearchResult[];

  if (isEmbeddingsAvailable() && isVecAvailable()) {
    try {
      results = await vectorSearch(query, topK, typeFilter, tagsFilter, config.memory.scoreThreshold, options?.weights);
      if (results.length > 0) {
        // Track access for returned results (async, non-blocking)
        trackAccessBatch(results.map(r => r.id));
        return results;
      }
    } catch (err) {
      log('warn', 'Vector search failed, falling back to text search', { error: String(err) });
    }
  }

  results = textSearch(query, topK, typeFilter, tagsFilter, options?.weights);
  if (results.length > 0) {
    trackAccessBatch(results.map(r => r.id));
  }
  return results;
}

async function vectorSearch(
  query: string,
  topK: number,
  typeFilter: string | undefined,
  tagsFilter: string[] | undefined,
  threshold: number,
  weightOverrides?: { semantic?: number; recency?: number; importance?: number },
): Promise<MemorySearchResult[]> {
  const db = getDb();
  const queryBlob = vectorToBlob(await generateEmbedding(query));

  const vecRows = db.prepare(
    'SELECT id, distance FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?',
  ).all(queryBlob, topK * 3) as { id: string; distance: number }[];

  if (vecRows.length === 0) return [];

  let ids = vecRows.map(r => r.id);

  // Tag filtering: narrow IDs to those matching ALL requested tags
  if (tagsFilter?.length) {
    ids = filterIdsByTags(db, ids, tagsFilter);
    if (ids.length === 0) return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  let sql = `SELECT id, subject, content, type, tags, source, importance, updated_at, created_at FROM memories WHERE id IN (${placeholders}) AND ${TTL_FILTER} AND consolidated_into IS NULL`;
  const params: (string | number | null)[] = [...ids];

  if (typeFilter) {
    sql += ' AND type = ?';
    params.push(typeFilter);
  }

  const memRows = db.prepare(sql).all(...params) as {
    id: string; subject: string; content: string; type: string; tags: string | null; source: string | null; importance: number; updated_at: string; created_at: string;
  }[];

  const memMap = new Map(memRows.map(m => [m.id, m]));
  const distMap = new Map(vecRows.map(v => [v.id, v.distance]));

  // Build scoring config from overrides
  const config = getConfigRef();
  const memConfig = config.memory as Record<string, unknown>;
  const defaultWeights = (memConfig.weights as { semantic: number; recency: number; importance: number } | undefined) ?? { semantic: 0.6, recency: 0.2, importance: 0.2 };
  const scoringConfig = {
    weights: {
      semantic: weightOverrides?.semantic ?? defaultWeights.semantic,
      recency: weightOverrides?.recency ?? defaultWeights.recency,
      importance: weightOverrides?.importance ?? defaultWeights.importance,
    },
    decayRate: (memConfig.decayRate as number | undefined) ?? 0.05,
  };

  const scored: MemorySearchResult[] = [];
  for (const id of ids) {
    const mem = memMap.get(id);
    if (!mem) continue;

    const distance = distMap.get(id);
    if (distance === undefined) continue;
    const embeddingScore = 1 - distance;
    if (embeddingScore < threshold) continue;

    const compositeScore = computeCompositeScore(embeddingScore, mem.updated_at, mem.importance, scoringConfig);

    scored.push({
      id: mem.id,
      subject: mem.subject,
      content: mem.content,
      type: mem.type,
      tags: parseTags(mem.tags),
      source: mem.source,
      importance: mem.importance,
      score: compositeScore,
      created_at: mem.created_at,
      updated_at: mem.updated_at,
    });
  }

  // Re-sort by composite score
  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, topK);
  log('debug', 'Vector search results', { resultCount: results.length, topScore: results[0]?.score });
  return results;
}

function textSearch(
  query: string,
  topK: number,
  typeFilter: string | undefined,
  tagsFilter: string[] | undefined,
  weightOverrides?: { semantic?: number; recency?: number; importance?: number },
): MemorySearchResult[] {
  const db = getDb();

  const ftsQuery = query
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => `"${w.replace(/"/g, '')}"`)
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    let sql = `
      SELECT f.id, f.rank, m.subject, m.content, m.type, m.tags, m.source, m.importance, m.updated_at, m.created_at
      FROM memory_fts f
      JOIN memories m ON m.id = f.id
      WHERE memory_fts MATCH ? AND ${TTL_FILTER} AND m.consolidated_into IS NULL`;
    const params: (string | number | null)[] = [ftsQuery];

    if (typeFilter) {
      sql += ' AND m.type = ?';
      params.push(typeFilter);
    }

    if (tagsFilter?.length) {
      const tagPlaceholders = tagsFilter.map(() => '?').join(',');
      sql += ` AND m.id IN (
        SELECT memory_id FROM memory_tags WHERE tag IN (${tagPlaceholders})
        GROUP BY memory_id HAVING COUNT(DISTINCT tag) = ?
      )`;
      params.push(...tagsFilter, tagsFilter.length);
    }

    sql += ' ORDER BY f.rank LIMIT ?';
    params.push(topK * 2);

    const rows = db.prepare(sql).all(...params) as {
      id: string; rank: number; subject: string; content: string; type: string; tags: string | null; source: string | null; importance: number; updated_at: string; created_at: string;
    }[];

    log('debug', 'FTS search results', { resultCount: rows.length, query: ftsQuery });

    if (rows.length === 0) return [];

    const absRanks = rows.map(r => Math.abs(r.rank));
    const minRank = Math.min(...absRanks);
    const maxRank = Math.max(...absRanks);
    const range = maxRank - minRank;

    // Build scoring config
    const config = getConfigRef();
    const memConfig = config.memory as Record<string, unknown>;
    const defaultWeights = (memConfig.weights as { semantic: number; recency: number; importance: number } | undefined) ?? { semantic: 0.6, recency: 0.2, importance: 0.2 };
    const scoringConfig = {
      weights: {
        semantic: weightOverrides?.semantic ?? defaultWeights.semantic,
        recency: weightOverrides?.recency ?? defaultWeights.recency,
        importance: weightOverrides?.importance ?? defaultWeights.importance,
      },
      decayRate: (memConfig.decayRate as number | undefined) ?? 0.05,
    };

    const scored = rows.map(r => {
      const ftsScore = range > 0
        ? 1.0 - ((Math.abs(r.rank) - minRank) / range) * 0.5
        : 0.75;

      const compositeScore = computeCompositeScore(ftsScore, r.updated_at, r.importance, scoringConfig);

      return {
        id: r.id,
        subject: r.subject,
        content: r.content,
        type: r.type,
        tags: parseTags(r.tags),
        source: r.source,
        importance: r.importance,
        score: compositeScore,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    // Re-sort by composite score
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (err) {
    log('warn', 'FTS search failed', { error: String(err), query: ftsQuery });
    return [];
  }
}

// ─── Recall (exact lookup / filtered list) ───

export function recallMemory(
  id?: string,
  filter?: { type?: string; tags?: string[]; includeConsolidated?: boolean },
): MemoryEntry[] {
  const db = getDb();
  const includeConsolidated = filter?.includeConsolidated ?? false;

  if (id) {
    const result = db.prepare(
      `SELECT id, type, subject, content, tags, source, importance, access_count, last_accessed_at, consolidated_into, ttl, created_at, updated_at FROM memories WHERE id = ? AND ${TTL_FILTER}`,
    ).get(id) as MemoryEntry | null;
    return result ? [result] : [];
  }

  const conditions: string[] = [TTL_FILTER];
  const params: (string | number | null)[] = [];

  if (!includeConsolidated) {
    conditions.push('consolidated_into IS NULL');
  }

  if (filter?.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }

  if (filter?.tags?.length) {
    const tagPlaceholders = filter.tags.map(() => '?').join(',');
    conditions.push(`id IN (
      SELECT memory_id FROM memory_tags WHERE tag IN (${tagPlaceholders})
      GROUP BY memory_id HAVING COUNT(DISTINCT tag) = ?
    )`);
    params.push(...filter.tags, filter.tags.length);
  }

  return db.prepare(
    `SELECT id, type, subject, content, tags, source, importance, access_count, last_accessed_at, consolidated_into, ttl, created_at, updated_at FROM memories
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC LIMIT 20`,
  ).all(...params) as MemoryEntry[];
}

// ─── Delete ───

export function deleteMemory(id: string): boolean {
  const db = getDb();
  let deleted = false;

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    const { count } = db.prepare('SELECT changes() as count').get() as { count: number };
    if (count > 0) {
      // memory_tags + entity mentions cleaned up via CASCADE
      if (isVecAvailable()) {
        db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id);
      }
      try {
        db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
      } catch {
        // FTS delete can fail if row doesn't exist — safe to ignore
      }
      deleted = true;
    }
  });
  deleteAll();

  // Clean up entity references outside transaction (non-critical)
  if (deleted) {
    cleanupEntityReferences(id);
  }

  return deleted;
}

// ─── TTL Cleanup ───

export function cleanupExpired(): number {
  const db = getDb();

  const expired = db.prepare(
    "SELECT id FROM memories WHERE ttl IS NOT NULL AND ttl <= datetime('now')",
  ).all() as { id: string }[];

  if (expired.length === 0) return 0;

  const ids = expired.map(e => e.id);
  const placeholders = ids.map(() => '?').join(',');

  const deleteAll = db.transaction(() => {
    // memory_tags + entity mentions cleaned up via CASCADE
    db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
    if (isVecAvailable()) {
      db.prepare(`DELETE FROM memory_vec WHERE id IN (${placeholders})`).run(...ids);
    }
    for (const id of ids) {
      try {
        db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
      } catch {
        // FTS cleanup is best-effort per entry
      }
    }
  });
  deleteAll();

  // Entity cleanup
  for (const id of ids) {
    cleanupEntityReferences(id);
  }

  log('info', 'Cleaned up expired memories', { count: ids.length });
  return ids.length;
}

// ─── Helpers ───

function filterIdsByTags(db: ReturnType<typeof getDb>, ids: string[], tags: string[]): string[] {
  const idPlaceholders = ids.map(() => '?').join(',');
  const tagPlaceholders = tags.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT memory_id FROM memory_tags
    WHERE memory_id IN (${idPlaceholders}) AND tag IN (${tagPlaceholders})
    GROUP BY memory_id HAVING COUNT(DISTINCT tag) = ?
  `).all(...ids, ...tags, tags.length) as { memory_id: string }[];

  const matchSet = new Set(rows.map(r => r.memory_id));
  return ids.filter(id => matchSet.has(id));
}
