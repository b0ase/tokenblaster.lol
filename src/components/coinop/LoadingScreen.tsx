'use client';
/**
 * 80s/90s cassette-style LOADING SCREEN for the coin-op shooting games (owner, 24 Oct 2026). It entertains
 * while the gun loads: cycling story cards and tips typed out letter by letter, flashing border colour bars,
 * a scanline, and a chiptune loop (src/lib/coinop/chiptune.ts). Underneath, always visible, the big progress
 * bar and the status in plain words. Reusable: pass your own `story` lines and `tips`.
 *
 * Plain words only (owner's rule): no technical terms here. Transaction ids stay in the ON CHAIN panel.
 */
import { useEffect, useState } from 'react';
import { DR } from '@/lib/dr/tokens';
import { startChiptune, stopChiptune } from '@/lib/coinop/chiptune';

export type StoryCard = { title: string; line: string };
export type LoadState =
  | { kind: 'approve' }
  | { kind: 'paid' }
  | { kind: 'loading'; pct: number; slowSecs: number }
  | { kind: 'ready' }
  | { kind: 'failed'; text: string };

const BORDER = ['#e8261d', '#00e5ff', '#ffd400', '#ff2fd0', '#39ff14', '#2d5bff'];

function statusText(s: LoadState) {
  switch (s.kind) {
    case 'approve':
      return 'Waiting for you to approve in your wallet…';
    case 'paid':
      return 'Payment received.';
    case 'loading':
      return s.slowSecs > 0 ? `Still loading. The network is busy, hang on… ${s.slowSecs}s` : `Loading your gun… ${Math.round(s.pct)}%`;
    case 'ready':
      return 'GUN LOADED. PRESS FIRE';
    case 'failed':
      return s.text;
  }
}
const pctOf = (s: LoadState) => (s.kind === 'approve' ? 5 : s.kind === 'paid' ? 10 : s.kind === 'loading' ? Math.max(10, s.pct) : s.kind === 'ready' ? 100 : 0);

export function LoadingScreen({ title, story, tips, state, onFire, music = true }: { title: string; story: StoryCard[]; tips: string[]; state: LoadState; onFire?: () => void; music?: boolean }) {
  // Story cards with a tip between each.
  const cards: StoryCard[] = story.flatMap((c, i) => (tips.length ? [c, { title: 'TIP', line: tips[i % tips.length] }] : [c]));
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [tick, setTick] = useState(0);
  const card = cards[i % Math.max(1, cards.length)];

  useEffect(() => {
    const t = setInterval(() => {
      setI((n) => n + 1);
      setTyped(0);
    }, 4200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTyped((n) => n + 1), 28);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 90);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!music) return;
    startChiptune();
    return () => stopChiptune();
  }, [music]);
  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'failed') stopChiptune();
  }, [state.kind]);

  const failed = state.kind === 'failed';
  const ready = state.kind === 'ready';
  // Cassette-loader border: horizontal colour bars that roll while loading.
  const bars = Array.from({ length: 24 }, (_, k) => BORDER[(k + tick) % BORDER.length]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col" style={{ background: '#000', fontFamily: DR.font.mono }} role="status" aria-live="polite" data-loading-screen>
      <div className="flex h-full flex-col p-[clamp(10px,3vw,28px)]" style={{ background: failed || ready ? (failed ? '#3a0606' : '#06240a') : `repeating-linear-gradient(0deg, ${bars.map((c, k) => `${c} ${k * 6}px ${(k + 1) * 6}px`).join(',')})` }}>
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-4 py-6 text-center" style={{ background: '#0a0a23' }}>
          {/* scanlines */}
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 3px)' }} />
          <p className="text-[10px] tracking-[0.4em] text-[#7cf]">TOKENBLASTER · {title.toUpperCase()} · 1991</p>
          {ready ? (
            <button type="button" data-fs-skip onClick={onFire} className="lock-load px-6 py-4 text-[clamp(26px,6vw,56px)] font-black uppercase italic leading-none" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `3px solid ${DR.colour.paper}` }}>
              Gun loaded. Press fire
            </button>
          ) : failed ? (
            <p className="max-w-[560px] text-[clamp(18px,3vw,26px)] font-bold" style={{ color: '#ffb4a8' }}>
              {state.text}
            </p>
          ) : (
            <div className="min-h-[7.5em] max-w-[640px]">
              <p className="mb-2 text-[clamp(18px,3.4vw,30px)] font-black tracking-[0.2em]" style={{ color: card?.title === 'TIP' ? DR.colour.cyan : DR.colour.amber }}>
                {card?.title}
              </p>
              <p className="text-[clamp(14px,2.4vw,20px)] leading-snug" style={{ color: '#e8f0ff' }}>
                {card?.line.slice(0, typed)}
                <span className="inline-block w-[0.6em]" style={{ opacity: tick % 6 < 3 ? 1 : 0 }}>
                  █
                </span>
              </p>
            </div>
          )}
          <div className="w-full max-w-[640px]">
            <div className="h-6 border-2 bg-black" style={{ borderColor: DR.colour.paper }}>
              <div className="h-full transition-[width] duration-500" style={{ width: `${pctOf(state)}%`, background: failed ? '#7a1a12' : `repeating-linear-gradient(90deg, ${DR.colour.amber} 0 10px, #b88600 10px 14px)` }} />
            </div>
            <p className="mt-2 text-[clamp(14px,2.6vw,20px)] font-bold" style={{ color: failed ? '#ffb4a8' : DR.colour.paper }} data-load-status>
              {statusText(state)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
