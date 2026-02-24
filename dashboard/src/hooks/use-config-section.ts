import { useState, useEffect, useCallback, useRef } from 'react';
import { getConfig, updateConfig } from '@/lib/api';
import { toast } from 'sonner';

interface UseConfigSectionResult<T> {
  section: T | null;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  update: (fn: (draft: T) => void) => void;
  save: () => Promise<void>;
  reset: () => void;
}

export function useConfigSection<T>(key: string): UseConfigSectionResult<T> {
  const [fullConfig, setFullConfig] = useState<Record<string, unknown> | null>(null);
  const [section, setSection] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const sectionRef = useRef<T | null>(null);
  sectionRef.current = section;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config = await getConfig();
      if (mountedRef.current) {
        setFullConfig(config);
        const s = structuredClone(config[key]) as T;
        setSection(s);
        sectionRef.current = s;
        setDirty(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(`Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  function update(fn: (draft: T) => void) {
    setSection((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      sectionRef.current = next;
      return next;
    });
    setDirty(true);
  }

  async function save() {
    const current = sectionRef.current;
    if (!current) return;
    setSaving(true);
    try {
      await updateConfig({ [key]: current });
      setDirty(false);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (fullConfig) {
      setSection(structuredClone(fullConfig[key]) as T);
      setDirty(false);
    }
  }

  return { section, loading, dirty, saving, update, save, reset };
}
