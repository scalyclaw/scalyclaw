import { log } from '../core/logger.js';
import { executeAssistantTool, type ToolContext } from '../tools/tool-impl.js';

export type { ToolContext } from '../tools/tool-registry.js';

/**
 * Handle a tool call inside the orchestrator process.
 * The LLM sees 3 submission methods; internal routing dispatches to local execution or queues.
 */
export async function handleToolCall(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const start = Date.now();
  try {
    return await executeAssistantTool(toolName, input, ctx);
  } catch (err) {
    log('error', `Tool "${toolName}" failed after ${Date.now() - start}ms`, { error: String(err), input });
    return JSON.stringify({ error: `Tool "${toolName}" failed: ${String(err)}` });
  }
}
