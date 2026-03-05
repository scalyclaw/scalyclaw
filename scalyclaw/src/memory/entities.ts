import { randomUUID } from 'node:crypto';
import { getDb } from '../core/db.js';
import { log } from '@scalyclaw/shared/core/logger.js';

// ─── Types ───

export interface Entity {
  id: string;
  name: string;
  entity_type: string;
  first_seen: string;
  last_seen: string;
  mention_count: number;
}

export interface Relation {
  id: string;
  source_id: string;
  relation: string;
  target_id: string;
  memory_id: string | null;
  strength: number;
  created_at: string;
  updated_at: string;
}

export interface ExtractedEntity {
  name: string;
  type: string;
  relations?: { relation: string; target: string }[];
}

export interface EntityGraphNode {
  name: string;
  type: string;
  mentionCount: number;
  relations: { relation: string; target: string; strength: number }[];
}

// ─── Upsert ───

/**
 * Create or update an entity. Returns the entity ID.
 */
export function upsertEntity(name: string, entityType: string): string {
  const db = getDb();
  const normalized = name.trim().toLowerCase();

  const existing = db.prepare(
    'SELECT id, mention_count FROM memory_entities WHERE LOWER(name) = ?',
  ).get(normalized) as { id: string; mention_count: number } | null;

  if (existing) {
    db.prepare(
      "UPDATE memory_entities SET mention_count = mention_count + 1, last_seen = datetime('now') WHERE id = ?",
    ).run(existing.id);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO memory_entities (id, name, entity_type) VALUES (?, ?, ?)',
  ).run(id, name.trim(), entityType);
  return id;
}

/**
 * Link an entity to a memory.
 */
export function linkEntityToMemory(entityId: string, memoryId: string): void {
  const db = getDb();
  try {
    db.prepare(
      'INSERT OR IGNORE INTO memory_entity_mentions (entity_id, memory_id) VALUES (?, ?)',
    ).run(entityId, memoryId);
  } catch (err) {
    log('debug', 'Failed to link entity to memory', { entityId, memoryId, error: String(err) });
  }
}

/**
 * Create or strengthen a relation between two entities.
 */
export function upsertRelation(
  sourceId: string,
  relation: string,
  targetId: string,
  memoryId?: string,
): string {
  const db = getDb();
  const normalizedRelation = relation.trim().toLowerCase();

  const existing = db.prepare(
    'SELECT id, strength FROM memory_relations WHERE source_id = ? AND LOWER(relation) = ? AND target_id = ?',
  ).get(sourceId, normalizedRelation, targetId) as { id: string; strength: number } | null;

  if (existing) {
    db.prepare(
      "UPDATE memory_relations SET strength = strength + 1, updated_at = datetime('now'), memory_id = COALESCE(?, memory_id) WHERE id = ?",
    ).run(memoryId ?? null, existing.id);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO memory_relations (id, source_id, relation, target_id, memory_id) VALUES (?, ?, ?, ?, ?)',
  ).run(id, sourceId, normalizedRelation, targetId, memoryId ?? null);
  return id;
}

// ─── Entity extraction from memory data ───

/**
 * Process extracted entities and link them to a memory.
 */
export function processExtractedEntities(
  entities: ExtractedEntity[],
  memoryId: string,
): void {
  if (!entities.length) return;

  const db = getDb();
  const processAll = db.transaction(() => {
    const entityIds = new Map<string, string>();

    // First pass: upsert all entities
    for (const entity of entities) {
      if (!entity.name || !entity.type) continue;
      const entityId = upsertEntity(entity.name, entity.type);
      entityIds.set(entity.name.trim().toLowerCase(), entityId);
      linkEntityToMemory(entityId, memoryId);
    }

    // Second pass: create relations
    for (const entity of entities) {
      if (!entity.relations?.length) continue;
      const sourceKey = entity.name.trim().toLowerCase();
      const sourceId = entityIds.get(sourceKey);
      if (!sourceId) continue;

      for (const rel of entity.relations) {
        if (!rel.target || !rel.relation) continue;
        const targetKey = rel.target.trim().toLowerCase();
        let targetId = entityIds.get(targetKey);
        if (!targetId) {
          // Target entity not in current batch — upsert as 'concept' type
          targetId = upsertEntity(rel.target, 'concept');
          entityIds.set(targetKey, targetId);
          linkEntityToMemory(targetId, memoryId);
        }
        upsertRelation(sourceId, rel.relation, targetId, memoryId);
      }
    }
  });

  try {
    processAll();
    log('debug', 'Processed extracted entities', { count: entities.length, memoryId });
  } catch (err) {
    log('warn', 'Failed to process extracted entities', { memoryId, error: String(err) });
  }
}

