import { getConfigRef } from '../core/config.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { log } from '../core/logger.js';

export type EmbeddingVector = number[];

export interface EmbeddingProvider {
  embed(text: string): Promise<EmbeddingVector>;
}

let provider: EmbeddingProvider | null = null;
let embeddingDimensions = 0;

export function isEmbeddingsAvailable(): boolean {
  return provider !== null;
}

export function getEmbeddingDimensions(): number {
  return embeddingDimensions;
}

export async function initEmbeddings(): Promise<void> {
  const config = getConfigRef();
  const enabledModels = config.models.embeddingModels.filter(m => m.enabled);

  if (enabledModels.length === 0) {
    log('info', 'No embedding models enabled — memory search disabled');
    provider = null;
    embeddingDimensions = 0;
    return;
  }

  const memoryEmbeddingModel = config.memory.embeddingModel;
  const candidates = enabledModels.map(m => ({ model: m.id, weight: m.weight, priority: m.priority }));
  const modelId = memoryEmbeddingModel && memoryEmbeddingModel !== 'auto' && enabledModels.some(m => m.id === memoryEmbeddingModel)
    ? memoryEmbeddingModel
    : selectModel(candidates);
  if (!modelId) {
    log('info', 'No embedding model selected — memory search disabled');
    provider = null;
    embeddingDimensions = 0;
    return;
  }

  const selectedEntry = enabledModels.find(m => m.id === modelId)!;
  embeddingDimensions = selectedEntry.dimensions;

  const { provider: providerName, model } = parseModelId(modelId);
  const providerConfig = config.models.providers[providerName];
  if (!providerConfig) {
    throw new Error(`Embedding provider "${providerName}" not found in config`);
  }

  switch (providerName) {
    case 'openai':
    case 'openrouter': {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseUrl,
      });
      provider = {
        async embed(text: string): Promise<EmbeddingVector> {
          const result = await client.embeddings.create({
            model,
            input: text,
          });
          return result.data[0].embedding;
        },
      };
      break;
    }
    case 'ollama': {
      const baseUrl = providerConfig.baseUrl || 'http://localhost:11434';
      provider = {
        async embed(text: string): Promise<EmbeddingVector> {
          const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text }),
          });
          const data = await response.json() as { embedding: number[] };
          return data.embedding;
        },
      };
      break;
    }
    default:
      throw new Error(`Embedding provider "${providerName}" not supported`);
  }

  log('info', 'Embeddings initialized', { provider: providerName, model, dimensions: embeddingDimensions });
}

// ─── Embedding LRU Cache ───

const EMBED_CACHE_SIZE = 100;
const embedCache = new Map<string, EmbeddingVector>();

export async function generateEmbedding(text: string): Promise<EmbeddingVector> {
  if (!provider) throw new Error('Embeddings not initialized — call initEmbeddings first');

  const cached = embedCache.get(text);
  if (cached) {
    log('debug', 'Embedding cache hit', { textLength: text.length });
    return cached;
  }

  log('debug', 'Generating embedding', { textLength: text.length });
  const start = Date.now();
  const vec = await provider.embed(text);
  log('debug', 'Embedding generated', { dimensions: vec.length, durationMs: Date.now() - start });

  // LRU eviction: delete oldest entry if at capacity
  if (embedCache.size >= EMBED_CACHE_SIZE) {
    const firstKey = embedCache.keys().next().value;
    if (firstKey !== undefined) embedCache.delete(firstKey);
  }
  embedCache.set(text, vec);

  return vec;
}

export function vectorToBlob(vec: EmbeddingVector): Buffer {
  const float32 = new Float32Array(vec);
  return Buffer.from(float32.buffer);
}
