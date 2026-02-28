import { createReloadChannel } from '../core/reload-channel.js';
import { MCP_RELOAD_CHANNEL } from '@scalyclaw/shared/const/constants.js';

const channel = createReloadChannel(MCP_RELOAD_CHANNEL);

export const publishMcpReload = channel.publish;
export const subscribeToMcpReload = channel.subscribe;
