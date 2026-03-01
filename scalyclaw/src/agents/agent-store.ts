import { loadAllAgents } from './agent-loader.js';
import { invalidatePromptCache } from '../prompt/builder.js';
import { log } from '@scalyclaw/shared/core/logger.js';

/** Reload agents in-process (no pub/sub needed — agents only run on node). */
export async function publishAgentReload(): Promise<void> {
  await loadAllAgents();
  invalidatePromptCache();
  log('info', 'Agent reload completed (in-process)');
}
