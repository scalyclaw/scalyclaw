import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { wsClient } from '@/lib/ws';
import {
  getJobs,
  getJobCounts,
  getStatus,
  getBudget,
  getChannels,
  listMemory,
  getUsage,
} from '@/lib/api';
import { GameScene, STATION_MAP, type Phase } from '@/components/activity/GameScene';
import { ActivityFeed, type ActivityEvent } from '@/components/activity/ActivityFeed';
import { QueueLanes } from '@/components/activity/QueueLanes';
import { HudStats } from '@/components/activity/HudStats';

// ── Queue colors / labels ──

const Q_COLORS: Record<string, string> = {
  'scalyclaw-messages': '#10b981',
  'scalyclaw-tools': '#3b82f6',
  'scalyclaw-agents': '#8b5cf6',
  'scalyclaw-internal': '#f59e0b',
};
const Q_LABELS: Record<string, string> = {
  'scalyclaw-messages': 'Messages',
  'scalyclaw-tools': 'Tools',
  'scalyclaw-agents': 'Agents',
  'scalyclaw-internal': 'Internal',
};

// ── Helpers ──

function jobEventType(
  name: string,
): ActivityEvent['type'] {
  if (name.includes('message') || name === 'command') return 'message';
  if (name.includes('agent')) return 'agent';
  if (name.includes('skill')) return 'skill';
  if (name.includes('tool') || name.includes('code') || name.includes('command')) return 'tool';
  if (name.includes('memory')) return 'memory';
  if (name.includes('proactive')) return 'proactive';
  return 'tool';
}

let eid = 0;
function mkEvent(type: ActivityEvent['type'], description: string): ActivityEvent {
  return { id: String(++eid), time: new Date(), type, description };
}

// ── Visit queue types ──

interface Visit {
  station: string;
  workMs: number; // -1 = until explicitly finished
  label: string;
  carry?: string | null;
  priority?: boolean;
}

type JobRec = Record<string, unknown>;

// ── Page ──

