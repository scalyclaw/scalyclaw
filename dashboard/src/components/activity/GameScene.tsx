import { useState, useEffect, useMemo, useRef } from 'react';

// ===================== STATIONS =====================

export interface StationDef {
  id: string;
  x: number;
  label: string;
  color: string;
}

export const STATIONS: StationDef[] = [
  { id: 'channels', x: 7, label: 'Channels', color: '#3b82f6' },
  { id: 'vault', x: 22, label: 'Vault', color: '#f59e0b' },
  { id: 'models', x: 37, label: 'Models', color: '#06b6d4' },
  { id: 'home', x: 50, label: 'Home', color: '#10b981' },
  { id: 'memory', x: 63, label: 'Memory', color: '#ec4899' },
  { id: 'skills', x: 78, label: 'Skills', color: '#8b5cf6' },
  { id: 'agents', x: 93, label: 'Agents', color: '#f97316' },
];

export const STATION_MAP: Record<string, StationDef> = Object.fromEntries(
  STATIONS.map((s) => [s.id, s]),
);

const GROUND_BOTTOM = 26;

// ===================== DRAGON SPRITE =====================

const DRAGON = [
  '................',
  '......a..a......',
  '.....aea.aea....',
  '....eeeeeeee....',
  '...eeeeeeeeee...',
  '...ewpeeeepwe...',
  '...eeeeeeeeee...',
  '....eellllee....',
  '.....elllle.....',
  '...deelllleedd..',
  '..ddeelllleedd..',
  '.dddeelllleeddd.',
  '..ddeelllleedd..',
  '....eeeeeeee....',
  '...eee....eee...',
  '...ee......ee...',
];

const DC: Record<string, string> = {
  e: '#10b981', d: '#059669', l: '#34d399',
  w: '#ffffff', p: '#111827', a: '#f59e0b',
};

const PX = 6;

function DragonSprite({ flip, dim }: { flip: boolean; dim: boolean }) {
  return (
    <svg
      width={16 * PX}
      height={16 * PX}
      viewBox={`0 0 ${16 * PX} ${16 * PX}`}
      style={{
        transform: flip ? 'scaleX(-1)' : undefined,
        filter: dim ? 'brightness(0.35)' : undefined,
      }}
    >
      {DRAGON.map((row, y) =>
        [...row].map((ch, x) => {
          if (ch === '.') return null;
          return (
            <rect key={`${x}-${y}`} x={x * PX} y={y * PX} width={PX} height={PX}
              fill={DC[ch] ?? 'transparent'} rx={0.5} />
          );
        }),
      )}
    </svg>
  );
}

// ===================== STATION ICONS =====================

function StationIcon({ type, color, active }: { type: string; color: string; active: boolean }) {
  const o = active ? 1 : 0.5;
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" shapeRendering="crispEdges">
      {type === 'channels' && (<>
        <rect x="3" y="6" width="14" height="10" fill={color} opacity={o} rx="1" />
        <polygon points="3,7 10,13 17,7" fill="white" opacity={0.2} />
        <rect x="15" y="4" width="3" height="5" fill="#ef4444" opacity={o} rx="0.5" />
      </>)}
      {type === 'vault' && (<>
        <rect x="3" y="9" width="14" height="8" fill={color} opacity={o} rx="1" />
        <rect x="2" y="6" width="16" height="5" fill={color} opacity={o * 0.8} rx="1" />
        <rect x="8" y="11" width="4" height="3" fill="white" opacity={0.2} rx="0.5" />
      </>)}
      {type === 'models' && (<>
        <circle cx="10" cy="10" r="7" fill={color} opacity={o * 0.3} />
        <circle cx="10" cy="10" r="5" fill={color} opacity={o * 0.6} />
        <circle cx="10" cy="10" r="2.5" fill="white" opacity={0.2} />
      </>)}
      {type === 'home' && (<>
        <polygon points="10,2 2,10 18,10" fill={color} opacity={o} />
        <rect x="5" y="10" width="10" height="8" fill={color} opacity={o * 0.7} />
        <rect x="8" y="12" width="4" height="6" fill="white" opacity={0.08} />
      </>)}
      {type === 'memory' && (<>
        <polygon points="10,2 17,10 10,18 3,10" fill={color} opacity={o} />
        <polygon points="10,5 14,10 10,15 6,10" fill="white" opacity={0.15} />
      </>)}
      {type === 'skills' && (<>
        <rect x="2" y="11" width="16" height="6" fill={color} opacity={o} rx="1" />
        <rect x="4" y="9" width="12" height="3" fill={color} opacity={o * 0.7} />
        <rect x="7" y="3" width="2" height="7" fill={color} opacity={o * 0.6} />
        <rect x="5" y="3" width="6" height="2" fill={color} opacity={o * 0.5} />
      </>)}
      {type === 'agents' && (<>
        <circle cx="10" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.5" opacity={o} />
        <circle cx="10" cy="10" r="3" fill={color} opacity={o * 0.5} />
      </>)}
    </svg>
  );
}

