import { useState, useCallback } from 'react';
import { useLocation } from 'react-router';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatOverlay } from '@/components/shared/ChatOverlay';

const titles: Record<string, string> = {
  '/': 'Overview',
  '/mind': 'Mind',

  '/channels': 'Channels',
  '/models': 'Models',
  '/skills': 'Skills',
  '/agents': 'Agents',
  '/memory': 'Memory',
  '/vault': 'Vault',
  '/mcp': 'MCP Servers',
  '/scheduler': 'Scheduler',
  '/security': 'Security',
  '/usage': 'Usage',
  '/budget': 'Budget',
  '/logs': 'Logs',
  '/workers': 'Workers',
  '/jobs': 'Jobs',
};

interface ShellProps {
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  children: React.ReactNode;
}

export function Shell({ wsStatus, children }: ShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const location = useLocation();
  const title = titles[location.pathname] ?? 'ScalyClaw';

  function handleChatClick() {
    setChatOpen(true);
    setChatUnread(0);
  }

  const handleChatClose = useCallback(() => setChatOpen(false), []);
  const handleUnread = useCallback(() => setChatUnread((n) => n + 1), []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 h-full">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          wsStatus={wsStatus}
          onMenuClick={() => setSidebarOpen(true)}
          onChatClick={handleChatClick}
          chatUnread={chatUnread}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <ChatOverlay open={chatOpen} onClose={handleChatClose} onUnread={handleUnread} />
    </div>
  );
}
