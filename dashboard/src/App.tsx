import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router';
import { Toaster } from 'sonner';
import { Shell } from '@/components/layout/Shell';
import { wsClient } from '@/lib/ws';
import { setToken } from '@/lib/api';

const Overview = lazy(() => import('@/pages/Overview'));
const Mind = lazy(() => import('@/pages/Mind'));

const Channels = lazy(() => import('@/pages/Channels'));
const Models = lazy(() => import('@/pages/Models'));
const Skills = lazy(() => import('@/pages/Skills'));
const Agents = lazy(() => import('@/pages/Agents'));
const Memory = lazy(() => import('@/pages/Memory'));
const Vault = lazy(() => import('@/pages/Vault'));
const Mcp = lazy(() => import('@/pages/Mcp'));
const Scheduler = lazy(() => import('@/pages/Scheduler'));
const Usage = lazy(() => import('@/pages/Usage'));
const Logs = lazy(() => import('@/pages/Logs'));
const Security = lazy(() => import('@/pages/Security'));
const Workers = lazy(() => import('@/pages/Workers'));
const Jobs = lazy(() => import('@/pages/Jobs'));
const Engagement = lazy(() => import('@/pages/Engagement'));

function TokenDialog({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">Authentication Required</h2>
        <p className="mb-4 text-sm text-muted-foreground">Enter your API token to continue.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value && onSubmit(value)}
          placeholder="Token"
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <button
          onClick={() => value && onSubmit(value)}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Connect
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  // Read ?token= from URL, store in localStorage, clean URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Connect WS on mount
  useEffect(() => {
    wsClient.connect();
  }, []);

  // Track WS status
  useEffect(() => {
    return wsClient.onStatus(setWsStatus);
  }, []);

  // Global 401 handler via event
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === 401) setShowTokenDialog(true);
    };
    window.addEventListener('api-401', handler);
    return () => window.removeEventListener('api-401', handler);
  }, []);

  const handleToken = (token: string) => {
    setToken(token);
    setShowTokenDialog(false);
    wsClient.disconnect();
    wsClient.connect();
    window.location.reload();
  };

  const loading = (
    <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>
  );

  return (
    <>
      <Toaster theme="dark" position="top-right" />
      {showTokenDialog && <TokenDialog onSubmit={handleToken} />}
      <Shell wsStatus={wsStatus}>
        <Suspense fallback={loading}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="mind" element={<Mind />} />

            <Route path="channels" element={<Channels />} />
            <Route path="models" element={<Models />} />
            <Route path="skills" element={<Skills />} />
            <Route path="agents" element={<Agents />} />
            <Route path="memory" element={<Memory />} />
            <Route path="vault" element={<Vault />} />
            <Route path="mcp" element={<Mcp />} />
            <Route path="scheduler" element={<Scheduler />} />
            <Route path="engagement" element={<Engagement />} />
            <Route path="security" element={<Security />} />
            <Route path="usage" element={<Usage />} />
            <Route path="logs" element={<Logs />} />
            <Route path="workers" element={<Workers />} />
            <Route path="jobs" element={<Jobs />} />
          </Routes>
        </Suspense>
      </Shell>
    </>
  );
}