// ─── Graph queries ───

/**
 * Find entities connected to a given entity name.
 */
export function getRelatedEntities(entityName: string): Array<{ name: string; type: string; relation: string; direction: 'outgoing' | 'incoming'; strength: number }> {
  const db = getDb();
  const normalized = entityName.trim().toLowerCase();

  const entity = db.prepare(
    'SELECT id FROM memory_entities WHERE LOWER(name) = ?',
  ).get(normalized) as { id: string } | null;
  if (!entity) return [];

  const outgoing = db.prepare(`
    SELECT e.name, e.entity_type as type, r.relation, r.strength
    FROM memory_relations r
    JOIN memory_entities e ON e.id = r.target_id
    WHERE r.source_id = ?
    ORDER BY r.strength DESC
  `).all(entity.id) as Array<{ name: string; type: string; relation: string; strength: number }>;

  const incoming = db.prepare(`
    SELECT e.name, e.entity_type as type, r.relation, r.strength
    FROM memory_relations r
    JOIN memory_entities e ON e.id = r.source_id
    WHERE r.target_id = ?
    ORDER BY r.strength DESC
  `).all(entity.id) as Array<{ name: string; type: string; relation: string; strength: number }>;

  return [
    ...outgoing.map(r => ({ ...r, direction: 'outgoing' as const })),
    ...incoming.map(r => ({ ...r, direction: 'incoming' as const })),
  ];
}

/**
 * Find all memories mentioning an entity.
 */
export function getEntityMemories(entityName: string): Array<{ memoryId: string; subject: string; content: string; type: string }> {
  const db = getDb();
  const normalized = entityName.trim().toLowerCase();

  return db.prepare(`
    SELECT m.id as memoryId, m.subject, m.content, m.type
    FROM memory_entity_mentions em
    JOIN memory_entities e ON e.id = em.entity_id
    JOIN memories m ON m.id = em.memory_id
    WHERE LOWER(e.name) = ?
    ORDER BY m.updated_at DESC
    LIMIT 20
  `).all(normalized) as Array<{ memoryId: string; subject: string; content: string; type: string }>;
}

/**
 * BFS traversal of entity relationships up to specified depth.
 */
export function getEntityGraph(entityName: string, maxDepth = 2): EntityGraphNode[] {
  const db = getDb();
  const normalized = entityName.trim().toLowerCase();

  const rootEntity = db.prepare(
    'SELECT id, name, entity_type, mention_count FROM memory_entities WHERE LOWER(name) = ?',
  ).get(normalized) as (Entity & { entity_type: string }) | null;
  if (!rootEntity) return [];

  const visited = new Set<string>();
  const result: EntityGraphNode[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootEntity.id, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const entity = db.prepare(
      'SELECT id, name, entity_type, mention_count FROM memory_entities WHERE id = ?',
    ).get(id) as { id: string; name: string; entity_type: string; mention_count: number } | null;
    if (!entity) continue;

    const relations = db.prepare(`
      SELECT r.relation, e.name as target, r.strength
      FROM memory_relations r
      JOIN memory_entities e ON e.id = r.target_id
      WHERE r.source_id = ?
      ORDER BY r.strength DESC
    `).all(id) as Array<{ relation: string; target: string; strength: number }>;

    result.push({
      name: entity.name,
      type: entity.entity_type,
      mentionCount: entity.mention_count,
      relations,
    });

    if (depth < maxDepth) {
      // Enqueue connected entities
      const connected = db.prepare(`
        SELECT DISTINCT target_id as id FROM memory_relations WHERE source_id = ?
        UNION
        SELECT DISTINCT source_id as id FROM memory_relations WHERE target_id = ?
      `).all(id, id) as Array<{ id: string }>;

      for (const c of connected) {
        if (!visited.has(c.id)) {
          queue.push({ id: c.id, depth: depth + 1 });
        }
      }
    }
  }

  return result;
}