export default function Activity() {
  // Data
  const [activeJobs, setActiveJobs] = useState<JobRec[]>([]);
  const [queueCounts, setQueueCounts] = useState<Record<string, Record<string, number>>>({});
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [budgetData, setBudgetData] = useState<{ currentMonthCost: number } | null>(null);
  const [channelData, setChannelData] = useState<JobRec[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [wsStatus, setWsStatus] = useState(wsClient.status);

  // Scene state
  const [target, setTarget] = useState('home');
  const [phase, setPhase] = useState<Phase>('idle');
  const [speech, setSpeech] = useState('');
  const [carrying, setCarrying] = useState<string | null>(null);
  const [sleeping, setSleeping] = useState(false);

  // Refs (stable across renders for callback safety)
  const prevJobIds = useRef(new Set<string>());
  const prevJobMap = useRef(new Map<string, string>());
  const lastActivity = useRef(Date.now());
  const mounted = useRef(true);

  // Visit queue refs
  const queueRef = useRef<Visit[]>([]);
  const currentVisitRef = useRef<Visit | null>(null);
  const currentStationRef = useRef('home');
  const workTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const activeMessageRef = useRef(false);
  const busyRef = useRef(false); // true when walking or doing timed work
  const phaseRef = useRef<Phase>('idle');
  const sleepingRef = useRef(false);
  const idleWanderRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Activity event helper ──

  const addEvent = useCallback((type: ActivityEvent['type'], desc: string) => {
    setEvents((prev) => [...prev.slice(-49), mkEvent(type, desc)]);
    lastActivity.current = Date.now();
    if (sleepingRef.current) {
      sleepingRef.current = false;
      setSleeping(false);
    }
  }, []);

  // ── Visit queue processing ──

  const setPhaseAndRef = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const processQueue = useCallback(() => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      // Nothing to do - go idle
      currentVisitRef.current = null;
      if (currentStationRef.current !== 'home') {
        // Walk home
        busyRef.current = true;
        setPhaseAndRef('walking');
        setSpeech('');
        setCarrying(null);
        setTarget('home');
      } else {
        setPhaseAndRef('idle');
        setSpeech('');
        setCarrying(null);
      }
      return;
    }

    currentVisitRef.current = next;
    setCarrying(next.carry ?? null);

    if (next.station === currentStationRef.current) {
      // Already here - start work immediately
      startWork(next);
    } else {
      // Walk there
      busyRef.current = true;
      setPhaseAndRef('walking');
      setSpeech(next.label);
      setTarget(next.station);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWork = useCallback((visit: Visit) => {
    currentStationRef.current = visit.station;
    setPhaseAndRef('working');
    setSpeech(visit.label);
    busyRef.current = true;

    if (visit.workMs > 0) {
      workTimerRef.current = setTimeout(() => {
        busyRef.current = false;
        processQueue();
      }, visit.workMs);
    }
    // workMs === -1 means "until job completes" — cleared by handleCompletedJob
    // workMs === 0 means instant — move on
    if (visit.workMs === 0) {
      busyRef.current = false;
      processQueue();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by GameScene when walk animation finishes
  const handleWalkDone = useCallback(() => {
    const visit = currentVisitRef.current;
    if (!visit) {
      // Walked home with no pending visit
      currentStationRef.current = 'home';
      busyRef.current = false;
      setPhaseAndRef('idle');
      setSpeech('');
      setCarrying(null);
      return;
    }
    currentStationRef.current = visit.station;
    startWork(visit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enqueue = useCallback((visits: Visit[]) => {
    // Priority visits clear non-priority pending items
    if (visits.some((v) => v.priority)) {
      queueRef.current = queueRef.current.filter((v) => v.priority);
    }
    queueRef.current.push(...visits);
    if (!busyRef.current) processQueue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Job event handlers ──

  const handleNewJob = useCallback((name: string) => {
    if (name.includes('message') || name === 'command') {
      activeMessageRef.current = true;
      enqueue([
        { station: 'channels', workMs: 800, label: 'Picking up message...', carry: null, priority: true },
        { station: 'models', workMs: -1, label: 'Thinking...', carry: 'envelope', priority: true },
      ]);
    } else if (name.includes('tool') || name.includes('code') || name.includes('command') || name.includes('skill')) {
      enqueue([
        { station: 'skills', workMs: -1, label: `Using ${name}...`, carry: 'scroll', priority: true },
      ]);
    } else if (name.includes('agent')) {
      enqueue([
        { station: 'agents', workMs: -1, label: `Delegating: ${name}...`, carry: null, priority: true },
      ]);
    } else if (name.includes('memory')) {
      enqueue([
        { station: 'memory', workMs: -1, label: 'Searching memory...', carry: 'orb', priority: true },
      ]);
    } else if (name.includes('vault')) {
      enqueue([
        { station: 'vault', workMs: -1, label: 'Accessing vault...', carry: 'key', priority: true },
      ]);
    } else if (name.includes('proactive')) {
      enqueue([
        { station: 'models', workMs: -1, label: 'Proactive check...', carry: null, priority: false },
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCompletedJob = useCallback((name: string) => {
    // Clear any -1 work timers (indefinite work stations)
    clearTimeout(workTimerRef.current);

    if (name.includes('message') || name === 'command') {
      activeMessageRef.current = false;
      // Deliver response back to channels then go home
      busyRef.current = false;
      enqueue([
        { station: 'channels', workMs: 600, label: 'Delivering response...', carry: 'envelope', priority: true },
        { station: 'home', workMs: 0, label: '', carry: null, priority: true },
      ]);
    } else if (name.includes('tool') || name.includes('code') || name.includes('skill')) {
      busyRef.current = false;
      if (activeMessageRef.current) {
        // Return to models to continue thinking
        enqueue([
          { station: 'models', workMs: -1, label: 'Thinking...', carry: 'scroll', priority: true },
        ]);
      } else {
        enqueue([
          { station: 'home', workMs: 0, label: '', carry: null, priority: false },
        ]);
      }
    } else if (name.includes('agent')) {
      busyRef.current = false;
      if (activeMessageRef.current) {
        enqueue([
          { station: 'models', workMs: -1, label: 'Thinking...', carry: null, priority: true },
        ]);
      } else {
        enqueue([
          { station: 'home', workMs: 0, label: '', carry: null, priority: false },
        ]);
      }
    } else {
      // Memory, vault, proactive, etc.
      busyRef.current = false;
      if (activeMessageRef.current) {
        enqueue([
          { station: 'models', workMs: -1, label: 'Thinking...', carry: null, priority: true },
        ]);
      } else {
        enqueue([
          { station: 'home', workMs: 0, label: '', carry: null, priority: false },
        ]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Idle wandering ──

  useEffect(() => {
    const scheduleWander = () => {
      idleWanderRef.current = setTimeout(() => {
        if (phaseRef.current === 'idle' && !busyRef.current && !sleepingRef.current) {
          const stationIds = Object.keys(STATION_MAP).filter((s) => s !== currentStationRef.current);
          const pick = stationIds[Math.floor(Math.random() * stationIds.length)];
          enqueue([
            { station: pick, workMs: 1000 + Math.random() * 2000, label: `Inspecting ${pick}...`, carry: null, priority: false },
          ]);
        }
        scheduleWander();
      }, 8000 + Math.random() * 12000);
    };
    scheduleWander();
    return () => clearTimeout(idleWanderRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket ──

  useEffect(() => {
    const u1 = wsClient.onStatus(setWsStatus);
    const u2 = wsClient.subscribe((text) =>
      addEvent('response', text.length > 60 ? text.slice(0, 57) + '...' : text),
    );
    const u3 = wsClient.onTyping((a) => {
      if (a) addEvent('thinking', 'Thinking...');
    });
    return () => { u1(); u2(); u3(); };
  }, [addEvent]);

  // ── Poll jobs 3s ──

  useEffect(() => {
    mounted.current = true;
    const poll = async () => {
      try {
        const [jr, cr] = await Promise.all([getJobs('active'), getJobCounts()]);
        if (!mounted.current) return;
        const jobs = jr.jobs;
        const curIds = new Set(jobs.map((j) => String(j.id)));
        const curMap = new Map(jobs.map((j) => [String(j.id), String(j.name ?? '')]));

        // New jobs
        for (const j of jobs) {
          const id = String(j.id);
          if (!prevJobIds.current.has(id)) {
            const name = String(j.name ?? '');
            addEvent(jobEventType(name), `Started: ${name}`);
            handleNewJob(name);
          }
        }

        // Completed jobs
        for (const id of prevJobIds.current) {
          if (!curIds.has(id)) {
            const name = prevJobMap.current.get(id) ?? 'job';
            addEvent('completed', `Completed: ${name}`);
            handleCompletedJob(name);
          }
        }

        prevJobIds.current = curIds;
        prevJobMap.current = curMap;
        setActiveJobs(jobs);
        setQueueCounts(cr.counts);
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { mounted.current = false; clearInterval(iv); };
  }, [addEvent, handleNewJob, handleCompletedJob]);

  // ── Poll status 5s ──

  useEffect(() => {
    const poll = async () => {
      try { setStatusData(await getStatus()); } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  // ── Poll budget + channels 15s ──

  useEffect(() => {
    const poll = async () => {
      try {
        const [b, c] = await Promise.all([getBudget(), getChannels()]);
        setBudgetData(b);
        setChannelData(c.channels);
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  // ── Poll memory + usage 30s ──

  useEffect(() => {
    const poll = async () => {
      try {
        const [m, u] = await Promise.all([listMemory(), getUsage()]);
        setMemoryCount(m.results?.length ?? 0);
        setTokenCount((u.totalInputTokens ?? 0) + (u.totalOutputTokens ?? 0));
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, []);

  // ── Sleep detection ──

  useEffect(() => {
    const iv = setInterval(() => {
      if (activeJobs.length === 0 && !busyRef.current && Date.now() - lastActivity.current > 60_000) {
        sleepingRef.current = true;
        setSleeping(true);
        setPhaseAndRef('sleeping');
        setSpeech('');
        setCarrying(null);
        // Clear wander queue
        queueRef.current = [];
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [activeJobs.length, setPhaseAndRef]);

  // ── Derived values ──

  const effectivePhase = sleeping ? 'sleeping' : phase;

  const notifications = useMemo(() => {
    const n: Record<string, number> = {};
    const mc = queueCounts['scalyclaw-messages'] ?? {};
    n.channels = mc.waiting ?? 0;
    const tc = queueCounts['scalyclaw-tools'] ?? {};
    n.skills = (tc.waiting ?? 0) + (tc.active ?? 0);
    const ac = queueCounts['scalyclaw-agents'] ?? {};
    n.agents = (ac.waiting ?? 0) + (ac.active ?? 0);
    const ic = queueCounts['scalyclaw-internal'] ?? {};
    n.memory = ic.waiting ?? 0;
    return n;
  }, [queueCounts]);

  const lanes = ['scalyclaw-messages', 'scalyclaw-tools', 'scalyclaw-agents', 'scalyclaw-internal'].map(
    (name) => {
      const c = queueCounts[name] ?? {};
      return {
        name,
        label: Q_LABELS[name],
        color: Q_COLORS[name],
        active: (c.active ?? 0) + (c.prioritized ?? 0),
        waiting: c.waiting ?? 0,
      };
    },
  );

  const uptime =
    statusData && typeof statusData.uptime === 'number' ? (statusData.uptime as number) : 0;

  const stateLabel = sleeping
    ? 'Sleeping'
    : phase === 'working'
      ? speech.split('...')[0] || 'Working'
      : phase === 'walking'
        ? 'Moving'
        : 'Idle';

  const stateColor = sleeping
    ? 'text-zinc-600'
    : phase === 'working'
      ? 'text-emerald-400'
      : phase === 'walking'
        ? 'text-cyan-400'
        : 'text-zinc-500';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#030303]">
      {/* Header bar */}
      <div className="relative z-20 flex items-center gap-3 px-5 py-2">
        <span
          className={`h-2 w-2 rounded-full ${
            wsStatus === 'connected'
              ? 'bg-emerald-500'
              : wsStatus === 'connecting'
                ? 'animate-pulse bg-amber-500'
                : 'bg-zinc-600'
          }`}
        />
        <span className={`text-xs font-medium ${stateColor}`}>{stateLabel}</span>
      </div>

      {/* Main: scene left, feed right */}
      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="flex-1">
          <GameScene
            target={target}
            phase={effectivePhase}
            speech={sleeping ? '' : speech}
            carrying={sleeping ? null : carrying}
            notifications={notifications}
            channels={channelData.map((ch) => ({
              id: String(ch.id ?? ch.type ?? ''),
              enabled: ch.enabled !== false,
            }))}
            onWalkDone={handleWalkDone}
          />
        </div>
        <div className="w-[34%] min-w-[260px] py-1 pr-1">
          <ActivityFeed events={events} />
        </div>
      </div>

      {/* Queue lanes */}
      <QueueLanes lanes={lanes} />

      {/* HUD */}
      <HudStats
        tokens={tokenCount}
        cost={budgetData?.currentMonthCost ?? 0}
        memories={memoryCount}
        uptime={uptime}
        channels={channelData.filter((c) => c.enabled !== false).length}
      />
    </div>
  );
}
