import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ChatPanel } from '@/pages/Chat';
import { wsClient } from '@/lib/ws';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatOverlayProps {
  open: boolean;
  onClose: () => void;
  onUnread: () => void;
}

export function ChatOverlay({ open, onClose, onUnread }: ChatOverlayProps) {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const unsub = wsClient.subscribe(() => {
      if (!openRef.current) onUnread();
    });
    return unsub;
  }, [onUnread]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Sliding panel */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold">Chat</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          {open && <ChatPanel compact />}
        </div>
      </aside>
    </>
  );
}
