import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  ActivityHandler,
  TurnContext,
  MessageFactory,
} from 'botbuilder';
import type { Activity, ConversationReference } from 'botbuilder';
import type { FastifyInstance } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress } from './adapter.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface TeamsConfig {
  appId: string;
  appPassword: string;
  textChunkLimit: number;
}

async function downloadTeamsAttachment(contentUrl: string, fileName: string): Promise<string> {
  const downloadsDir = join(PATHS.workspace, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  const destPath = join(downloadsDir, sanitizeFileName(fileName));

  const response = await fetch(contentUrl);
  if (!response.ok || !response.body) throw new Error(`Failed to download attachment: ${response.status}`);

  const ws = createWriteStream(destPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

  return destPath;
}

export function create(config: Record<string, unknown>, server: FastifyInstance): TeamsChannel {
  return new TeamsChannel({
    appId: config.appId as string,
    appPassword: config.appPassword as string,
    textChunkLimit: (config.textChunkLimit as number) ?? 4000,
  }, server);
}

export class TeamsChannel implements ChannelAdapter {
  readonly id = 'teams';

  private config: TeamsConfig;
  private server: FastifyInstance;
  private handler: MessageHandler | null = null;
  private adapter: CloudAdapter | null = null;
  private conversationRef: Partial<ConversationReference> | null = null;

  constructor(config: TeamsConfig, server: FastifyInstance) {
    this.config = config;
    this.server = server;
  }

  async connect(): Promise<void> {
    // Restore persisted conversation reference from Redis
    try {
      const saved = await loadChannelReplyAddress('teams');
      if (saved) {
        this.conversationRef = JSON.parse(saved);
        log('info', 'Teams: restored conversation reference from Redis');
      }
    } catch {
      // Redis unavailable or invalid JSON — will cache on first incoming message
    }

    const credentialFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: this.config.appId,
      MicrosoftAppPassword: this.config.appPassword,
      MicrosoftAppType: 'MultiTenant',
    });

    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({}, credentialFactory);
    this.adapter = new CloudAdapter(botFrameworkAuth);

    // Error handler
    this.adapter.onTurnError = async (context, error) => {
      log('error', 'Teams: adapter turn error', { error: String(error) });
      await context.sendActivity('Sorry, an error occurred.');
    };

    const self = this;

    // Create activity handler (bot)
    const bot = new (class extends ActivityHandler {
      constructor() {
        super();
        this.onMessage(async (context, next) => {
          if (!self.handler) {
            await next();
            return;
          }

          // Cache conversation reference and persist to Redis
          self.conversationRef = TurnContext.getConversationReference(context.activity);
          saveChannelReplyAddress('teams', JSON.stringify(self.conversationRef)).catch(() => {});

          let text = context.activity.text || '';
          const attachments: Attachment[] = [];

          // Download attachments
          try {
            if (context.activity.attachments) {
              for (const att of context.activity.attachments) {
                if (!att.contentUrl) continue;

                const ext = extname(att.name ?? '').toLowerCase();
                const fileName = att.name ?? `attachment_${Date.now()}${ext}`;
                const filePath = await downloadTeamsAttachment(att.contentUrl, fileName);

                let type: Attachment['type'] = 'document';
                if (att.contentType?.startsWith('image/')) type = 'photo';
                else if (att.contentType?.startsWith('video/')) type = 'video';
                else if (att.contentType?.startsWith('audio/')) type = 'audio';

                attachments.push({
                  type,
                  filePath,
                  fileName,
                  mimeType: att.contentType ?? undefined,
                });
              }
            }
          } catch (err) {
            log('error', 'Teams: failed to download attachment', { error: String(err) });
          }

          // Skip if no text and no attachments
          if (!text && attachments.length === 0) {
            log('debug', 'Teams: skipping message with no text or supported attachments');
            await next();
            return;
          }

          log('debug', 'Teams: received message', {
            from: context.activity.from?.name,
            textLength: text.length,
            text,
            attachments: attachments.length,
          });

          const normalized: NormalizedMessage = {
            channelId: 'teams',
            text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
            attachments,
            timestamp: context.activity.timestamp
              ? new Date(context.activity.timestamp).toISOString()
              : new Date().toISOString(),
          };

          try {
            await self.handler(normalized);
          } catch (err) {
            log('error', 'Teams message handler error', { error: String(err) });
          }

          await next();
        });
      }
    })();

    // Register Fastify route for Bot Framework messages
    this.server.post('/api/messages/teams', async (request, reply) => {
      if (!this.adapter) {
        return reply.status(503).send('Adapter not initialized');
      }

      try {
        // Adapt Fastify request/response for botbuilder
        const req = {
          body: request.body,
          headers: request.headers,
          method: request.method,
        };

        const res = {
          status: (code: number) => {
            reply.status(code);
            return res;
          },
          setHeader: (key: string, value: string) => {
            reply.header(key, value);
            return res;
          },
          end: (...args: any[]) => {
            const body = args[0];
            if (body) {
              reply.send(body);
            } else {
              reply.send();
            }
          },
          send: (body?: any) => {
            if (body) {
              reply.send(body);
            } else {
              reply.send();
            }
            return res;
          },
        };

        await this.adapter.process(req as any, res as any, async (context) => {
          await bot.run(context);
        });
      } catch (err) {
        log('error', 'Teams: route processing error', { error: String(err) });
        return reply.status(500).send('Internal Server Error');
      }
    });

    log('info', 'Teams adapter connected (webhook route registered)');
  }

  async disconnect(): Promise<void> {
    // No-op — webhook routes stay registered on the Fastify server
    log('info', 'Teams adapter disconnected (webhook route remains active)');
  }

  async send(text: string): Promise<void> {
    if (!this.conversationRef || !this.adapter) {
      log('debug', 'Teams: skipping send — no conversation reference cached yet');
      return;
    }
    const chunks = chunkText(text, this.config.textChunkLimit || 4096);

    log('debug', 'Teams: sending response', { textLength: text.length, chunks: chunks.length });

    for (const chunk of chunks) {
      await this.adapter.continueConversationAsync(
        this.config.appId,
        this.conversationRef as ConversationReference,
        async (ctx) => {
          await ctx.sendActivity(chunk);
        },
      );
    }

    log('debug', 'Teams: response sent');
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.conversationRef || !this.adapter) {
      log('debug', 'Teams: skipping send file — no conversation reference cached yet');
      return;
    }
    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    log('debug', 'Teams: sending file', { filePath, fileName });

    // Determine content type
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp',
      '.mp4': 'video/mp4', '.avi': 'video/avi', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
    };
    const contentType = mimeMap[ext] ?? 'application/octet-stream';

    await this.adapter.continueConversationAsync(
      this.config.appId,
      this.conversationRef as ConversationReference,
      async (ctx) => {
        const activity = MessageFactory.contentUrl(filePath, contentType, fileName, caption);
        await ctx.sendActivity(activity);
      },
    );

    log('debug', 'Teams: file sent', { fileName });
  }

  async isHealthy(): Promise<boolean> {
    return this.adapter !== null;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
