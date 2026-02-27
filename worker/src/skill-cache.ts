import { createSkillFromZip, getSkill, loadSkills } from '@scalyclaw/shared/skills/skill-loader.js';
import type { SkillDefinition } from '@scalyclaw/shared/skills/skill-loader.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { clearInstallInFlight } from './skill-setup.js';
import type { Redis } from 'ioredis';

// ─── In-memory skill cache ───

const skillCache = new Map<string, SkillDefinition>();

// In-flight dedup: prevent concurrent fetches for the same skill
const inFlight = new Map<string, Promise<SkillDefinition | null>>();

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Get a skill by ID — checks in-memory cache, then local disk, then fetches
 * the zip from the node API and extracts it locally.
 * Concurrent calls for the same skill share a single fetch (dedup).
 */
export async function getOrFetchSkill(
  skillId: string,
  nodeUrl: string,
  nodeToken: string,
): Promise<SkillDefinition | null> {
  // 1. Check in-memory cache
  if (skillCache.has(skillId)) return skillCache.get(skillId)!;

  // 2. Deduplicate concurrent fetches
  const existing = inFlight.get(skillId);
  if (existing) return existing;

  const promise = fetchSkillInternal(skillId, nodeUrl, nodeToken);
  inFlight.set(skillId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(skillId);
  }
}

async function fetchSkillInternal(
  skillId: string,
  nodeUrl: string,
  nodeToken: string,
): Promise<SkillDefinition | null> {
  // Always try fetching fresh from node first — the node has the authoritative copy.
  // This ensures edits to SKILL.md on the node (via write_file, dashboard, etc.)
  // propagate to workers immediately.
  if (nodeUrl) {
    const fetched = await fetchSkillFromNode(skillId, nodeUrl, nodeToken);
    if (fetched) return fetched;
  }

  // Fallback: check local disk (may have been extracted from a previous fetch)
  let local = getSkill(skillId);
  if (!local) {
    await loadSkills();
    local = getSkill(skillId);
  }
  if (local) {
    skillCache.set(skillId, local);
    return local;
  }

  return null;
}

async function fetchSkillFromNode(
  skillId: string,
  nodeUrl: string,
  nodeToken: string,
): Promise<SkillDefinition | null> {
  log('info', `Fetching skill "${skillId}" from node API`, { nodeUrl });
  try {
    const res = await fetch(`${nodeUrl}/api/skills/${skillId}/zip`, {
      headers: { Authorization: `Bearer ${nodeToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log('warn', `Failed to fetch skill "${skillId}" from node: ${res.status}`, { nodeUrl });
      return null;
    }

    const zipBuffer = new Uint8Array(await res.arrayBuffer());
    const skill = await createSkillFromZip(skillId, zipBuffer);
    skillCache.set(skillId, skill);
    log('info', `Skill "${skillId}" fetched and cached`, { name: skill.name });
    return skill;
  } catch (err) {
    log('error', `Failed to fetch skill "${skillId}"`, { error: String(err) });
    return null;
  }
}

/** Clear the in-memory skill cache (called on reload notification). */
export function clearSkillCache(): void {
  skillCache.clear();
  inFlight.clear();
  clearInstallInFlight();
  log('info', 'Skill cache cleared');
}

/** Subscribe to scalyclaw:skills:reload to invalidate cache when skills change. */
export function subscribeToSkillInvalidation(subscriber: Redis): void {
  subscriber.subscribe('scalyclaw:skills:reload');
  subscriber.on('message', (channel) => {
    if (channel === 'scalyclaw:skills:reload') {
      clearSkillCache();
    }
  });
}