/**
 * Clean up entity mentions and relations for a deleted memory.
 */
export function cleanupEntityReferences(memoryId: string): void {
  const db = getDb();
  try {
    db.prepare('DELETE FROM memory_entity_mentions WHERE memory_id = ?').run(memoryId);
    db.prepare('UPDATE memory_relations SET memory_id = NULL WHERE memory_id = ?').run(memoryId);
  } catch (err) {
    log('debug', 'Entity reference cleanup error', { memoryId, error: String(err) });
  }
}

/**
 * Re-link entity mentions from old memory IDs to a new consolidated memory.
 */
export function relinkEntitiesToConsolidated(oldMemoryIds: string[], newMemoryId: string): void {
  const db = getDb();
  if (oldMemoryIds.length === 0) return;

  try {
    const relink = db.transaction(() => {
      for (const oldId of oldMemoryIds) {
        // Get entity mentions from old memory
        const mentions = db.prepare(
          'SELECT entity_id FROM memory_entity_mentions WHERE memory_id = ?',
        ).all(oldId) as Array<{ entity_id: string }>;

        for (const { entity_id } of mentions) {
          // Link to new memory (ignore if already linked)
          db.prepare(
            'INSERT OR IGNORE INTO memory_entity_mentions (entity_id, memory_id) VALUES (?, ?)',
          ).run(entity_id, newMemoryId);
        }

        // Update relations that reference old memory
        db.prepare(
          'UPDATE memory_relations SET memory_id = ? WHERE memory_id = ?',
        ).run(newMemoryId, oldId);
      }
    });
    relink();
  } catch (err) {
    log('warn', 'Failed to relink entities to consolidated memory', { error: String(err) });
  }
}

/**
 * Prune stale entities: remove those with mention_count = 1 and last_seen > 90 days ago.
 * Also deletes orphaned relations and mentions.
 */
export function pruneStaleEntities(): number {
  const db = getDb();

  const stale = db.prepare(
    "SELECT id FROM memory_entities WHERE mention_count <= 1 AND last_seen < datetime('now', '-90 days')",
  ).all() as { id: string }[];

  if (stale.length === 0) return 0;

  const ids = stale.map(e => e.id);
  const placeholders = ids.map(() => '?').join(',');

  const pruneAll = db.transaction(() => {
    db.prepare(`DELETE FROM memory_entity_mentions WHERE entity_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM memory_relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM memory_entities WHERE id IN (${placeholders})`).run(...ids);
  });
  pruneAll();

  log('info', 'Pruned stale entities', { count: ids.length });
  return ids.length;
}

/**
 * Get top entities for context injection (most mentioned, most recently seen).
 */
export function getTopEntities(limit = 10): Array<{ name: string; type: string; mentionCount: number; relations: Array<{ relation: string; target: string }> }> {
  const db = getDb();

  const entities = db.prepare(`
    SELECT id, name, entity_type, mention_count
    FROM memory_entities
    ORDER BY mention_count DESC, last_seen DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; name: string; entity_type: string; mention_count: number }>;

  return entities.map(e => {
    const relations = db.prepare(`
      SELECT r.relation, t.name as target
      FROM memory_relations r
      JOIN memory_entities t ON t.id = r.target_id
      WHERE r.source_id = ?
      ORDER BY r.strength DESC
      LIMIT 5
    `).all(e.id) as Array<{ relation: string; target: string }>;

    return {
      name: e.name,
      type: e.entity_type,
      mentionCount: e.mention_count,
      relations,
    };
  });
}
