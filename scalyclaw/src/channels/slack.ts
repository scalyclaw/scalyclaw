import { App } from '@slack/bolt';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress } from './adapter.js';
import { formatSlack } from './format.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  textChunkLimit: number;
}

async function downloadSlackFile(url: string, fileName: string, botToken: string): Promise<string> {
  const downloadsDir = join(PATHS.workspace, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  const destPath = join(downloadsDir, sanitizeFileName(fileName));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!response.ok || !response.body) throw new Error(`Failed to download file: ${response.status}`);

  const ws = createWriteStream(destPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

  return destPath;
}

export function create(config: Record<string, unknown>): SlackChannel {
  return new SlackChannel({
    botToken: config.botToken as string,
    appToken: config.appToken as string,
    textChunkLimit: (config.textChunkLimit as number) ?? 4000,
  });
}

export class SlackChannel implements ChannelAdapter {
  readonly id = 'slack';

  private app: App;
  private config: SlackConfig;
  private handler: MessageHandler | null = null;
  private lastChannel: string | null = null;

  constructor(config: SlackConfig) {
    this.config = config;
    this.app = new App({
      token: config.botToken,
      socketMode: true,
      appToken: config.appToken,
    });
  }

  async connect(): Promise<void> {
    // Restore persisted reply address from Redis
    try {
      this.lastChannel = await loadChannelReplyAddress('slack');
      if (this.lastChannel) {
        log('info', 'Slack: restored channel ID from Redis', { channel: this.lastChannel });
      }
    } catch {
      // Redis unavailable — will cache on first incoming message
    }

    this.app.message(async ({ message, event }) => {
      if (!this.handler) return;

      // Skip messages with subtypes (edits, deletes, bot messages, etc.)
      if ('subtype' in message && message.subtype) return;

      // Cache reply channel and persist to Redis
      this.lastChannel = event.channel;
      saveChannelReplyAddress('slack', event.channel).catch(() => {});

      let text = '';
      const attachments: Attachment[] = [];

      // Extract text
      if ('text' in message && message.text) {
        text = message.text;
      }

      // Download file attachments
      try {
        if ('files' in message && message.files) {
          for (const file of message.files) {
            if (!file.url_private) continue;

            const ext = extname(file.name ?? '').toLowerCase();
            const fileName = file.name ?? `file_${Date.now()}${ext}`;
            const filePath = await downloadSlackFile(file.url_private, fileName, this.config.botToken);

            let type: Attachment['type'] = 'document';
            if (file.mimetype?.startsWith('image/')) type = 'photo';
            else if (file.mimetype?.startsWith('video/')) type = 'video';
            else if (file.mimetype?.startsWith('audio/')) type = 'audio';

            attachments.push({
              type,
              filePath,
              fileName,
              mimeType: file.mimetype ?? undefined,
              fileSize: file.size ?? undefined,
            });
          }
        }
      } catch (err) {
        log('error', 'Slack: failed to download attachment', { error: String(err) });
      }

      // Skip if no text and no attachments
      if (!text && attachments.length === 0) {
        log('debug', 'Slack: skipping message with no text or supported attachments', { channel: event.channel });
        return;
      }

      log('debug', 'Slack: received message', {
        channel: event.channel,
        textLength: text.length,
        text,
        attachments: attachments.length,
      });

      const normalized: NormalizedMessage = {
        channelId: 'slack',
        text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
        attachments,
        timestamp: 'ts' in event && event.ts
          ? new Date(parseFloat(event.ts) * 1000).toISOString()
          : new Date().toISOString(),
      };

      try {
        await this.handler(normalized);
      } catch (err) {
        log('error', 'Slack message handler error', { error: String(err) });
      }
    });

    await this.app.start();
    log('info', 'Slack adapter connected');
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
    log('info', 'Slack adapter disconnected');
  }

  async send(text: string): Promise<void> {
    if (!this.lastChannel) {
      log('debug', 'Slack: skipping send — no channel cached yet');
      return;
    }
    const chunks = chunkText(text, this.config.textChunkLimit || 4000);

    log('debug', 'Slack: sending response', { channel: this.lastChannel, textLength: text.length, chunks: chunks.length });

    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel: this.lastChannel,
        text: formatSlack(chunk),
      });
    }

    log('debug', 'Slack: response sent', { channel: this.lastChannel });
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.lastChannel) {
      log('debug', 'Slack: skipping send file — no channel cached yet');
      return;
    }
    const fileName = basename(filePath);

    log('debug', 'Slack: sending file', { channel: this.lastChannel, filePath, fileName });

    await this.app.client.filesUploadV2({
      channel_id: this.lastChannel,
      file: filePath,
      filename: fileName,
      initial_comment: caption,
    });

    log('debug', 'Slack: file sent', { channel: this.lastChannel, fileName });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.app.client.auth.test();
      return res.ok === true;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
