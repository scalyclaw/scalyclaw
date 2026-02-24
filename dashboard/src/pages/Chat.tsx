import { useState, useEffect, useRef } from 'react';
import { Send, Download } from 'lucide-react';
import { getMessages } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useWs } from '@/hooks/use-ws';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatMessage {
  role: string;
  content: string;
  file?: {
    url: string;
    name: string;
    caption?: string;
    isImage: boolean;
  };
}

const BASE = import.meta.env.VITE_API_URL ?? '';

export function ChatPanel({ compact }: { compact?: boolean }) {
  const { data, loading, error } = useApi(() => getMessages(), []);
  const { status, messages: wsMessages, files: wsFiles, send } = useWs();
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Seed local messages from history once loaded
  useEffect(() => {
    if (data?.messages) {
      setLocalMessages(data.messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })));
    }
  }, [data]);

  // When a WS text message arrives, append it as an assistant message
  useEffect(() => {
    if (wsMessages.length === 0) return;
    const latest = wsMessages[wsMessages.length - 1];
    setLocalMessages((prev) => [...prev, { role: 'assistant', content: latest }]);
    setThinking(false);
  }, [wsMessages.length]);

  // When a WS file message arrives, append it as an assistant file message
  useEffect(() => {
    if (wsFiles.length === 0) return;
    const latest = wsFiles[wsFiles.length - 1];
    setLocalMessages((prev) => [...prev, {
      role: 'assistant',
      content: latest.caption || latest.name,
      file: latest,
    }]);
    setThinking(false);
  }, [wsFiles.length]);

  // Auto-scroll to bottom on new messages or thinking state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages.length, thinking]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setLocalMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);
    send(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className={cn('space-y-3 py-4', !compact && 'mx-auto max-w-2xl')}>
          {loading && (
            <p className="text-center text-sm text-muted-foreground">Loading history...</p>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">
              Failed to load history: {error}
            </p>
          )}

          {!loading && localMessages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              No messages yet. Send one to get started.
            </p>
          )}

          {localMessages.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={i}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
              >
                <Card
                  className={cn(
                    'max-w-[80%] px-4 py-3',
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-card-foreground',
                  )}
                >
                  {msg.file ? (
                    <FileContent file={msg.file} caption={msg.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </Card>
              </div>
            );
          })}

          {/* Thinking indicator */}
          {thinking && (
            <div className="flex justify-start">
              <Card className="bg-card px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </div>
              </Card>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="border-t px-4 py-3">
        <div className={cn('flex items-center gap-2', !compact && 'mx-auto max-w-2xl')}>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={status !== 'connected'}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || status !== 'connected'}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileContent({ file, caption }: { file: ChatMessage['file']; caption: string }) {
  if (!file) return null;
  const fileUrl = `${BASE}${file.url}`;

  return (
    <div className="space-y-2">
      {file.isImage ? (
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={fileUrl}
            alt={file.name}
            className="max-h-64 rounded-md object-contain"
            loading="lazy"
          />
        </a>
      ) : (
        <a
          href={fileUrl}
          download={file.name}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent transition-colors"
        >
          <Download className="h-4 w-4 shrink-0" />
          <span className="truncate">{file.name}</span>
        </a>
      )}
      {caption && caption !== file.name && (
        <p className="text-sm whitespace-pre-wrap">{caption}</p>
      )}
    </div>
  );
}
