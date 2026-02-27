import type { ChannelAdapter, MessageHandler } from './adapter.js';
import { log } from '@scalyclaw/shared/core/logger.js';

const adapters = new Map<string, ChannelAdapter>();
let activeHandler: MessageHandler | null = null;

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(channelId: string): ChannelAdapter | undefined {
  return adapters.get(channelId);
}

export function getAllAdapters(): ChannelAdapter[] {
  return [...adapters.values()];
}

export async function connectAll(handler: MessageHandler): Promise<void> {
  activeHandler = handler;
  for (const adapter of adapters.values()) {
    adapter.onMessage(handler);
    try {
      await adapter.connect();
      log('info', `Channel connected: ${adapter.id}`);
    } catch (err) {
      log('error', `Channel failed to connect: ${adapter.id}`, { error: String(err) });
    }
  }
}

export async function disconnectAll(): Promise<void> {
  for (const adapter of adapters.values()) {
    try {
      await adapter.disconnect();
    } catch (err) {
      log('error', `Channel failed to disconnect: ${adapter.id}`, { error: String(err) });
    }
  }
  adapters.clear();
  activeHandler = null;
}

/**
 * Hot-reload channel adapters.
 * Disconnects all non-gateway adapters, then registers and connects
 * the new set based on fresh config.
 */
export async function reloadChannels(newAdapters: ChannelAdapter[]): Promise<void> {
  const handler = activeHandler;
  if (!handler) {
    log('warn', 'Cannot reload channels — no active message handler');
    return;
  }

  // Disconnect all non-gateway adapters
  for (const [id, adapter] of adapters) {
    if (id === 'gateway') continue;
    try {
      await adapter.disconnect();
      log('info', `Channel disconnected for reload: ${id}`);
    } catch (err) {
      log('error', `Failed to disconnect channel during reload: ${id}`, { error: String(err) });
    }
    adapters.delete(id);
  }

  // Register and connect new adapters
  for (const adapter of newAdapters) {
    adapters.set(adapter.id, adapter);
    adapter.onMessage(handler);
    try {
      await adapter.connect();
      log('info', `Channel connected after reload: ${adapter.id}`);
    } catch (err) {
      log('error', `Channel failed to connect after reload: ${adapter.id}`, { error: String(err) });
    }
  }
}

/** Send a text message to a specific channel */
export async function sendToChannel(channelId: string, text: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter) {
    log('warn', `sendToChannel: channel "${channelId}" not found`, { textLength: text.length });
    return;
  }
  try {
    await adapter.send(text);
  } catch (err) {
    log('error', `sendToChannel failed for channel: ${channelId}`, { error: String(err) });
  }
}

/** Send typing indicator to a specific channel */
export async function sendTypingToChannel(channelId: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter?.sendTyping) return;
  try {
    await adapter.sendTyping();
  } catch (err) {
    log('debug', `sendTyping failed for channel: ${channelId}`, { error: String(err) });
  }
}

/** Interval-based typing refresh — re-sends every 4s to keep indicators alive on platforms like Telegram/Discord */
const TYPING_INTERVAL_MS = 4_000;
const activeTypingLoops = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Start a persistent typing indicator loop for a channel.
 * Sends typing immediately, then every 4s. Idempotent — calling twice on
 * the same channel just resets the timer.
 */
export function startTypingLoop(channelId: string): void {
  stopTypingLoop(channelId); // clear any existing loop
  sendTypingToChannel(channelId).catch(() => {});
  const interval = setInterval(() => {
    sendTypingToChannel(channelId).catch(() => {});
  }, TYPING_INTERVAL_MS);
  activeTypingLoops.set(channelId, interval);
}

/** Stop the typing indicator loop for a channel. */
export function stopTypingLoop(channelId: string): void {
  const interval = activeTypingLoops.get(channelId);
  if (interval) {
    clearInterval(interval);
    activeTypingLoops.delete(channelId);
  }
}

/** Send a file to a specific channel */
export async function sendFileToChannel(channelId: string, filePath: string, caption?: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter) {
    log('warn', `sendFileToChannel: channel "${channelId}" not found`, { filePath });
    return;
  }
  try {
    await adapter.sendFile(filePath, caption);
  } catch (err) {
    log('error', `sendFileToChannel failed for channel: ${channelId}`, { error: String(err) });
  }
}


export async function getChannelHealth(): Promise<Record<string, boolean>> {
  const health: Record<string, boolean> = {};
  for (const adapter of adapters.values()) {
    health[adapter.id] = await adapter.isHealthy();
  }
  return health;
}