// ===================== CARRIED ITEMS =====================

function CarriedItem({ item }: { item: string }) {
  return (
    <div className="absolute -top-4 left-1/2 z-20" style={{ animation: 'item-bob 1.2s ease-in-out infinite' }}>
      {item === 'envelope' && (
        <svg width="14" height="10" viewBox="0 0 14 10" shapeRendering="crispEdges">
          <rect width="14" height="10" fill="#3b82f6" rx="1" />
          <polygon points="0,0 7,5 14,0" fill="white" opacity="0.3" />
        </svg>
      )}
      {item === 'orb' && (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" fill="#ec4899" opacity="0.8" />
          <circle cx="4" cy="4" r="1.5" fill="white" opacity="0.3" />
        </svg>
      )}
      {item === 'scroll' && (
        <svg width="12" height="8" viewBox="0 0 12 8" shapeRendering="crispEdges">
          <rect x="1" y="0" width="10" height="8" fill="#8b5cf6" rx="2" />
          <rect x="3" y="2" width="6" height="1" fill="white" opacity="0.2" />
          <rect x="3" y="4.5" width="4" height="1" fill="white" opacity="0.15" />
        </svg>
      )}
      {item === 'key' && (
        <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges">
          <circle cx="4" cy="4" r="3" fill="#f59e0b" opacity="0.8" />
          <rect x="5" y="3" width="4" height="2" fill="#f59e0b" opacity="0.7" />
        </svg>
      )}
    </div>
  );
}

// ===================== MAIN SCENE =====================

export type Phase = 'idle' | 'walking' | 'working' | 'sleeping';

export interface GameSceneProps {
  target: string;
  phase: Phase;
  speech: string;
  carrying: string | null;
  notifications: Record<string, number>;
  channels: Array<{ id: string; enabled: boolean }>;
  onWalkDone: () => void;
}

