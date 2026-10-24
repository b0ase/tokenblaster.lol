'use client';
/**
 * TBX primitives: a single consistent icon set (1.75 stroke, 24 grid), a HUD counter that ticks smoothly without
 * re-rendering React, and a probe for optional art (renders that may not exist yet).
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import './ui.css';

const P: Record<string, ReactNode> = {
  coin: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 010 3.6h-3a1.8 1.8 0 000 3.6h4.2" /></>),
  bolt: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  crosshair: (<><circle cx="12" cy="12" r="7" /><path d="M12 2v6M12 16v6M2 12h6M16 12h6" /></>),
  bullet: <path d="M8 21V10c0-3 1.5-6 4-8 2.5 2 4 5 4 8v11zM8 17h8" />,
  chain: (<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1" /></>),
  share: (<><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></>),
  trophy: <path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 14v4M8 21h8M10 18h4" />,
  skull: (<><path d="M5 12a7 7 0 1114 0c0 2-1 3-2 4v3H7v-3c-1-1-2-2-2-4z" /><circle cx="9.5" cy="12" r="1.3" /><circle cx="14.5" cy="12" r="1.3" /><path d="M10 19v-2M14 19v-2" /></>),
  wave: <path d="M2 14c2-4 4-4 6 0s4 4 6 0 4-4 6 0M2 19c2-4 4-4 6 0s4 4 6 0 4-4 6 0M2 9c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />,
  chip: (<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>),
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  unlock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></>),
  stack: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5L12 22l9-4.5" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  play: <path d="M7 4l13 8-13 8z" />,
  loadout: <path d="M4 7h16M4 12h16M4 17h10" />,
  signal: <path d="M4 20v-4M9 20V12M14 20V8M19 20V3" />,
  eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  copy: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 012-2h10" /></>),
  refresh: <path d="M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5" />,
  target: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  flame: <path d="M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z" />,
};
export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      {P[name]}
    </svg>
  );
}

/**
 * A HUD number that ticks: eases toward `value` on the animation frame by writing straight to the DOM (no React
 * renders per frame, so 1,500 tx/s costs nothing), and flashes briefly when it moves.
 */
export function Ticker({ value, from, className, style, format = (n: number) => Math.round(n).toLocaleString('en-US'), ease = 0.22 }: { value: number; /** Start from here and count up to `value` on mount. */ from?: number; className?: string; style?: CSSProperties; format?: (n: number) => string; ease?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(from ?? value);
  const target = useRef(value);
  const raf = useRef(0);
  const flashT = useRef(0);
  const fmt = useRef(format);
  const [initial] = useState(() => format(from ?? value)); // later text is written straight to the DOM
  useEffect(() => {
    fmt.current = format;
  });
  useEffect(() => {
    target.current = value;
    const step = () => {
      raf.current = 0;
      const e = el.current;
      if (!e) return;
      const d = target.current - shown.current;
      shown.current = Math.abs(d) < 0.5 ? target.current : shown.current + d * ease;
      e.textContent = fmt.current(shown.current);
      if (shown.current !== target.current) raf.current = requestAnimationFrame(step);
    };
    if (!raf.current) raf.current = requestAnimationFrame(step);
    const e = el.current;
    if (e && Math.abs(value - shown.current) >= 1) {
      const now = performance.now();
      if (now - flashT.current > 300) {
        flashT.current = now;
        e.classList.remove('tbx-ticked');
        void e.offsetWidth;
        e.classList.add('tbx-ticked');
      }
    }
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [value, ease]);
  return (
    <span ref={el} className={`tbx-num ${className ?? ''}`} style={style}>
      {initial}
    </span>
  );
}

const probed = new Map<string, boolean>();
const subs = new Set<() => void>();
let version = 0;
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
function probe(src: string) {
  if (probed.has(src)) return;
  probed.set(src, false);
  const im = new Image();
  im.onload = () => {
    probed.set(src, true);
    version++;
    subs.forEach((f) => f());
  };
  im.src = src;
}
/** Which of these image paths exist (probed once each). Lets art slots be listed before the art is made. */
export function useExisting(srcs: string[]): Set<string> {
  const key = srcs.join('|');
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    for (const s of key.split('|').filter(Boolean)) probe(s);
  }, [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Set(key.split('|').filter((s) => probed.get(s))), [key, v]);
}

/**
 * A true modal for every blocking prompt (owner, 24 Oct 2026: prompts must be unmissable): a focused overlay that
 * blocks the page, one clear primary action, keyboard (focus on the action, Escape = secondary/close) and
 * screen-reader friendly (role="alertdialog", labelled and described).
 */
export function Modal(p: {
  title: string;
  children?: ReactNode;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
  tone?: 'warn' | 'wait' | 'bad';
  pulse?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const id = `tbx-m-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && p.onSecondary) p.onSecondary();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  const colour = p.tone === 'bad' ? 'var(--tbx-red)' : p.tone === 'wait' ? 'var(--tbx-teal)' : 'var(--tbx-amber)';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} data-fs-skip>
      <div className="tbx-glass w-full max-w-md rounded-2xl border-2 p-6 text-center shadow-2xl" style={{ borderColor: colour }}>
        <p id={`${id}-t`} className="tbx-display text-[clamp(22px,4vw,30px)]" style={{ color: colour }}>
          {p.title}
        </p>
        <div id={`${id}-d`} className="mt-3 text-base text-[var(--tbx-text)]">
          {p.children}
        </div>
        <div className="mt-5 flex flex-col items-center gap-2">
          {p.action && (
            <button ref={btn} type="button" onClick={p.onAction} className="tbx-btn tbx-btn-red !min-h-[56px] w-full !text-lg" style={p.pulse ? { animation: 'tbx-breathe 1s ease-in-out infinite' } : undefined}>
              {p.action}
            </button>
          )}
          {p.secondary && (
            <button ref={p.action ? undefined : btn} type="button" onClick={p.onSecondary} className="tbx-btn w-full">
              {p.secondary}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Seconds since `since` (ms epoch), ticking once a second; 0 when null. */
export function useWaitSecs(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since == null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}
