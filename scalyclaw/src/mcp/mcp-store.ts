import { createReloadChannel } from '../core/reload-channel.js';

const channel = createReloadChannel('scalyclaw:mcp:reload');

export const publishMcpReload = channel.publish;
export const subscribeToMcpReload = channel.subscribe;
