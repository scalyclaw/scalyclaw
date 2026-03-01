import { reloadServers } from './mcp-manager.js';
import { loadConfig } from '../core/config.js';
import { invalidatePromptCache } from '../prompt/builder.js';
import { log } from '@scalyclaw/shared/core/logger.js';

/** Reload MCP servers in-process (no pub/sub needed — MCP only runs on node). */
export async function publishMcpReload(): Promise<void> {
  const freshConfig = await loadConfig();
  await reloadServers(freshConfig.mcpServers ?? {});
  invalidatePromptCache();
  log('info', 'MCP reload completed (in-process)');
}
