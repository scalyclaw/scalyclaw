import { createReloadChannel } from '../core/reload-channel.js';

const channel = createReloadChannel('scalyclaw:skills:reload');

export const publishSkillReload = channel.publish;
export const subscribeToSkillReload = channel.subscribe;
