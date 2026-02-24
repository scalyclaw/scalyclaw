import type { ChatMessage } from '../models/provider.js';

export interface ToolContext {
  channelId: string;
  sendToChannel: (channelId: string, text: string) => Promise<void>;
  signal?: AbortSignal;
  messages?: ChatMessage[];   // live messages array (for compact_context)
  modelId?: string;           // current model ID (for compact_context)
  allowedSkillIds?: string[]; // when set, only these skills can be invoked
  allowedToolNames?: Set<string>; // when set, only these tools can be executed
}

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<string> | string;

const handlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  handlers.set(name, handler);
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const handler = handlers.get(toolName);
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  return handler(input, ctx);
}
