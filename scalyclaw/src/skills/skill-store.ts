import { createReloadChannel } from '../core/reload-channel.js';
import { SKILLS_RELOAD_CHANNEL } from '@scalyclaw/shared/const/constants.js';

const channel = createReloadChannel(SKILLS_RELOAD_CHANNEL);

export const publishSkillReload = channel.publish;
export const subscribeToSkillReload = channel.subscribe;
