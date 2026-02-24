import { Menu, Sun, Moon, MessageSquare } from 'lucide-react';
import { StatusDot } from '@/components/shared/StatusDot';
import { useTheme } from '@/hooks/use-theme';

interface HeaderProps {
  title: string;
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  onMenuClick: () => void;
  onChatClick: () => void;
  chatUnread: number;
}

export function Header({ title, wsStatus, onMenuClick, onChatClick, chatUnread }: HeaderProps) {
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md bg-background/80">
      <button
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="flex-1 text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
        <button
          onClick={onChatClick}
          className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Open chat"
        >
          <MessageSquare className="h-4 w-4" />
          {chatUnread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          )}
        </button>
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusDot status={wsStatus} />
          <span className="hidden sm:inline">
            {wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
}
