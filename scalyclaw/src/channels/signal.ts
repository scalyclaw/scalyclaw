import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress } from './adapter.js';
import { formatPlainText } from './format.js';
import { PATHS } from '../core/paths.js';
import { log } from '../core/logger.js';

export interface SignalConfig {
  apiUrl: string;
  phoneNumber: string;
  pollIntervalMs: number;
  textChunkLimit: number;
}

async function downloadSignalAttachment(apiUrl: string, attachmentId: string, fileName: string): Promise<string> {
  const downloadsDir = join(PATHS.workspace, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  const destPath = join(downloadsDir, sanitizeFileName(fileName));

  const response = await fetch(`${apiUrl}/v1/attachments/${attachmentId}`);
  if (!response.ok || !response.body) throw new Error(`Failed to download attachment: ${response.status}`);

  const ws = createWriteStream(destPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

  return destPath;
}

export function create(config: Record<string, unknown>): SignalChannel {
  return new SignalChannel({
    apiUrl: config.apiUrl as string,
    phoneNumber: config.phoneNumber as string,
    pollIntervalMs: (config.pollIntervalMs as number) ?? 2000,
    textChunkLimit: (config.textChunkLimit as number) ?? 4000,
  });
}

export class SignalChannel implements ChannelAdapter {
  readonly id = 'signal';

  private config: SignalConfig;
  private handler: MessageHandler | null = null;
  private lastSender: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SignalConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Restore persisted reply address from Redis
    try {
      this.lastSender = await loadChannelReplyAddress('signal');
      if (this.lastSender) {
        log('info', 'Signal: restored sender from Redis', { sender: this.lastSender });
      }
    } catch {
      // Redis unavailable — will cache on first incoming message
    }

    this.pollTimer = setInterval(async () => {
      if (!this.handler) return;

      try {
        const response = await fetch(`${this.config.apiUrl}/v1/receive/${this.config.phoneNumber}`);
        if (!response.ok) {
          log('error', 'Signal: failed to poll messages', { status: response.status });
          return;
        }

        const messages = (await response.json()) as any[];

        for (const msg of messages) {
          const envelope = msg?.envelope;
          if (!envelope) continue;

          const dataMessage = envelope.dataMessage;
          if (!dataMessage) continue;

          // Cache sender number and persist to Redis
          this.lastSender = envelope.source;
          saveChannelReplyAddress('signal', this.lastSender!).catch(() => {});

          let text = dataMessage.message || '';
          const attachments: Attachment[] = [];

          // Download attachments
          try {
            if (dataMessage.attachments && Array.isArray(dataMessage.attachments)) {
              for (const att of dataMessage.attachments) {
                const ext = att.contentType
                  ? '.' + att.contentType.split('/')[1]?.split(';')[0]
                  : '';
                const fileName = att.filename ?? `attachment_${Date.now()}${ext}`;
                const filePath = await downloadSignalAttachment(this.config.apiUrl, att.id, fileName);

                let type: Attachment['type'] = 'document';
                if (att.contentType?.startsWith('image/')) type = 'photo';
                else if (att.contentType?.startsWith('video/')) type = 'video';
                else if (att.contentType?.startsWith('audio/')) type = 'audio';

                attachments.push({
                  type,
                  filePath,
                  fileName,
                  mimeType: att.contentType ?? undefined,
                  fileSize: att.size ?? undefined,
                });
              }
            }
          } catch (err) {
            log('error', 'Signal: failed to download attachment', { error: String(err) });
          }

          // Skip if no text and no attachments
          if (!text && attachments.length === 0) {
            log('debug', 'Signal: skipping message with no text or supported attachments', { source: envelope.source });
            continue;
          }

          log('debug', 'Signal: received message', {
            source: envelope.source,
            textLength: text.length,
            text,
            attachments: attachments.length,
          });

          const normalized: NormalizedMessage = {
            channelId: 'signal',
            text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
            attachments,
            timestamp: envelope.timestamp
              ? new Date(envelope.timestamp).toISOString()
              : new Date().toISOString(),
          };

          try {
            await this.handler(normalized);
          } catch (err) {
            log('error', 'Signal message handler error', { error: String(err) });
          }
        }
      } catch (err) {
        log('error', 'Signal: poll error', { error: String(err) });
      }
    }, this.config.pollIntervalMs);

    log('info', 'Signal adapter connected (polling started)', { interval: this.config.pollIntervalMs });
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    log('info', 'Signal adapter disconnected (polling stopped)');
  }

  async send(text: string): Promise<void> {
    if (!this.lastSender) {
      log('debug', 'Signal: skipping send — no sender cached yet');
      return;
    }
    const chunks = chunkText(text, this.config.textChunkLimit || 4096);

    log('debug', 'Signal: sending response', { to: this.lastSender, textLength: text.length, chunks: chunks.length });

    for (const chunk of chunks) {
      const response = await fetch(`${this.config.apiUrl}/v2/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: formatPlainText(chunk),
          number: this.config.phoneNumber,
          recipients: [this.lastSender],
        }),
      });

      if (!response.ok) {
        log('error', 'Signal: failed to send message', { status: response.status });
      }
    }

    log('debug', 'Signal: response sent', { to: this.lastSender });
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.lastSender) {
      log('debug', 'Signal: skipping send file — no sender cached yet');
      return;
    }
    const fileName = basename(filePath);

    log('debug', 'Signal: sending file', { to: this.lastSender, filePath, fileName });

    const fileData = readFileSync(filePath);
    const base64data = Buffer.from(fileData).toString('base64');

    const response = await fetch(`${this.config.apiUrl}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: caption ?? '',
        number: this.config.phoneNumber,
        recipients: [this.lastSender],
        base64_attachments: [`data:application/octet-stream;filename=${fileName};base64,${base64data}`],
      }),
    });

    if (!response.ok) {
      log('error', 'Signal: failed to send file', { status: response.status });
      return;
    }

    log('debug', 'Signal: file sent', { to: this.lastSender, fileName });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiUrl}/v1/about`);
      return response.ok;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
