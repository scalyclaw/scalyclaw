import { Telegraf } from 'telegraf';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress, SLASH_COMMANDS } from './adapter.js';
import { formatTelegramHTML } from './format.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface TelegramConfig {
  botToken: string;
  allowlist: string[];
  dmPolicy: string;
  groupPolicy: string;
  textChunkLimit: number;
  mediaMaxMb: number;
}

async function downloadTelegramFile(bot: Telegraf, fileId: string, fileName: string): Promise<string> {
  const downloadsDir = join(PATHS.workspace, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  const fileLink = await bot.telegram.getFileLink(fileId);
  const destPath = join(downloadsDir, sanitizeFileName(fileName));

  const response = await fetch(fileLink.href);
  if (!response.ok || !response.body) throw new Error(`Failed to download file: ${response.status}`);

  const ws = createWriteStream(destPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

  return destPath;
}

export function create(config: Record<string, unknown>): TelegramChannel {
  return new TelegramChannel({
    botToken: config.botToken as string,
    allowlist: (config.allowlist as string[]) ?? [],
    dmPolicy: (config.dmPolicy as string) ?? 'open',
    groupPolicy: (config.groupPolicy as string) ?? 'open',
    textChunkLimit: (config.textChunkLimit as number) ?? 4000,
    mediaMaxMb: (config.mediaMaxMb as number) ?? 10,
  });
}

export class TelegramChannel implements ChannelAdapter {
  readonly id = 'telegram';

  private bot: Telegraf;
  private config: TelegramConfig;
  private handler: MessageHandler | null = null;
  private lastChatId: string | null = null;
  private shuttingDown = false;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Telegraf(config.botToken);
  }

  async connect(): Promise<void> {
    // Fresh instance — avoids stale state from previous lifecycle
    this.bot = new Telegraf(this.config.botToken);
    this.shuttingDown = false;

    // Restore persisted reply address from Redis
    try {
      this.lastChatId = await loadChannelReplyAddress('telegram');
      if (this.lastChatId) {
        log('info', 'Telegram: restored chat ID from Redis', { chatId: this.lastChatId });
      }
    } catch {
      // Redis unavailable — will cache on first incoming message
    }

    // Register commands for Telegram UI autocomplete
    await this.bot.telegram.setMyCommands(SLASH_COMMANDS)
      .catch(err => log('warn', 'Telegram: failed to set commands', { error: String(err) }));

    this.registerHandlers();
    await this.launchBot();
    log('info', 'Telegram adapter connected');
  }

  private registerHandlers(): void {
    this.bot.on('message', async (ctx) => {
      if (!this.handler) return;

      const msg = ctx.message;
      const userId = String(msg.from.id);

      // Check allowlist — always enforce when configured, regardless of policy
      if (this.config.allowlist.length > 0 && !this.config.allowlist.includes(userId)) {
        log('debug', 'Telegram: blocked by allowlist', { userId });
        return;
      }

      // Cache reply address and persist to Redis
      this.lastChatId = String(msg.chat.id);
      saveChannelReplyAddress('telegram', this.lastChatId).catch(() => {});

      let text = '';
      const attachments: Attachment[] = [];

      // Extract text
      if ('text' in msg) {
        text = msg.text;
      } else if ('caption' in msg && msg.caption) {
        text = msg.caption;
      }

      // Extract attachments
      try {
        if ('photo' in msg && msg.photo) {
          const photo = msg.photo[msg.photo.length - 1];
          const fileName = `photo_${Date.now()}.jpg`;
          const filePath = await downloadTelegramFile(this.bot, photo.file_id, fileName);
          attachments.push({ type: 'photo', filePath, fileName, fileSize: photo.file_size });
        }

        if ('document' in msg && msg.document) {
          const doc = msg.document;
          const fileName = doc.file_name ?? `document_${Date.now()}`;
          const filePath = await downloadTelegramFile(this.bot, doc.file_id, fileName);
          attachments.push({ type: 'document', filePath, fileName, mimeType: doc.mime_type, fileSize: doc.file_size });
        }

        if ('audio' in msg && msg.audio) {
          const audio = msg.audio;
          const fileName = audio.file_name ?? `audio_${Date.now()}.mp3`;
          const filePath = await downloadTelegramFile(this.bot, audio.file_id, fileName);
          attachments.push({ type: 'audio', filePath, fileName, mimeType: audio.mime_type, fileSize: audio.file_size });
        }

        if ('video' in msg && msg.video) {
          const video = msg.video;
          const fileName = video.file_name ?? `video_${Date.now()}.mp4`;
          const filePath = await downloadTelegramFile(this.bot, video.file_id, fileName);
          attachments.push({ type: 'video', filePath, fileName, mimeType: video.mime_type, fileSize: video.file_size });
        }

        if ('voice' in msg && msg.voice) {
          const voice = msg.voice;
          const fileName = `voice_${Date.now()}.ogg`;
          const filePath = await downloadTelegramFile(this.bot, voice.file_id, fileName);
          attachments.push({ type: 'voice', filePath, fileName, mimeType: voice.mime_type, fileSize: voice.file_size });
        }
      } catch (err) {
        log('error', 'Telegram: failed to download attachment', { error: String(err) });
      }

      // Skip if no text and no attachments
      if (!text && attachments.length === 0) {
        log('debug', 'Telegram: skipping message with no text or supported attachments', { chatId: msg.chat.id });
        return;
      }

      log('debug', 'Telegram: received message', {
        chatId: this.lastChatId,
        chatType: msg.chat.type,
        textLength: text.length,
        text,
        attachments: attachments.length,
        from: `${msg.from.first_name ?? ''} ${msg.from.last_name ?? ''}`.trim(),
      });

      const normalized: NormalizedMessage = {
        channelId: 'telegram',
        text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
        attachments,
        timestamp: new Date(msg.date * 1000).toISOString(),
      };

      try {
        await this.handler(normalized);
      } catch (err) {
        log('error', 'Telegram message handler error', { error: String(err) });
      }
    });
  }

  private async launchBot(attempt = 1): Promise<void> {
    try {
      // bot.launch() never resolves (blocks for bot lifetime) — fire and forget
      this.bot.launch().catch(err => {
        // Telegraf throws "Attempted to assign to readonly property" on its
        // internal AbortController when stop() races with the polling loop.
        // Suppress errors during expected shutdowns.
        if (!this.shuttingDown) {
          log('error', 'Telegram bot crashed', { error: String(err) });
        }
      });
    } catch (err) {
      log('error', `Telegram bot launch failed (attempt ${attempt}/3)`, { error: String(err) });
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        this.bot = new Telegraf(this.config.botToken);
        this.registerHandlers();
        return this.launchBot(attempt + 1);
      }
      log('error', 'Telegram bot failed to start after 3 attempts');
    }
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true;
    try {
      this.bot.stop('shutdown');
    } catch {
      // stop() can throw if bot was never fully launched — safe to ignore
    }
    // Give Telegraf time to release the long-polling connection
    // so the next bot with the same token can start cleanly
    await new Promise(resolve => setTimeout(resolve, 2000));
    log('info', 'Telegram adapter disconnected');
  }

  async send(text: string): Promise<void> {
    if (!this.lastChatId) {
      log('debug', 'Telegram: skipping send — no chat ID cached yet');
      return;
    }
    const chunks = chunkText(text, this.config.textChunkLimit || 4000);

    log('debug', 'Telegram: sending response', { chatId: this.lastChatId, textLength: text.length, chunks: chunks.length });

    for (const chunk of chunks) {
      const html = formatTelegramHTML(chunk);
      await this.bot.telegram.sendMessage(this.lastChatId, html, { parse_mode: 'HTML' }).catch(() => {
        log('debug', 'Telegram: HTML parse failed, retrying plain text', { chatId: this.lastChatId });
        return this.bot.telegram.sendMessage(this.lastChatId!, chunk);
      });
    }

    log('debug', 'Telegram: response sent', { chatId: this.lastChatId });
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.lastChatId) {
      log('debug', 'Telegram: skipping send file — no chat ID cached yet');
      return;
    }
    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    log('debug', 'Telegram: sending file', { chatId: this.lastChatId, filePath, fileName, ext });

    const audioExts = ['.mp3', '.m4a', '.ogg', '.wav', '.flac', '.aac'];
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.webm'];
    const photoExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    const source = { source: filePath, filename: fileName };

    if (audioExts.includes(ext)) {
      await this.bot.telegram.sendAudio(this.lastChatId, source, { caption });
    } else if (videoExts.includes(ext)) {
      await this.bot.telegram.sendVideo(this.lastChatId, source, { caption });
    } else if (photoExts.includes(ext)) {
      await this.bot.telegram.sendPhoto(this.lastChatId, source, { caption });
    } else {
      await this.bot.telegram.sendDocument(this.lastChatId, source, { caption });
    }

    log('debug', 'Telegram: file sent', { chatId: this.lastChatId, fileName });
  }

  async sendTyping(): Promise<void> {
    if (!this.lastChatId) return;
    try {
      await this.bot.telegram.sendChatAction(this.lastChatId, 'typing');
    } catch (err) {
      log('debug', 'Telegram: sendTyping failed', { error: String(err) });
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.bot.telegram.getMe();
      return true;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
