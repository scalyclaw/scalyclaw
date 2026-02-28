import { createReloadChannel } from '../core/reload-channel.js';
import { AGENTS_RELOAD_CHANNEL } from '@scalyclaw/shared/const/constants.js';

const channel = createReloadChannel(AGENTS_RELOAD_CHANNEL);

export const publishAgentReload = channel.publish;
export const subscribeToAgentReload = channel.subscribe;
