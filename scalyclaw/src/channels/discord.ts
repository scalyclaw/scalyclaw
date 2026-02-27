import { Client, GatewayIntentBits, Partials, Events, AttachmentBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import type { TextChannel, ChatInputCommandInteraction } from 'discord.js';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ChannelAdapter, MessageHandler, NormalizedMessage, Attachment } from './adapter.js';
import { chunkText, sanitizeFileName, saveChannelReplyAddress, loadChannelReplyAddress, SLASH_COMMANDS } from './adapter.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface DiscordConfig {
  botToken: string;
  allowlist: string[];
  textChunkLimit: number;
}

async function downloadDiscordFile(url: string, fileName: string): Promise<string> {
  const downloadsDir = join(PATHS.workspace, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  const destPath = join(downloadsDir, sanitizeFileName(fileName));

  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Failed to download file: ${response.status}`);

  const ws = createWriteStream(destPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, ws);

  return destPath;
}

export function create(config: Record<string, unknown>): DiscordChannel {
  return new DiscordChannel({
    botToken: config.botToken as string,
    allowlist: (config.allowlist as string[]) ?? [],
    textChunkLimit: (config.textChunkLimit as number) ?? 2000,
  });
}

export class DiscordChannel implements ChannelAdapter {
  readonly id = 'discord';

  private client: Client;
  private config: DiscordConfig;
  private handler: MessageHandler | null = null;
  private lastChannel: TextChannel | null = null;
  private lastChannelId: string | null = null;
  private pendingInteraction: ChatInputCommandInteraction | null = null;

  constructor(config: DiscordConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
  }

  async connect(): Promise<void> {
    // Restore persisted reply address from Redis
    try {
      this.lastChannelId = await loadChannelReplyAddress('discord');
      if (this.lastChannelId) {
        log('info', 'Discord: restored channel ID from Redis', { channelId: this.lastChannelId });
      }
    } catch {
      // Redis unavailable — will cache on first incoming message
    }

    // Register slash commands for autocomplete
    this.client.once(Events.ClientReady, async (readyClient) => {
      try {
        const rest = new REST().setToken(this.config.botToken);
        const commands = SLASH_COMMANDS.map(({ command, description }) =>
          new SlashCommandBuilder().setName(command).setDescription(description).toJSON(),
        );
        await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
        log('info', 'Discord: registered slash commands', { count: commands.length });
      } catch (err) {
        log('warn', 'Discord: failed to register slash commands', { error: String(err) });
      }
    });

    // Handle slash command interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (!this.handler) return;

      const cmd = interaction as ChatInputCommandInteraction;

      // Check allowlist
      if (this.config.allowlist.length > 0 && !this.config.allowlist.includes(cmd.user.id)) {
        await cmd.reply({ content: 'You are not authorized.', ephemeral: true });
        return;
      }

      // Acknowledge immediately (we have 3s to respond)
      await cmd.deferReply();

      // Cache reply channel
      if (cmd.channel?.isTextBased()) {
        this.lastChannel = cmd.channel as TextChannel;
        this.lastChannelId = cmd.channelId;
        saveChannelReplyAddress('discord', cmd.channelId).catch(() => {});
      }

      const text = `/${cmd.commandName}`;

      log('debug', 'Discord: received slash command', {
        channelId: cmd.channelId,
        userId: cmd.user.id,
        command: text,
        from: cmd.user.username,
      });

      // Store interaction for the deferred reply
      this.pendingInteraction = cmd;

      const normalized: NormalizedMessage = {
        channelId: 'discord',
        text,
        attachments: [],
        timestamp: new Date().toISOString(),
      };

      try {
        await this.handler(normalized);
      } catch (err) {
        log('error', 'Discord slash command handler error', { error: String(err) });
      } finally {
        this.pendingInteraction = null;
      }
    });

    this.client.on(Events.MessageCreate, async (msg) => {
      if (!this.handler) return;

      // Ignore bot messages
      if (msg.author.bot) return;

      // Check allowlist
      if (this.config.allowlist.length > 0 && !this.config.allowlist.includes(msg.author.id)) {
        log('debug', 'Discord: blocked by allowlist', { userId: msg.author.id });
        return;
      }

      // Cache reply channel and persist to Redis
      this.lastChannel = msg.channel as TextChannel;
      this.lastChannelId = msg.channelId;
      saveChannelReplyAddress('discord', msg.channelId).catch(() => {});

      let text = msg.content || '';
      const attachments: Attachment[] = [];

      // Download attachments
      try {
        for (const att of msg.attachments.values()) {
          const ext = extname(att.name ?? '').toLowerCase();
          const fileName = att.name ?? `attachment_${Date.now()}${ext}`;
          const filePath = await downloadDiscordFile(att.url, fileName);

          let type: Attachment['type'] = 'document';
          if (att.contentType?.startsWith('image/')) type = 'photo';
          else if (att.contentType?.startsWith('video/')) type = 'video';
          else if (att.contentType?.startsWith('audio/')) type = 'audio';

          attachments.push({
            type,
            filePath,
            fileName,
            mimeType: att.contentType ?? undefined,
            fileSize: att.size,
          });
        }
      } catch (err) {
        log('error', 'Discord: failed to download attachment', { error: String(err) });
      }

      // Skip if no text and no attachments
      if (!text && attachments.length === 0) {
        log('debug', 'Discord: skipping message with no text or supported attachments', { channelId: msg.channelId });
        return;
      }

      log('debug', 'Discord: received message', {
        channelId: msg.channelId,
        userId: msg.author.id,
        textLength: text.length,
        text,
        attachments: attachments.length,
        from: msg.author.username,
      });

      const normalized: NormalizedMessage = {
        channelId: 'discord',
        text: text || (attachments.length > 0 ? `[Sent ${attachments.map(a => a.type).join(', ')}]` : ''),
        attachments,
        timestamp: msg.createdAt.toISOString(),
      };

      try {
        await this.handler(normalized);
      } catch (err) {
        log('error', 'Discord message handler error', { error: String(err) });
      }
    });

    await this.client.login(this.config.botToken);
    log('info', 'Discord adapter connected');
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
    log('info', 'Discord adapter disconnected');
  }

  private async resolveChannel(): Promise<TextChannel | null> {
    if (this.lastChannel) return this.lastChannel;
    if (!this.lastChannelId) return null;
    try {
      const ch = await this.client.channels.fetch(this.lastChannelId);
      if (ch?.isTextBased()) {
        this.lastChannel = ch as TextChannel;
        return this.lastChannel;
      }
    } catch {
      log('debug', 'Discord: failed to fetch channel from ID', { channelId: this.lastChannelId });
    }
    return null;
  }

  async send(text: string): Promise<void> {
    const chunks = chunkText(text, this.config.textChunkLimit || 2000);

    log('debug', 'Discord: sending response', { textLength: text.length, chunks: chunks.length });

    // If this is a reply to a deferred slash command, edit the deferred reply first
    if (this.pendingInteraction) {
      const interaction = this.pendingInteraction;
      this.pendingInteraction = null;
      try {
        await interaction.editReply(chunks[0]);
        // Send remaining chunks as follow-up messages
        const channel = await this.resolveChannel();
        if (channel) {
          for (let i = 1; i < chunks.length; i++) {
            await channel.send(chunks[i]);
          }
        }
        log('debug', 'Discord: slash command response sent');
        return;
      } catch (err) {
        log('warn', 'Discord: failed to edit deferred reply, falling back to channel send', { error: String(err) });
      }
    }

    const channel = await this.resolveChannel();
    if (!channel) {
      log('debug', 'Discord: skipping send — no channel cached yet');
      return;
    }

    for (const chunk of chunks) {
      await channel.send(chunk);
    }

    log('debug', 'Discord: response sent');
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    const channel = await this.resolveChannel();
    if (!channel) {
      log('debug', 'Discord: skipping send file — no channel cached yet');
      return;
    }
    const fileName = basename(filePath);

    log('debug', 'Discord: sending file', { filePath, fileName });

    await channel.send({
      files: [new AttachmentBuilder(filePath, { name: fileName })],
      content: caption ?? undefined,
    });

    log('debug', 'Discord: file sent', { fileName });
  }

  async sendTyping(): Promise<void> {
    if (!this.lastChannel) return;
    try {
      await this.lastChannel.sendTyping();
    } catch (err) {
      log('debug', 'Discord: sendTyping failed', { error: String(err) });
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      return this.client.ws.status === 0;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
