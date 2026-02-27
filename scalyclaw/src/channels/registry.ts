import type { ChannelAdapter } from './adapter.js';
import type { FastifyInstance } from 'fastify';
import { log } from '@scalyclaw/shared/core/logger.js';
import { create as createTelegram } from './telegram.js';
import { create as createDiscord } from './discord.js';
import { create as createSlack } from './slack.js';
import { create as createWhatsApp } from './whatsapp.js';
import { create as createSignal } from './signal.js';
import { create as createTeams } from './teams.js';

type ChannelFactory = (config: Record<string, unknown>, server: FastifyInstance) => ChannelAdapter;

const factories: Record<string, ChannelFactory> = {
  telegram: createTelegram,
  discord: createDiscord,
  slack: createSlack,
  whatsapp: createWhatsApp,
  signal: createSignal,
  teams: createTeams,
};

export function buildChannelAdapters(
  channels: Record<string, Record<string, unknown>>,
  server: FastifyInstance,
): ChannelAdapter[] {
  const adapters: ChannelAdapter[] = [];
  for (const [id, config] of Object.entries(channels)) {
    if (!config.enabled) continue;
    const factory = factories[id];
    if (!factory) {
      log('warn', `Unknown channel type "${id}" — skipping`);
      continue;
    }
    adapters.push(factory(config, server));
  }
  return adapters;
}
