import { useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'scalyclaw-theme';

function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Tiny pub/sub so useSyncExternalStore re-renders all consumers
let listeners: (() => void)[] = [];
let snapshot: Theme = getTheme();

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}

function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  snapshot = theme;
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => snapshot);
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme]);
  return { theme, setTheme, toggle } as const;
}
