'use client';
/**
 * Cinematic banners: WAVE N, GUN LOADED. LIVE ROUNDS, BOSS INCOMING. A queue shows them one after another so
 * two events never stack on top of each other. Copy comes from src/lib/gallery/story.ts (Dr Kweg Wong's lines
 * from KWEG). Pointer events are off; the gun keeps firing underneath.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BANNERS, KWEG, waveBrief } from '@/lib/gallery/story';
import { Icon } from '../coinop/ui';

export type BannerKind = { kind: 'loaded'; practice?: boolean } | { kind: 'wave'; n: number } | { kind: 'boss' };
type Item = BannerKind & { id: number; ms: number };

const MS = { loaded: 2400, wave: 3000, boss: 2400 } as const;

/** Queue banners; each one shows for its own time, then the next. */
export function useBanners() {
  const [cur, setCur] = useState<Item | null>(null);
  const queue = useRef<Item[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const n = useRef(0);
  const nextRef = useRef<() => void>(() => undefined);
  const next = useCallback(() => {
    timer.current = null;
    const it = queue.current.shift() ?? null;
    setCur(it);
    if (it) timer.current = setTimeout(() => nextRef.current(), it.ms);
  }, []);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  const push = useCallback(
    (b: BannerKind) => {
      queue.current.push({ ...b, id: ++n.current, ms: MS[b.kind] });
      if (!timer.current) next();
    },
    [next],
  );
  const clear = useCallback(() => {
    queue.current = [];
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCur(null);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { cur, push, clear };
}

export function BannerStage({ item }: { item: (BannerKind & { id: number; ms: number }) | null }) {
  if (!item) return null;
  const dur = { ['--dur' as string]: `${item.ms}ms` };
  const base = 'pointer-events-none absolute inset-x-0 top-[34%] z-20 sm:top-[22%] flex flex-col items-center px-4 text-center';
  if (item.kind === 'loaded') {
    return (
      <div key={item.id} className={base} role="status" style={dur}>
        <p className="tbx-banner-main tbx-display text-[clamp(44px,9vw,118px)]" style={{ textShadow: '0 0 50px rgba(63,216,232,.45), 0 6px 40px rgba(0,0,0,.8)' }}>
          {BANNERS.loaded.top}
        </p>
        <p className="tbx-banner-main tbx-display text-[clamp(44px,9vw,118px)] text-[var(--tbx-red)]" style={{ textShadow: '0 0 50px rgba(255,59,59,.7), 0 6px 40px rgba(0,0,0,.8)', animationDelay: '0.12s' }}>
          {item.practice ? 'PRACTICE ROUNDS' : BANNERS.loaded.bottom}
        </p>
        <span className="tbx-banner-line mt-3 h-[2px] w-[min(520px,70vw)] bg-gradient-to-r from-transparent via-[var(--tbx-red)] to-transparent" />
        <p className="tbx-banner-sub mt-3 text-[clamp(12px,1.4vw,17px)] font-semibold uppercase tracking-[0.28em] text-white/85">{item.practice ? 'Free play: nothing goes on chain.' : BANNERS.loaded.sub}</p>
      </div>
    );
  }
  if (item.kind === 'boss') {
    return (
      <div key={item.id} className={base} role="status" style={dur}>
        <div className="tbx-banner-sub flex items-center gap-2 text-[var(--tbx-red)]">
          <Icon name="skull" size={20} />
          <span className="text-xs font-bold uppercase tracking-[0.4em]">Warning</span>
          <Icon name="skull" size={20} />
        </div>
        <p className="tbx-banner-main tbx-display mt-1 text-[clamp(44px,9vw,118px)] text-[var(--tbx-red)]" style={{ textShadow: '0 0 60px rgba(255,59,59,.8), 0 6px 40px rgba(0,0,0,.9)' }}>
          {BANNERS.boss.top}
        </p>
        <span className="tbx-banner-line mt-2 h-[3px] w-[min(560px,76vw)] bg-gradient-to-r from-transparent via-[var(--tbx-red)] to-transparent" />
        <p className="tbx-banner-sub mt-3 text-[clamp(14px,1.8vw,22px)] font-bold uppercase tracking-[0.34em] text-white">{BANNERS.boss.sub}</p>
        <p className="tbx-banner-sub mt-2 hidden max-w-[560px] text-[clamp(12px,1.2vw,15px)] italic text-white/70 sm:block">“{KWEG.boss}” <span className="not-italic">· {KWEG.name}</span></p>
      </div>
    );
  }
  const w = waveBrief(item.n);
  return (
    <div key={item.id} className={base} role="status" style={dur}>
      <p className="tbx-banner-sub text-xs font-bold uppercase tracking-[0.42em] text-[var(--tbx-teal)]">{w.code}</p>
      <p className="tbx-banner-main tbx-display text-[clamp(56px,13vw,170px)]" style={{ textShadow: '0 0 60px rgba(63,216,232,.45), 0 8px 50px rgba(0,0,0,.85)' }}>
        WAVE <span className="text-[var(--tbx-red)]">{item.n}</span>
      </p>
      <span className="tbx-banner-line h-[2px] w-[min(520px,70vw)] bg-gradient-to-r from-transparent via-[var(--tbx-teal)] to-transparent" />
      <p className="tbx-banner-sub tbx-display mt-3 text-[clamp(20px,3vw,36px)]">{w.title}</p>
      <p className="tbx-banner-sub mt-2 max-w-[560px] text-[clamp(13px,1.3vw,16px)] font-medium text-white/85" style={{ textShadow: '0 2px 16px #000' }}>{w.brief}</p>
      <p className="tbx-banner-sub mt-2 hidden max-w-[560px] text-[clamp(11px,1.1vw,14px)] italic text-white/60 sm:block">“{w.kweg}” <span className="not-italic">· {KWEG.name}</span></p>
    </div>
  );
}
