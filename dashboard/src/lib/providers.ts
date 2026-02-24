// Shared provider catalog used by onboarding and Models page

export interface ProviderInfo {
  label: string;
  baseUrl: string;
  requiresKey: boolean;
  chatModels: { id: string; hint: string; inputPrice?: number; outputPrice?: number }[];
  embeddingModels: { id: string; hint: string; dimensions: number; inputPrice?: number; outputPrice?: number }[];
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    chatModels: [
      { id: 'openai:gpt-4.1', hint: 'Most capable', inputPrice: 2, outputPrice: 8 },
      { id: 'openai:gpt-4.1-mini', hint: 'Fast and affordable', inputPrice: 0.4, outputPrice: 1.6 },
      { id: 'openai:gpt-4.1-nano', hint: 'Fastest, lightweight', inputPrice: 0.1, outputPrice: 0.4 },
      { id: 'openai:gpt-4o', hint: 'Multimodal', inputPrice: 2.5, outputPrice: 10 },
      { id: 'openai:gpt-4o-mini', hint: 'Multimodal, affordable', inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'openai:o3', hint: 'Reasoning model', inputPrice: 2, outputPrice: 8 },
      { id: 'openai:o4-mini', hint: 'Compact reasoning', inputPrice: 1.1, outputPrice: 4.4 },
      { id: 'openai:o3-mini', hint: 'Previous gen reasoning', inputPrice: 1.1, outputPrice: 4.4 },
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
      { id: 'anthropic:claude-opus-4-6', hint: 'Most capable', inputPrice: 15, outputPrice: 75 },
      { id: 'anthropic:claude-sonnet-4-5-20250929', hint: 'Balanced', inputPrice: 3, outputPrice: 15 },
      { id: 'anthropic:claude-haiku-4-5-20251001', hint: 'Fast', inputPrice: 0.8, outputPrice: 4 },
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
      { id: 'openrouter:deepseek/deepseek-chat', hint: 'DeepSeek V3 via OpenRouter', inputPrice: 0.27, outputPrice: 1.1 },
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
      { id: 'ollama:llama3.3', hint: 'Meta Llama 3.3' },
      { id: 'ollama:qwen3', hint: 'Qwen 3' },
      { id: 'ollama:gemma3', hint: 'Google Gemma 3' },
      { id: 'ollama:phi4', hint: 'Microsoft Phi 4' },
      { id: 'ollama:deepseek-r1', hint: 'DeepSeek R1' },
      { id: 'ollama:mistral', hint: 'Mistral 7B' },
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
      { id: 'google:gemini-2.5-pro', hint: 'Most capable', inputPrice: 1.25, outputPrice: 10 },
      { id: 'google:gemini-2.5-flash', hint: 'Fast and efficient', inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'google:gemini-2.0-flash', hint: 'Previous gen fast', inputPrice: 0.1, outputPrice: 0.4 },
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
      { id: 'deepseek:deepseek-chat', hint: 'DeepSeek V3', inputPrice: 0.27, outputPrice: 1.1 },
      { id: 'deepseek:deepseek-reasoner', hint: 'R1 reasoning model', inputPrice: 0.55, outputPrice: 2.19 },
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
  custom: {
    label: 'Custom',
    baseUrl: '',
    requiresKey: true,
    chatModels: [],
    embeddingModels: [],
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[];
