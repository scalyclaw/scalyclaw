// Shared provider catalog used by onboarding and Models page

export interface ModelCapabilities {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

export interface ChatModelInfo {
  id: string;
  hint: string;
  inputPrice?: number;
  outputPrice?: number;
  capabilities?: ModelCapabilities;
}

export interface ProviderInfo {
  label: string;
  baseUrl: string;
  requiresKey: boolean;
  chatModels: ChatModelInfo[];
  embeddingModels: { id: string; hint: string; dimensions: number; inputPrice?: number; outputPrice?: number }[];
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    chatModels: [
      // ── GPT-5.5 family (released April 23, 2026 — current flagship) ──
      { id: 'openai:gpt-5.5-pro', hint: 'GPT-5.5 Pro — highest accuracy, 1M ctx, reasoning', inputPrice: 30, outputPrice: 180, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:gpt-5.5', hint: 'GPT-5.5 — flagship, 1M ctx, token-efficient reasoning', inputPrice: 5, outputPrice: 30, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── GPT-5.4 family (released March 2026) ──
      { id: 'openai:gpt-5.4', hint: 'GPT-5.4 — 1M ctx, agentic + high reasoning', inputPrice: 2.5, outputPrice: 15, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:gpt-5.4-mini', hint: 'GPT-5.4 mini — 400K ctx, coding & subagents', inputPrice: 0.75, outputPrice: 4.5, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:gpt-5.4-nano', hint: 'GPT-5.4 nano — cheapest 5.4-class, 400K ctx', inputPrice: 0.2, outputPrice: 1.25, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── GPT-5 (Aug 2025) ──
      { id: 'openai:gpt-5', hint: 'GPT-5 — 400K ctx, reasoning', inputPrice: 0.625, outputPrice: 5, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── o-series reasoning models ──
      { id: 'openai:o3-pro', hint: 'o3-pro — higher compute reasoning', inputPrice: 20, outputPrice: 80, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:o3', hint: 'o3 — reasoning', inputPrice: 2, outputPrice: 8, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:o3-deep-research', hint: 'o3 deep research — analysis/research optimized', inputPrice: 10, outputPrice: 40, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:o4-mini', hint: 'o4-mini — compact reasoning', inputPrice: 1.1, outputPrice: 4.4, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:o4-mini-deep-research', hint: 'o4-mini deep research', inputPrice: 2, outputPrice: 8, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'openai:o3-mini', hint: 'o3-mini — previous gen reasoning', inputPrice: 1.1, outputPrice: 4.4, capabilities: { tools: true, reasoning: true } },
      // ── GPT-4 family (legacy, still available) ──
      { id: 'openai:gpt-4.1', hint: 'GPT-4.1', inputPrice: 2, outputPrice: 8, capabilities: { tools: true, vision: true } },
      { id: 'openai:gpt-4.1-mini', hint: 'GPT-4.1 mini', inputPrice: 0.4, outputPrice: 1.6, capabilities: { tools: true, vision: true } },
      { id: 'openai:gpt-4.1-nano', hint: 'GPT-4.1 nano', inputPrice: 0.1, outputPrice: 0.4, capabilities: { tools: true, vision: true } },
      { id: 'openai:gpt-4o', hint: 'GPT-4o — multimodal', inputPrice: 2.5, outputPrice: 10, capabilities: { tools: true, vision: true } },
      { id: 'openai:gpt-4o-mini', hint: 'GPT-4o mini — multimodal, affordable', inputPrice: 0.15, outputPrice: 0.6, capabilities: { tools: true, vision: true } },
    ],
    embeddingModels: [
      { id: 'openai:text-embedding-3-small', hint: '1536 dims', dimensions: 1536, inputPrice: 0.02 },
      { id: 'openai:text-embedding-3-large', hint: '3072 dims', dimensions: 3072, inputPrice: 0.13 },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    chatModels: [
      // ── Latest (released April 16, 2026) ──
      { id: 'anthropic:claude-opus-4-7', hint: 'Opus 4.7 — flagship, 1M ctx, adaptive thinking, agentic coding', inputPrice: 5, outputPrice: 25, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'anthropic:claude-sonnet-4-6', hint: 'Sonnet 4.6 — balanced, 1M ctx, extended + adaptive thinking', inputPrice: 3, outputPrice: 15, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'anthropic:claude-haiku-4-5-20251001', hint: 'Haiku 4.5 — fastest, 200k ctx, extended thinking', inputPrice: 1, outputPrice: 5, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── Legacy (still supported) ──
      { id: 'anthropic:claude-opus-4-6', hint: 'Opus 4.6 — previous flagship, 1M ctx, extended thinking', inputPrice: 5, outputPrice: 25, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'anthropic:claude-sonnet-4-5-20250929', hint: 'Sonnet 4.5 — 200k ctx, extended thinking', inputPrice: 3, outputPrice: 15, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'anthropic:claude-opus-4-5-20251101', hint: 'Opus 4.5 — 200k ctx, extended thinking', inputPrice: 5, outputPrice: 25, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'anthropic:claude-opus-4-1-20250805', hint: 'Opus 4.1 — legacy, 200k ctx', inputPrice: 15, outputPrice: 75, capabilities: { tools: true, vision: true, reasoning: true } },
    ],
    embeddingModels: [],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    chatModels: [
      { id: 'openrouter:openai/gpt-4.1', hint: 'GPT-4.1 via OpenRouter', inputPrice: 2, outputPrice: 8 },
      { id: 'openrouter:openai/gpt-4o', hint: 'GPT-4o via OpenRouter', inputPrice: 2.5, outputPrice: 10 },
      { id: 'openrouter:anthropic/claude-sonnet-4-5-20250929', hint: 'Claude Sonnet via OpenRouter', inputPrice: 3, outputPrice: 15 },
      { id: 'openrouter:google/gemini-2.5-pro-preview', hint: 'Gemini 2.5 Pro via OpenRouter', inputPrice: 1.25, outputPrice: 10 },
      { id: 'openrouter:mistralai/mistral-large-latest', hint: 'Mistral Large via OpenRouter', inputPrice: 2, outputPrice: 6 },
      { id: 'openrouter:meta-llama/llama-3.3-70b-instruct', hint: 'Llama 3.3 70B via OpenRouter', inputPrice: 0.6, outputPrice: 0.6 },
      { id: 'openrouter:deepseek/deepseek-v4-flash', hint: 'DeepSeek V4 Flash via OpenRouter', inputPrice: 0.14, outputPrice: 0.28 },
      { id: 'openrouter:deepseek/deepseek-v4-pro', hint: 'DeepSeek V4 Pro via OpenRouter', inputPrice: 1.74, outputPrice: 3.48 },
    ],
    embeddingModels: [],
  },
  minimax: {
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    requiresKey: true,
    chatModels: [
      { id: 'minimax:MiniMax-M2.5', hint: '204K context, ~60 tok/s', inputPrice: 1, outputPrice: 5 },
      { id: 'minimax:MiniMax-M2.5-highspeed', hint: '204K context, ~100 tok/s', inputPrice: 1, outputPrice: 5 },
    ],
    embeddingModels: [],
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    chatModels: [
      { id: 'ollama:llama3.3', hint: 'Meta Llama 3.3', capabilities: { tools: true } },
      { id: 'ollama:qwen3', hint: 'Qwen 3', capabilities: { tools: true, reasoning: true } },
      { id: 'ollama:qwen3.5:4b', hint: 'Qwen 3.5 — 4B, 256K ctx, thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:qwen3.5:9b', hint: 'Qwen 3.5 — 9B, 256K ctx, thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:qwen3.5:27b', hint: 'Qwen 3.5 — 27B, 256K ctx, thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:qwen3.5:35b', hint: 'Qwen 3.5 — 35B, 256K ctx, thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:qwen3.5:122b', hint: 'Qwen 3.5 — 122B, 256K ctx, thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:qwen3.6:35b-a3b', hint: 'Qwen 3.6 — 35B MoE (3B active), agentic coding', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:gemma3', hint: 'Google Gemma 3' },
      { id: 'ollama:gemma4:e2b', hint: 'Gemma 4 — E2B, 128K ctx, tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:gemma4:e4b', hint: 'Gemma 4 — E4B, 128K ctx, tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:gemma4:26b', hint: 'Gemma 4 — 26B A4B, 256K ctx, tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:gemma4:31b', hint: 'Gemma 4 — 31B dense, 256K ctx, tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'ollama:phi4', hint: 'Microsoft Phi 4', capabilities: { tools: true } },
      { id: 'ollama:deepseek-r1', hint: 'DeepSeek R1 — reasoning', capabilities: { tools: true, reasoning: true } },
      { id: 'ollama:mistral', hint: 'Mistral 7B', capabilities: { tools: true } },
    ],
    embeddingModels: [
      { id: 'ollama:nomic-embed-text', hint: '768 dims', dimensions: 768 },
      { id: 'ollama:mxbai-embed-large', hint: '1024 dims', dimensions: 1024 },
    ],
  },
  google: {
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    chatModels: [
      // ── Gemini 3.1 (released March 2026) ──
      { id: 'google:gemini-3.1-pro-preview', hint: 'Gemini 3.1 Pro — flagship, 2M ctx, agentic', inputPrice: 2, outputPrice: 12, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'google:gemini-3.1-flash-lite-preview', hint: 'Gemini 3.1 Flash-Lite — cheapest, high-volume', inputPrice: 0.25, outputPrice: 1.5, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── Gemini 3 (released Dec 2025) ──
      { id: 'google:gemini-3-flash-preview', hint: 'Gemini 3 Flash — speed + frontier intelligence, 1M ctx', inputPrice: 0.5, outputPrice: 3, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── Gemini 2.5 ──
      { id: 'google:gemini-2.5-pro', hint: 'Gemini 2.5 Pro — coding & complex reasoning', inputPrice: 1.25, outputPrice: 10, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'google:gemini-2.5-flash', hint: 'Gemini 2.5 Flash — 1M ctx, hybrid reasoning', inputPrice: 0.3, outputPrice: 2.5, capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'google:gemini-2.5-flash-lite', hint: 'Gemini 2.5 Flash-Lite — smallest, cheapest', inputPrice: 0.1, outputPrice: 0.4, capabilities: { tools: true, vision: true, reasoning: true } },
      // ── Gemini 2.0 (legacy) ──
      { id: 'google:gemini-2.0-flash', hint: 'Gemini 2.0 Flash — previous gen fast', inputPrice: 0.1, outputPrice: 0.4, capabilities: { tools: true, vision: true } },
    ],
    embeddingModels: [
      { id: 'google:text-embedding-004', hint: '768 dims', dimensions: 768, inputPrice: 0.025 },
    ],
  },
  mistral: {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresKey: true,
    chatModels: [
      { id: 'mistral:mistral-large-latest', hint: 'Most capable', inputPrice: 2, outputPrice: 6 },
      { id: 'mistral:mistral-medium-latest', hint: 'Balanced', inputPrice: 2.7, outputPrice: 8.1 },
      { id: 'mistral:mistral-small-latest', hint: 'Fast and affordable', inputPrice: 0.2, outputPrice: 0.6 },
      { id: 'mistral:codestral-latest', hint: 'Code specialist', inputPrice: 0.3, outputPrice: 0.9 },
    ],
    embeddingModels: [
      { id: 'mistral:mistral-embed', hint: '1024 dims', dimensions: 1024, inputPrice: 0.1 },
    ],
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    chatModels: [
      { id: 'groq:llama-3.3-70b-versatile', hint: 'Llama 3.3 70B' },
      { id: 'groq:llama-3.1-8b-instant', hint: 'Llama 3.1 8B, ultra-fast' },
      { id: 'groq:mixtral-8x7b-32768', hint: 'Mixtral MoE' },
      { id: 'groq:gemma2-9b-it', hint: 'Gemma 2 9B' },
    ],
    embeddingModels: [],
  },
  xai: {
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    chatModels: [
      { id: 'xai:grok-3', hint: 'Most capable', inputPrice: 3, outputPrice: 15 },
      { id: 'xai:grok-3-mini', hint: 'Fast reasoning', inputPrice: 0.3, outputPrice: 0.5 },
      { id: 'xai:grok-2', hint: 'Previous generation', inputPrice: 2, outputPrice: 10 },
    ],
    embeddingModels: [],
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    chatModels: [
      // ── V4 family (released April 24, 2026) ──
      { id: 'deepseek:deepseek-v4-pro', hint: 'DeepSeek V4 Pro — 1M ctx, thinking + tools', inputPrice: 1.74, outputPrice: 3.48, capabilities: { tools: true, reasoning: true } },
      { id: 'deepseek:deepseek-v4-flash', hint: 'DeepSeek V4 Flash — 1M ctx, cheap, thinking + tools', inputPrice: 0.14, outputPrice: 0.28, capabilities: { tools: true, reasoning: true } },
    ],
    embeddingModels: [],
  },
  cohere: {
    label: 'Cohere',
    baseUrl: 'https://api.cohere.com/compatibility/v1',
    requiresKey: true,
    chatModels: [
      { id: 'cohere:command-r-plus', hint: 'Most capable', inputPrice: 2.5, outputPrice: 10 },
      { id: 'cohere:command-r', hint: 'Balanced', inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'cohere:command-light', hint: 'Fast', inputPrice: 0.08, outputPrice: 0.08 },
    ],
    embeddingModels: [
      { id: 'cohere:embed-v4.0', hint: '1024 dims', dimensions: 1024, inputPrice: 0.1 },
      { id: 'cohere:embed-multilingual-v3.0', hint: '1024 dims, multilingual', dimensions: 1024, inputPrice: 0.1 },
    ],
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    chatModels: [
      { id: 'lmstudio:qwen3-8b', hint: 'Qwen 3 8B', capabilities: { tools: true, reasoning: true } },
      { id: 'lmstudio:qwen3.5-9b', hint: 'Qwen 3.5 9B — thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:qwen3.5-27b', hint: 'Qwen 3.5 27B — thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:qwen3.5-35b-a3b', hint: 'Qwen 3.5 35B MoE — thinking + tools + vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:qwen3.6-35b-a3b', hint: 'Qwen 3.6 35B MoE — agentic coding, vision', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:llama-3.3-8b', hint: 'Llama 3.3 8B', capabilities: { tools: true } },
      { id: 'lmstudio:gemma-3-12b', hint: 'Gemma 3 12B' },
      { id: 'lmstudio:gemma-4-e2b-it', hint: 'Gemma 4 E2B — tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:gemma-4-e4b-it', hint: 'Gemma 4 E4B — tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:gemma-4-26b-a4b-it', hint: 'Gemma 4 26B A4B — tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:gemma-4-31b-it', hint: 'Gemma 4 31B — tools + vision + thinking', capabilities: { tools: true, vision: true, reasoning: true } },
      { id: 'lmstudio:deepseek-r1-8b', hint: 'DeepSeek R1 8B — reasoning', capabilities: { tools: true, reasoning: true } },
      { id: 'lmstudio:phi-4-mini', hint: 'Phi 4 Mini', capabilities: { tools: true } },
    ],
    embeddingModels: [
      { id: 'lmstudio:text-embedding-nomic-embed-text-v1.5', hint: '768 dims', dimensions: 768 },
      { id: 'lmstudio:text-embedding-bge-small-en-v1.5', hint: '384 dims', dimensions: 384 },
    ],
  },
  custom: {
    label: 'Custom',
    baseUrl: '',
    requiresKey: true,
    chatModels: [],
    embeddingModels: [],
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[];
