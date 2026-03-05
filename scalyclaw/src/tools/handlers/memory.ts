import { log } from '@scalyclaw/shared/core/logger.js';
import { storeMemory, searchMemory, recallMemory, deleteMemory, updateMemory } from '../../memory/memory.js';
import { processExtractedEntities, getEntityGraph, type ExtractedEntity } from '../../memory/entities.js';
import { runConsolidation } from '../../memory/consolidation.js';
import { getConfigRef } from '../../core/config.js';
import type { ToolContext } from '../tool-registry.js';

export async function handleMemoryStore(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const type = input.type as string;
  const subject = input.subject as string;
  const content = input.content as string;
  const tags = (input.tags as string[] | undefined) ?? [];
  const importance = (input.importance as number | undefined) ?? 5;
  const ttl = input.ttl as string | undefined;

  const rawSource = input.source as string | undefined;
  const source = rawSource === 'user-stated' || rawSource === 'inferred' || rawSource === 'observed' ? rawSource : ctx.channelId;

  log('debug', 'memory_store', { type, subject, contentLength: content?.length, tags, ttl });

  // Dedup: search for very similar existing memories before storing
  try {
    const existing = await searchMemory(subject + ' ' + content, { topK: 3, type });
    const duplicate = existing.find((r) => r.score >= 0.92);
    if (duplicate) {
      log('debug', 'memory_store skipped — duplicate found', { existingId: duplicate.id, score: duplicate.score });
      return JSON.stringify({ stored: false, duplicate: true, existingId: duplicate.id, existingSubject: duplicate.subject });
    }
  } catch {
    // If search fails, proceed with store anyway
  }

  const id = await storeMemory({ type, subject, content, tags, source, importance, ttl });

  const entities = input.entities as ExtractedEntity[] | undefined;
  if (entities?.length) {
    try {
      processExtractedEntities(entities, id);
    } catch (err) {
      log('debug', 'Entity processing failed during memory_store', { id, error: String(err) });
    }
  }

  log('debug', 'memory_store result', { id });
  return JSON.stringify({ stored: true, id });
}

export async function handleMemorySearch(input: Record<string, unknown>): Promise<string> {
  log('debug', 'memory_search', { query: input.query, type: input.type, tags: input.tags, topK: input.topK });
  const weights = input.weights as { semantic?: number; recency?: number; importance?: number } | undefined;
  const results = await searchMemory(input.query as string, {
    type: input.type as string | undefined,
    tags: input.tags as string[] | undefined,
    topK: input.topK as number | undefined,
    weights,
  });
  log('debug', 'memory_search result', { resultCount: results.length });
  return JSON.stringify({ results });
}

export async function handleMemoryRecall(input: Record<string, unknown>): Promise<string> {
  log('debug', 'memory_recall', { id: input.id, type: input.type, tags: input.tags });
  const results = recallMemory(
    input.id as string | undefined,
    {
      type: input.type as string | undefined,
      tags: input.tags as string[] | undefined,
      includeConsolidated: input.includeConsolidated as boolean | undefined,
    }
  );
  log('debug', 'memory_recall result', { resultCount: results.length });
  return JSON.stringify({ results });
}

export async function handleMemoryUpdate(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  log('debug', 'memory_update', { id });

  const updates: Record<string, unknown> = {};
  if (input.subject !== undefined) updates.subject = input.subject as string;
  if (input.content !== undefined) updates.content = input.content as string;
  if (input.tags !== undefined) updates.tags = input.tags as string[];
  if (input.importance !== undefined) updates.importance = input.importance as number;

  const updated = await updateMemory(id, updates);
  log('debug', 'memory_update result', { id, updated });
  if (!updated) return JSON.stringify({ error: 'Memory not found', id });
  return JSON.stringify({ updated: true, id });
}

export function handleMemoryDelete(input: Record<string, unknown>): string {
  const id = input.id as string;
  const deleted = deleteMemory(id);
  return JSON.stringify({ deleted, id });
}

export async function handleMemoryReflect(input: Record<string, unknown>): Promise<string> {
  const force = input.force as boolean | undefined;
  const config = getConfigRef();
  const memConfig = config.memory as Record<string, unknown>;
  const consolConfig = (memConfig.consolidation as Record<string, unknown> | undefined) ?? {};
  const enabled = (consolConfig.enabled as boolean | undefined) ?? true;

  if (!enabled && !force) {
    return JSON.stringify({ error: 'Consolidation is disabled in config. Use force: true to override.' });
  }

  log('info', 'Memory consolidation triggered via memory_reflect');
  const result = await runConsolidation();
  return JSON.stringify({
    consolidated: result.consolidated,
    clusters: result.clusters,
    newMemoryIds: result.newMemoryIds,
    message: result.consolidated > 0
      ? `Consolidated ${result.consolidated} memories into ${result.newMemoryIds.length} summaries.`
      : 'No similar memories found to consolidate.',
  });
}

export function handleMemoryGraph(input: Record<string, unknown>): string {
  const entity = input.entity as string;
  const depth = (input.depth as number | undefined) ?? 2;

  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' });

  const graph = getEntityGraph(entity, depth);
  if (graph.length === 0) {
    return JSON.stringify({ entity, found: false, message: `No entity found matching "${entity}"` });
  }

  return JSON.stringify({ entity, found: true, graph });
}
