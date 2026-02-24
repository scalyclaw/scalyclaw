export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelProvider {
  id: string;
  chat(params: {
    model: string;
    systemPrompt: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    reasoningEnabled?: boolean;
    signal?: AbortSignal;
  }): Promise<ModelResponse>;
  ping(model: string): Promise<boolean>;
}

export interface ModelSelector {
  model: string;
  weight: number;
  priority: number;
}

export function selectModel(models: ModelSelector[]): string | null {
  if (models.length === 0) return null;

  // Sort by priority (lower = better), then pick by weight
  const sorted = [...models].sort((a, b) => a.priority - b.priority);
  // Simple weighted selection among top priority group
  const topPriority = sorted[0].priority;
  const candidates = sorted.filter(m => m.priority === topPriority);

  if (candidates.length === 1) return candidates[0].model;

  const totalWeight = candidates.reduce((sum, m) => sum + m.weight, 0);
  let random = Math.random() * totalWeight;
  for (const candidate of candidates) {
    random -= candidate.weight;
    if (random <= 0) return candidate.model;
  }
  return candidates[0].model;
}

export function parseModelId(modelId: string): { provider: string; model: string } {
  const colonIndex = modelId.indexOf(':');
  if (colonIndex === -1) throw new Error(`Invalid model ID "${modelId}" — expected "provider:model"`);
  return {
    provider: modelId.substring(0, colonIndex),
    model: modelId.substring(colonIndex + 1),
  };
}
