import { createReloadChannel } from '../core/reload-channel.js';

const channel = createReloadChannel('scalyclaw:agents:reload');

export const publishAgentReload = channel.publish;
export const subscribeToAgentReload = channel.subscribe;
