import { log } from '../core/logger.js';
import { recordUsage } from '../core/db.js';
import { getConfigRef } from '../core/config.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { storeMemory, searchMemory } from './memory.js';
import { EXTRACTION_PROMPT } from '../prompt/extractor.js';

export async function extractMemories(userMessages: string[], channelId?: string): Promise<void> {
  // Skip trivial messages
  const meaningful = userMessages.filter(m => m.length >= 20 && !m.startsWith('/'));
  if (meaningful.length === 0) return;

  const config = getConfigRef();

  // Select model — same logic as guards
  const modelId = selectModel(
    config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })),
  );
  if (!modelId) {
    log('warn', 'Memory extraction skipped — no model available');
    return;
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);

  const userContent = meaningful.join('\n---\n');

  log('debug', 'Running memory extraction', { messageCount: meaningful.length, modelId });

  try {
    const response = await provider.chat({
      model,
      systemPrompt: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0,
      maxTokens: 1024,
    });

    recordUsage({
      model: modelId,
      provider: providerId,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      type: 'memory',
      channelId,
    });

    // Parse JSON array from response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log('debug', 'Memory extraction returned no JSON array — nothing to store');
      return;
    }

    const facts = JSON.parse(jsonMatch[0]) as Array<{
      type: string;
      subject: string;
      content: string;
      tags?: string[];
      source?: string;
      confidence?: number;
    }>;

    if (!Array.isArray(facts) || facts.length === 0) {
      log('debug', 'Memory extraction found no facts to store');
      return;
    }

    log('info', 'Memory extraction found facts', { count: facts.length });

    // Store each fact — with dedup check to avoid re-creating deleted memories
    let stored = 0;
    for (const fact of facts) {
      if (!fact.type || !fact.subject || !fact.content) continue;
      try {
        // Dedup: search for very similar existing memories before storing (same logic as handleMemoryStore)
        try {
          const existing = await searchMemory(fact.subject + ' ' + fact.content, { topK: 3, type: fact.type });
          if (existing.find(r => r.score >= 0.92)) continue; // skip duplicate
        } catch { /* proceed if search fails */ }

        await storeMemory({
          type: fact.type,
          subject: fact.subject,
          content: fact.content,
          tags: fact.tags ?? [],
          source: fact.source ?? 'auto-extraction',
          confidence: fact.confidence ?? 2,
        });
        stored++;
      } catch (err) {
        log('warn', 'Failed to store extracted memory', { subject: fact.subject, error: String(err) });
      }
    }

    log('info', 'Memory extraction complete', { stored, total: facts.length, channelId });
  } catch (err) {
    log('warn', 'Memory extraction LLM call failed', { error: String(err) });
  }
}
