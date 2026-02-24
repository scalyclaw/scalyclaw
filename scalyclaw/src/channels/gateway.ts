import { basename, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { ChannelAdapter, MessageHandler, NormalizedMessage } from './adapter.js';
import { log } from '../core/logger.js';

export class GatewayChannel implements ChannelAdapter {
  readonly id = 'gateway';

  private server: FastifyInstance;
  private handler: MessageHandler | null = null;
  private clients = new Set<WebSocket>();

  constructor(server: FastifyInstance) {
    this.server = server;
  }

  private static readonly MAX_WS_CLIENTS = 50;

  async connect(): Promise<void> {
    this.server.get('/ws', { websocket: true }, (socket) => {
      if (this.clients.size >= GatewayChannel.MAX_WS_CLIENTS) {
        socket.close(1013, 'Too many connections');
        return;
      }
      this.clients.add(socket);
      log('info', 'Gateway WS connected', { total: this.clients.size });

      socket.on('message', async (raw: Buffer) => {
        if (!this.handler) return;

        let msg: { type: string; text?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          this.wsSend(socket, { type: 'error', error: 'Invalid JSON' });
          return;
        }

        if (msg.type === 'ping') {
          this.wsSend(socket, { type: 'pong' });
          return;
        }

        if (msg.type === 'message' && msg.text) {
          const normalized: NormalizedMessage = {
            channelId: 'gateway',
            text: msg.text,
            attachments: [],
            timestamp: new Date().toISOString(),
          };

          try {
            await this.handler(normalized);
          } catch (err) {
            log('error', 'Gateway message handler error', { error: String(err) });
            this.wsSend(socket, { type: 'error', error: 'Internal error' });
          }
          return;
        }

        this.wsSend(socket, { type: 'error', error: 'Unknown message type' });
      });

      socket.on('close', () => {
        this.clients.delete(socket);
        log('info', 'Gateway WS disconnected', { total: this.clients.size });
      });

      socket.on('error', (err: Error) => {
        log('error', 'Gateway WS error', { error: String(err) });
        this.clients.delete(socket);
      });
    });

    log('info', 'Gateway channel connected (WebSocket at /ws)');
  }

  async disconnect(): Promise<void> {
    for (const ws of this.clients) {
      try { ws.close(); } catch { /* already closed */ }
    }
    this.clients.clear();
    log('info', 'Gateway channel disconnected');
  }

  async send(text: string): Promise<void> {
    for (const ws of this.clients) {
      this.wsSend(ws, { type: 'response', text });
    }
  }

  async sendFile(filePath: string, caption?: string): Promise<void> {
    const url = `/api/files?path=${encodeURIComponent(filePath)}`;
    const name = basename(filePath);
    const ext = extname(filePath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const isImage = imageExts.includes(ext);
    for (const ws of this.clients) {
      this.wsSend(ws, { type: 'file', url, name, caption, isImage });
    }
  }

  async sendTyping(): Promise<void> {
    for (const ws of this.clients) {
      this.wsSend(ws, { type: 'typing', active: true });
    }
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  private wsSend(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}
