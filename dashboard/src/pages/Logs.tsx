import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getLogs, getLogContent } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LEVELS = ['all', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

type SourceType = 'node' | 'workers';

const TIME_SLOTS = [
  { label: '1m', minutes: 1 },
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: 'Range', minutes: 0 },
] as const;

type TimeSlot = (typeof TIME_SLOTS)[number]['label'];

/** How many tail lines to request for each time window */
function linesForSlot(slot: TimeSlot): number {
  switch (slot) {
    case '1m': return 200;
    case '5m': return 500;
    case '10m': return 1000;
    case '30m': return 2000;
    case '1h': return 3000;
    case 'Range': return 5000;
  }
}

interface ProcessEntry {
  label: string;
  file: string;
  type: SourceType;
}

/** Parse HH:mm:ss.SSS from the start of a log line (text format) */
function parseLineTimestamp(line: string): Date | null {
  // Text format: "HH:mm:ss.SSS LEVEL message..."
  const timeMatch = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s/);
  if (timeMatch) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3]), Number(timeMatch[4]));
    // If parsed time is in the future (e.g., logs from yesterday's 23:xx viewed at 00:xx), roll back a day
    if (d > now) d.setDate(d.getDate() - 1);
    return d;
  }
  // JSON format: {"timestamp":"2024-12-24T10:30:45.123Z",...}
  const jsonMatch = line.match(/"timestamp"\s*:\s*"([^"]+)"/);
  if (jsonMatch) {
    const d = new Date(jsonMatch[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseLevel(line: string): string | null {
  const lower = line.toLowerCase();
  if (/\berror\b/.test(lower)) return 'error';
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\binfo\b/.test(lower)) return 'info';
  if (/\bdebug\b/.test(lower)) return 'debug';
  return null;
}

function parseProcesses(files: Array<{ name: string; size: number; modified: string | null; remote?: boolean }>): ProcessEntry[] {
  return files
    .map((f) => {
      const workerMatch = f.name.match(/^worker-(.+)\.log$/);
      if (workerMatch) {
        return { label: `Worker ${workerMatch[1]}`, file: f.name, type: 'workers' as SourceType };
      }
      if (f.name === 'scalyclaw.log') {
        return { label: 'ScalyClaw', file: f.name, type: 'node' as SourceType };
      }
      return null;
    })
    .filter((p): p is ProcessEntry => p !== null);
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Logs() {
  const { data, error, loading, refetch } = useApi(getLogs);
  const [sourceType, setSourceType] = useState<SourceType>('node');
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [levelFilter, setLevelFilter] = useState<Level>('all');
  const [search, setSearch] = useState('');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('5m');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const contentEndRef = useRef<HTMLDivElement>(null);

  const allFiles = data?.files ?? [];
  const processes = useMemo(() => parseProcesses(allFiles), [allFiles]);
  const typeProcesses = useMemo(() => processes.filter((p) => p.type === sourceType), [processes, sourceType]);

  const loadProcess = useCallback(async (file: string, slot?: TimeSlot) => {
    setSelectedProcess(file);
    setLoadingContent(true);
    setContent(null);
    try {
      const res = await getLogContent(file, linesForSlot(slot ?? timeSlot));
      setContent(res.content);
    } catch (err) {
      toast.error('Failed to load logs', {
        description: err instanceof Error ? err.message : String(err),
      });
      setContent(null);
    } finally {
      setLoadingContent(false);
    }
  }, [timeSlot]);

  // Auto-select first process when source type changes or on load
  useEffect(() => {
    if (typeProcesses.length > 0) {
      const current = typeProcesses.find((p) => p.file === selectedProcess);
      if (!current) {
        loadProcess(typeProcesses[0].file);
      }
    } else {
      setSelectedProcess(null);
      setContent(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeProcesses]);

  useEffect(() => {
    if (content !== null && contentEndRef.current) {
      contentEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [content, levelFilter, search, timeSlot]);

  // Re-fetch when time slot changes (to get more/fewer lines)
  function handleTimeSlotChange(slot: TimeSlot) {
    setTimeSlot(slot);
    if (slot === 'Range') {
      // Initialize range to last hour
      const now = new Date();
      const from = new Date(now.getTime() - 60 * 60 * 1000);
      setRangeFrom(toLocalDatetime(from));
      setRangeTo(toLocalDatetime(now));
    }
    if (selectedProcess) {
      loadProcess(selectedProcess, slot);
    }
  }

  const filteredLines = useMemo(() => {
    if (content === null) return [];
    const lines = content.split('\n');
    const searchLower = search.toLowerCase();

    // Compute the time cutoff
    let cutoffStart: Date | null = null;
    let cutoffEnd: Date | null = null;

    if (timeSlot === 'Range') {
      if (rangeFrom) cutoffStart = new Date(rangeFrom);
      if (rangeTo) cutoffEnd = new Date(rangeTo);
    } else {
      const slotDef = TIME_SLOTS.find((s) => s.label === timeSlot);
      if (slotDef && slotDef.minutes > 0) {
        cutoffStart = new Date(Date.now() - slotDef.minutes * 60 * 1000);
      }
    }

    let lastTimestamp: Date | null = null;

    return lines.filter((line) => {
      // Level filter
      if (levelFilter !== 'all' && parseLevel(line) !== levelFilter) return false;
      // Search filter
      if (searchLower && !line.toLowerCase().includes(searchLower)) return false;

      // Time filter
      if (cutoffStart || cutoffEnd) {
        const ts = parseLineTimestamp(line);
        if (ts) lastTimestamp = ts;
        const effectiveTs = ts ?? lastTimestamp;
        if (effectiveTs) {
          if (cutoffStart && effectiveTs < cutoffStart) return false;
          if (cutoffEnd && effectiveTs > cutoffEnd) return false;
        }
      }

      return true;
    });
  }, [content, levelFilter, search, timeSlot, rangeFrom, rangeTo]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refetch();
      if (selectedProcess) {
        const res = await getLogContent(selectedProcess, linesForSlot(timeSlot));
        setContent(res.content);
      }
    } catch {
      toast.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading logs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Logs</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Source type + process selector row */}
      <div className="flex items-center gap-3">
        <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
          <TabsList>
            <TabsTrigger value="node">Node</TabsTrigger>
            <TabsTrigger value="workers">Workers</TabsTrigger>
          </TabsList>
        </Tabs>

        {typeProcesses.length > 1 && (
          <Select
            value={selectedProcess ?? ''}
            onValueChange={(v) => loadProcess(v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select process..." />
            </SelectTrigger>
            <SelectContent>
              {typeProcesses.map((p) => (
                <SelectItem key={p.file} value={p.file}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Time slot + Level filter + search row */}
      {selectedProcess && (
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={timeSlot} onValueChange={(v) => handleTimeSlotChange(v as TimeSlot)}>
            <TabsList>
              {TIME_SLOTS.map((slot) => (
                <TabsTrigger key={slot.label} value={slot.label}>
                  {slot.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {timeSlot === 'Range' && (
            <>
              <Input
                type="datetime-local"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="w-48"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="datetime-local"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="w-48"
              />
            </>
          )}

          <Tabs value={levelFilter} onValueChange={(v) => setLevelFilter(v as Level)}>
            <TabsList>
              {LEVELS.map((level) => (
                <TabsTrigger key={level} value={level} className="capitalize">
                  {level}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      {typeProcesses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {sourceType === 'node' ? 'node' : 'worker'} logs found.
        </p>
      ) : selectedProcess && (
        <div className="flex min-h-0 flex-1 flex-col rounded-md border">
          {loadingContent ? (
            <div className="p-4 text-sm text-muted-foreground">Loading logs...</div>
          ) : content !== null ? (
            filteredLines.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No matching log lines.</div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <pre className="whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed">
                  {filteredLines.join('\n')}
                </pre>
                <div ref={contentEndRef} />
              </div>
            )
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Failed to load logs.</div>
          )}
        </div>
      )}
    </div>
  );
}
