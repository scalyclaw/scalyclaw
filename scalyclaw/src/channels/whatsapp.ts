import type { FastifyInstance } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress } from './adapter.js';
import { formatWhatsApp } from './format.js';
import { PATHS } from '../core/paths.js';
import { log } from '../core/logger.js';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret?: string;
  apiVersion: string;
  textChunkLimit: number;
}

export function create(config: Record<string, unknown>, server: FastifyInstance): WhatsAppChannel {
  return new WhatsAppChannel({
    phoneNumberId: config.phoneNumberId as string,
    accessToken: config.accessToken as string,
    verifyToken: config.verifyToken as string,
    appSecret: (config.appSecret as string) ?? undefined,
    apiVersion: (config.apiVersion as string) ?? 'v21.0',
    textChunkLimit: (config.textChunkLimit as number) ?? 4000,
  }, server);
}

export class WhatsAppChannel implements ChannelAdapter {
  readonly id = 'whatsapp';

  private config: WhatsAppConfig;
  private server: FastifyInstance;
  private handler: MessageHandler | null = null;
  private lastPhone: string | null = null;

  constructor(config: WhatsAppConfig, server: FastifyInstance) {
    this.config = config;
    this.server = server;
  }

  private get baseUrl(): string {
    return `https://graph.facebook.com/${this.config.apiVersion}`;
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.accessToken}` };
  }

  private async downloadMediaFile(mediaId: string, fileName: string): Promise<string> {
    const downloadsDir = join(PATHS.workspace, 'downloads');
    await mkdir(downloadsDir, { recursive: true });

    // First, get the media URL
    const metaResponse = await fetch(`${this.baseUrl}/${mediaId}`, {
      headers: this.authHeader,
    });
    if (!metaResponse.ok) throw new Error(`Failed to get media URL: ${metaResponse.status}`);
    const metaData = (await metaResponse.json()) as { url: string };

    // Then download the actual file
    const destPath = join(downloadsDir, sanitizeFileName(fileName));
    const response = await fetch(metaData.url, {
      headers: this.authHeader,
    });
    if (!response.ok || !response.body) throw new Error(`Failed to download media: ${response.status}`);

    const ws = createWriteStream(destPath);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

    return destPath;
  }

  async connect(): Promise<void> {
    // Restore persisted reply address from Redis
    try {
      this.lastPhone = await loadChannelReplyAddress('whatsapp');
      if (this.lastPhone) {
        log('info', 'WhatsApp: restored phone from Redis', { phone: this.lastPhone });
      }
    } catch {
      // Redis unavailable — will cache on first incoming message
    }

    // Webhook verification endpoint
    this.server.get('/webhooks/whatsapp', async (request, reply) => {
      const query = request.query as Record<string, string>;
      const mode = query['hub.mode'];
      const token = query['hub.verify_token'];
      const challenge = query['hub.challenge'];

      if (mode === 'subscribe' && token === this.config.verifyToken) {
        log('info', 'WhatsApp: webhook verified');
        return reply.send(challenge);
      }

      log('error', 'WhatsApp: webhook verification failed');
      return reply.status(403).send('Forbidden');
    });

    // Capture raw body for HMAC verification (before JSON parsing)
    if (this.config.appSecret) {
      this.server.addHook('preParsing', async (request, _reply, payload) => {
        if (request.url.startsWith('/webhooks/whatsapp') && request.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of payload as AsyncIterable<Buffer>) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks);
          (request as any).rawBody = raw;
          // Return a new readable stream so Fastify can still parse JSON
          const { Readable } = await import('node:stream');
          return Readable.from(raw);
        }
        return payload;
      });
    }

    // Webhook message endpoint
    this.server.post('/webhooks/whatsapp', async (request, reply) => {
      // HMAC-SHA256 signature verification
      if (this.config.appSecret) {
        const signature = request.headers['x-hub-signature-256'] as string | undefined;
        if (!signature) return reply.status(401).send('Missing signature');
        const rawBody = (request as any).rawBody as Buffer;
        if (!rawBody) return reply.status(401).send('Missing raw body');
        const expected = 'sha256=' + createHmac('sha256', this.config.appSecret)
          .update(rawBody).digest('hex');
        if (
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
          return reply.status(401).send('Invalid signature');
        }
      }

      if (!this.handler) {
        return reply.status(200).send('OK');
      }

      try {
        const body = request.body as any;
        const entry = body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (!value?.messages?.[0]) {
          return reply.status(200).send('OK');
        }

        const message = value.messages[0];
        const contact = value.contacts?.[0];

        // Cache sender phone and persist to Redis
        this.lastPhone = message.from;
        if (this.lastPhone) saveChannelReplyAddress('whatsapp', this.lastPhone).catch(() => {});

        let text = '';
        const attachments: Attachment[] = [];

        // Extract text
        if (message.type === 'text' && message.text?.body) {
          text = message.text.body;
        }

        // Extract media attachments
        try {
          const mediaTypes: Array<{ key: string; type: Attachment['type']; ext: string }> = [
            { key: 'image', type: 'photo', ext: '.jpg' },
            { key: 'document', type: 'document', ext: '' },
            { key: 'audio', type: 'audio', ext: '.ogg' },
            { key: 'video', type: 'video', ext: '.mp4' },
            { key: 'voice', type: 'voice', ext: '.ogg' },
          ];

          for (const { key, type, ext } of mediaTypes) {
            if (message[key]) {
              const media = message[key];
              const mediaId = media.id;
              const fileName = media.filename ?? `${key}_${Date.now()}${ext}`;
              const filePath = await this.downloadMediaFile(mediaId, fileName);

              attachments.push({
                type,
                filePath,
                fileName,
                mimeType: media.mime_type ?? undefined,
              });
            }
          }
        } catch (err) {
          log('error', 'WhatsApp: failed to download attachment', { error: String(err) });
        }

        // Add caption text if present on media
        if (!text && message.image?.caption) text = message.image.caption;
        if (!text && message.video?.caption) text = message.video.caption;
        if (!text && message.document?.caption) text = message.document.caption;

        // Skip if no text and no attachments
        if (!text && attachments.length === 0) {
          log('debug', 'WhatsApp: skipping message with no text or supported attachments', { from: message.from });
          return reply.status(200).send('OK');
        }

        log('debug', 'WhatsApp: received message', {
          from: message.from,
          contactName: contact?.profile?.name,
          textLength: text.length,
          text,
          attachments: attachments.length,
        });

        const normalized: NormalizedMessage = {
          channelId: 'whatsapp',
          text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
          attachments,
          timestamp: message.timestamp
            ? new Date(parseInt(message.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
        };

        try {
          await this.handler(normalized);
        } catch (err) {
          log('error', 'WhatsApp message handler error', { error: String(err) });
        }
      } catch (err) {
        log('error', 'WhatsApp: webhook processing error', { error: String(err) });
      }

      return reply.status(200).send('OK');
    });

    log('info', 'WhatsApp adapter connected (webhook routes registered)');
  }

  async disconnect(): Promise<void> {
    // No-op — webhook routes stay registered on the Fastify server
    log('info', 'WhatsApp adapter disconnected (webhook routes remain active)');
  }

  async send(text: string): Promise<void> {
    if (!this.lastPhone) {
      log('debug', 'WhatsApp: skipping send — no phone number cached yet');
      return;
    }
    const chunks = chunkText(text, this.config.textChunkLimit || 4096);

    log('debug', 'WhatsApp: sending response', { to: this.lastPhone, textLength: text.length, chunks: chunks.length });

    for (const chunk of chunks) {
      const response = await fetch(`${this.baseUrl}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          ...this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.lastPhone,
          type: 'text',
          text: { body: formatWhatsApp(chunk) },
        }),
      });

      if (!response.ok) {
        log('error', 'WhatsApp: failed to send message', { status: response.status });
      }
    }

    log('debug', 'WhatsApp: response sent', { to: this.lastPhone });
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.lastPhone) {
      log('debug', 'WhatsApp: skipping send file — no phone number cached yet');
      return;
    }
    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    log('debug', 'WhatsApp: sending file', { to: this.lastPhone, filePath, fileName });

    // Upload media first
    const fileData = await readFile(filePath);
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', new Blob([new Uint8Array(fileData)]), fileName);

    // Determine MIME type from extension
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp',
      '.mp4': 'video/mp4', '.avi': 'video/avi', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
    };
    const mimeType = mimeMap[ext] ?? 'application/octet-stream';
    formData.append('type', mimeType);

    const uploadResponse = await fetch(`${this.baseUrl}/${this.config.phoneNumberId}/media`, {
      method: 'POST',
      headers: this.authHeader,
      body: formData,
    });

    if (!uploadResponse.ok) {
      log('error', 'WhatsApp: failed to upload media', { status: uploadResponse.status });
      return;
    }

    const uploadData = (await uploadResponse.json()) as { id: string };
    const mediaId = uploadData.id;

    // Determine media type for the message
    let mediaType: string;
    if (mimeType.startsWith('image/')) mediaType = 'image';
    else if (mimeType.startsWith('video/')) mediaType = 'video';
    else if (mimeType.startsWith('audio/')) mediaType = 'audio';
    else mediaType = 'document';

    const mediaPayload: Record<string, any> = { id: mediaId };
    if (caption) mediaPayload.caption = caption;
    if (mediaType === 'document') mediaPayload.filename = fileName;

    const sendResponse = await fetch(`${this.baseUrl}/${this.config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        ...this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.lastPhone,
        type: mediaType,
        [mediaType]: mediaPayload,
      }),
    });

    if (!sendResponse.ok) {
      log('error', 'WhatsApp: failed to send media message', { status: sendResponse.status });
      return;
    }

    log('debug', 'WhatsApp: file sent', { to: this.lastPhone, fileName, mediaId });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/${this.config.phoneNumberId}`, {
        headers: this.authHeader,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
