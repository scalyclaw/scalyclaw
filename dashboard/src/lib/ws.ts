type Listener = (data: string) => void;
type StatusListener = (status: 'connected' | 'connecting' | 'disconnected') => void;
type TypingListener = (active: boolean) => void;

export interface FileMessage {
  url: string;
  name: string;
  caption?: string;
  isImage: boolean;
}

type FileListener = (file: FileMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private fileListeners = new Set<FileListener>();
  private statusListeners = new Set<StatusListener>();
  private typingListeners = new Set<TypingListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private _status: 'connected' | 'connecting' | 'disconnected' = 'disconnected';

  get status() {
    return this._status;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('scalyclaw_token');
    const base = import.meta.env.VITE_API_URL ?? '';
    const url = base
      ? `${base.replace(/^http/, 'ws')}/ws${token ? `?token=${token}` : ''}`
      : `${proto}//${location.host}/ws${token ? `?token=${token}` : ''}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.setStatus('connected');
      this.startPing();
      // Fetch buffered responses on reconnect
      this.fetchBufferedResponses();
    };

    this.ws.onmessage = (e) => {
      const raw = typeof e.data === 'string' ? e.data : '';
      if (!raw) return;

      try {
        const msg = JSON.parse(raw) as { type: string; text?: string; error?: string; url?: string; name?: string; caption?: string; isImage?: boolean; active?: boolean };
        if (msg.type === 'pong') return;
        if (msg.type === 'typing') {
          this.typingListeners.forEach((fn) => fn(msg.active ?? false));
          return;
        }
        // Any response/error clears typing indicator
        if (msg.type === 'response' || msg.type === 'error') {
          this.typingListeners.forEach((fn) => fn(false));
        }
        if (msg.type === 'response' && msg.text) {
          this.listeners.forEach((fn) => fn(msg.text!));
        } else if (msg.type === 'error' && msg.error) {
          this.listeners.forEach((fn) => fn(`Error: ${msg.error}`));
        } else if (msg.type === 'file' && msg.url) {
          this.fileListeners.forEach((fn) => fn({
            url: msg.url!,
            name: msg.name ?? 'file',
            caption: msg.caption,
            isImage: msg.isImage ?? false,
          }));
        }
      } catch {
        // Non-JSON message, pass through as-is
        this.listeners.forEach((fn) => fn(raw));
      }
    };

    this.ws.onclose = () => {
      this.setStatus('disconnected');
      this.stopPing();
      this.typingListeners.forEach((fn) => fn(false));
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  send(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'message', text }));
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeFile(fn: FileListener): () => void {
    this.fileListeners.add(fn);
    return () => this.fileListeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onTyping(fn: TypingListener): () => void {
    this.typingListeners.add(fn);
    return () => this.typingListeners.delete(fn);
  }

  private setStatus(s: 'connected' | 'connecting' | 'disconnected') {
    this._status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async fetchBufferedResponses() {
    try {
      const base = import.meta.env.VITE_API_URL ?? '';
      const token = localStorage.getItem('scalyclaw_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${base}/api/buffered-responses?channelId=gateway`, { headers });
      if (!res.ok) return;
      const data = await res.json() as Array<{ type: string; result?: string; error?: string }>;
      for (const event of data) {
        if (event.type === 'complete' && event.result) {
          this.listeners.forEach((fn) => fn(event.result!));
        } else if (event.type === 'error' && event.error) {
          this.listeners.forEach((fn) => fn(`Error: ${event.error}`));
        }
      }
    } catch {
      // Buffered response fetch is best-effort
    }
  }
}

export const wsClient = new WsClient();