export function GameScene({
  target, phase, speech, carrying, notifications, channels, onWalkDone,
}: GameSceneProps) {
  const [facing, setFacing] = useState<'left' | 'right'>('right');
  const prevTargetRef = useRef('home');
  const walkMsRef = useRef(0);
  const walkDoneRef = useRef(onWalkDone);
  walkDoneRef.current = onWalkDone;

  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const targetX = STATION_MAP[target]?.x ?? STATION_MAP.home.x;

  // Stars, fireflies, grass
  const stars = useMemo(() => Array.from({ length: 55 }, () => ({
    x: Math.random() * 100, y: Math.random() * 62,
    s: Math.random() * 2 + 0.5, d: Math.random() * 6, t: 2 + Math.random() * 4,
  })), []);
  const fireflies = useMemo(() => Array.from({ length: 7 }, () => ({
    x: 8 + Math.random() * 84, y: 12 + Math.random() * 48,
    d: Math.random() * 5, t: 3 + Math.random() * 3,
  })), []);
  const grass = useMemo(() => Array.from({ length: 35 }, () => ({
    x: Math.random() * 100, h: 3 + Math.random() * 6,
  })), []);

  // Walk detection & completion
  useEffect(() => {
    if (target === prevTargetRef.current) return;
    const prevX = STATION_MAP[prevTargetRef.current]?.x ?? 50;
    const newX = STATION_MAP[target]?.x ?? 50;
    prevTargetRef.current = target;

    const dist = Math.abs(newX - prevX);
    if (dist < 1) { walkDoneRef.current(); return; }

    const ms = Math.max(600, dist * 18);
    walkMsRef.current = ms;
    setFacing(newX > prevX ? 'right' : 'left');

    const timer = setTimeout(() => walkDoneRef.current(), ms);
    return () => clearTimeout(timer);
  }, [target]);

  // Idle facing flips
  useEffect(() => {
    if (phase !== 'idle') { clearTimeout(idleTimerRef.current); return; }
    const flip = () => {
      setFacing((f) => (f === 'left' ? 'right' : 'left'));
      idleTimerRef.current = setTimeout(flip, 5000 + Math.random() * 8000);
    };
    idleTimerRef.current = setTimeout(flip, 4000 + Math.random() * 6000);
    return () => clearTimeout(idleTimerRef.current);
  }, [phase]);

  const sleeping = phase === 'sleeping';
  const walking = phase === 'walking';
  const working = phase === 'working';

  const dragonAnim = walking
    ? 'animate-walk-bounce'
    : sleeping ? '' : working ? 'animate-breathe-fast' : 'animate-breathe';

  return (
    <div className="relative h-full w-full select-none overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #020806 0%, #030303 55%, #0a120a 100%)' }}>

      {/* Stars */}
      {stars.map((s, i) => (
        <div key={i} className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s,
            animation: `twinkle ${s.t}s ease-in-out infinite`, animationDelay: `${s.d}s` }} />
      ))}

      {/* Fireflies */}
      {!sleeping && fireflies.map((f, i) => (
        <div key={`ff${i}`} className="absolute h-1 w-1 rounded-full bg-emerald-400/40"
          style={{ left: `${f.x}%`, top: `${f.y}%`,
            animation: `firefly ${f.t}s ease-in-out infinite`, animationDelay: `${f.d}s` }} />
      ))}

      {/* Ground line */}
      <div className="absolute left-0 right-0 h-px"
        style={{ bottom: `${GROUND_BOTTOM}%`,
          background: 'linear-gradient(90deg, transparent 1%, #10b98125 15%, #10b98118 85%, transparent 99%)' }} />

      {/* Walkway */}
      <div className="absolute h-px"
        style={{ left: `${STATIONS[0].x - 1}%`, right: `${100 - STATIONS[STATIONS.length - 1].x - 1}%`,
          bottom: `${GROUND_BOTTOM - 0.5}%`,
          background: 'repeating-linear-gradient(90deg, #10b98112 0px, #10b98112 3px, transparent 3px, transparent 7px)' }} />

      {/* Ground fill */}
      <div className="absolute bottom-0 left-0 right-0"
        style={{ height: `${GROUND_BOTTOM}%`, background: 'linear-gradient(180deg, #080e08 0%, #050805 100%)' }} />

      {/* Grass */}
      {grass.map((g, i) => (
        <div key={`g${i}`} className="absolute"
          style={{ left: `${g.x}%`, bottom: `${GROUND_BOTTOM}%`, width: 0, height: 0,
            borderLeft: '2px solid transparent', borderRight: '2px solid transparent',
            borderBottom: `${g.h}px solid #10b98112` }} />
      ))}

      {/* Stations */}
      {STATIONS.map((s) => {
        const here = target === s.id && !walking;
        const note = notifications[s.id] ?? 0;
        return (
          <div key={s.id} className="absolute flex flex-col items-center"
            style={{ left: `${s.x}%`, bottom: `${GROUND_BOTTOM + 1}%`, transform: 'translateX(-50%)' }}>

            {note > 0 && (
              <div className="absolute -right-2 -top-2 z-30 flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold text-white"
                style={{ background: s.color }}>{note > 9 ? '9+' : note}</div>
            )}

            {here && working && (
              <div className="absolute -inset-3 rounded-xl"
                style={{ background: `radial-gradient(circle, ${s.color}30 0%, transparent 70%)`,
                  animation: 'station-glow 2s ease-in-out infinite' }} />
            )}

            <div className="flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-500"
              style={{
                borderColor: (here && working) ? `${s.color}80` : 'rgba(255,255,255,0.06)',
                background: (here && working) ? `${s.color}18` : 'rgba(255,255,255,0.02)',
                boxShadow: (here && working) ? `0 0 20px ${s.color}30, 0 0 6px ${s.color}15` : 'none',
              }}>
              <StationIcon type={s.id} color={s.color} active={here || note > 0} />
            </div>

            <span className="mt-1 text-[9px] font-medium transition-colors duration-500"
              style={{ color: (here && working) ? s.color : '#404040' }}>{s.label}</span>

            {s.id === 'channels' && channels.length > 0 && (
              <div className="mt-0.5 flex gap-0.5">
                {channels.slice(0, 8).map((ch, ci) => (
                  <div key={ci} className="h-1.5 w-1.5 rounded-full transition-colors"
                    style={{ background: ch.enabled ? '#3b82f6' : '#262626' }} title={ch.id} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ============ DRAGON ============ */}
      <div className="absolute z-10" style={{
        left: `${targetX}%`,
        bottom: `${GROUND_BOTTOM - 1}%`,
        transform: 'translateX(-50%)',
        transition: walking ? `left ${walkMsRef.current}ms ease-in-out` : 'none',
      }}>
        {/* Speech bubble */}
        {speech && !sleeping && (
          <div className="absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/80 px-2.5 py-1 text-[10px] font-medium text-emerald-300"
            style={{ animation: 'slide-in 0.25s ease-out' }}>
            {speech}
            <div className="absolute left-1/2 top-full -translate-x-1/2 border-l-[4px] border-r-[4px] border-t-[4px] border-l-transparent border-r-transparent border-t-black/80" />
          </div>
        )}

        {/* Carried item */}
        {carrying && !sleeping && <CarriedItem item={carrying} />}

        {/* Sleeping zzz */}
        {sleeping && (
          <div className="absolute -right-2 -top-8 z-20 flex flex-col items-start gap-0.5">
            {['z', 'z', 'Z'].map((ch, i) => (
              <span key={i} className="font-mono font-bold text-emerald-400/40"
                style={{ fontSize: 8 + i * 3, animation: 'float-up 2.5s ease-in-out infinite',
                  animationDelay: `${i * 0.5}s` }}>{ch}</span>
            ))}
          </div>
        )}

        {/* Working sparkles */}
        {working && !sleeping && (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="absolute h-1 w-1 rounded-full bg-emerald-300"
                style={{
                  left: `${15 + Math.cos(i * 1.26) * 55}%`, top: `${5 + Math.sin(i * 1.26) * 35}%`,
                  animation: 'sparkle 1s ease-in-out infinite', animationDelay: `${i * 0.2}s`,
                }} />
            ))}
          </>
        )}

        {/* Ground glow */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full blur-xl transition-opacity duration-1000"
          style={{ width: 80, height: 20, background: sleeping ? '#10b98108' : '#10b98118' }} />

        {/* Dragon sprite */}
        <div className={dragonAnim}>
          <DragonSprite flip={facing === 'left'} dim={sleeping} />
        </div>
      </div>

      {/* Sleep overlay */}
      {sleeping && <div className="pointer-events-none absolute inset-0 bg-black/30 transition-opacity duration-2000" />}
    </div>
  );
}
