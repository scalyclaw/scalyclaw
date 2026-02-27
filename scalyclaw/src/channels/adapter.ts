export interface Attachment {
  type: 'photo' | 'document' | 'audio' | 'video' | 'voice';
  filePath: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
}

export interface NormalizedMessage {
  channelId: string;
  text: string;
  attachments: Attachment[];
  timestamp: string;
}

export type MessageHandler = (message: NormalizedMessage) => Promise<void>;

export interface ChannelAdapter {
  id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(text: string): Promise<void>;
  sendFile(filePath: string, caption?: string): Promise<void>;
  sendTyping?(): Promise<void>;
  isHealthy(): Promise<boolean>;
  onMessage(handler: MessageHandler): void;
}

// ─── Slash command registry (single source of truth) ───

export const SLASH_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'start', description: 'Start / greet' },
  { command: 'help', description: 'List commands' },
  { command: 'status', description: 'System overview' },
  { command: 'stop', description: 'Stop current work' },
  { command: 'cancel', description: 'Cancel a reminder or task' },
  { command: 'reminders', description: 'Scheduled reminders' },
  { command: 'tasks', description: 'Scheduled tasks' },
  { command: 'models', description: 'LLM models' },
  { command: 'agents', description: 'Configured agents' },
  { command: 'skills', description: 'Installed skills' },
  { command: 'mcp', description: 'Connected MCP servers' },
  { command: 'guards', description: 'Security guards' },
  { command: 'config', description: 'Current config' },
  { command: 'vault', description: 'Stored secrets' },
  { command: 'memory', description: 'Search memories' },
  { command: 'usage', description: 'Token usage and budget' },
  { command: 'clear', description: 'Clear session' },
  { command: 'update', description: 'Update ScalyClaw' },
];

// ─── Channel reply address persistence ───
// Persists the last known reply address (chat ID, channel ID, phone number, etc.)
// in Redis so broadcasts work across reloads and channels that haven't received
// a message in this process lifetime.

const CHANNEL_STATE_PREFIX = 'scalyclaw:channel:state:';

export async function saveChannelReplyAddress(channelId: string, address: string): Promise<void> {
  const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
  const redis = getRedis();
  await redis.set(`${CHANNEL_STATE_PREFIX}${channelId}`, address);
}

export async function loadChannelReplyAddress(channelId: string): Promise<string | null> {
  const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
  const redis = getRedis();
  return redis.get(`${CHANNEL_STATE_PREFIX}${channelId}`);
}

export function sanitizeFileName(name: string): string {
  // Strip path separators and traversal sequences
  return name.replace(/[\/\\]/g, '_').replace(/\.\./g, '_');
}

export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex < maxLength / 2) {
      // Try single newline
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex < maxLength / 2) {
      // Try space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex < maxLength / 2) {
      // Force split
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}
