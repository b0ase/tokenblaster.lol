'use client';
/**
 * LOADING = STORY (owner, 31 Oct 2026). While the rounds load, five punchy cards (big type, a line each), then the one
 * control hint. No paragraphs: the long story lives behind the "Story" link under the game.
 */
import { useEffect, useState } from 'react';

export const STORY_CARDS: readonly { top: string; line: string; tone: 'red' | 'teal' }[] = [
  { top: 'YOU ARE THE GUNNER', line: 'Neo-Tokyo, 2048. The Ninja Punk Girls need someone who keeps the trigger down.', tone: 'teal' },
  { top: 'FREE DR KWEG FROM THE EVIL EROBOTZ', line: 'They chained him to the core of the nSLAVE tower.', tone: 'red' },
  { top: 'STORM THE NODE', line: 'Up the street, through the labs, to TERRORNODE. Never stop walking.', tone: 'red' },
  { top: 'THE LIQUID UNIT', line: 'Seven metres of living silver. Fire pushes it back. Stop and it walks through you.', tone: 'teal' },
  { top: 'EVERY BULLET IS A REAL BSV TRANSACTION', line: 'Signed by your gun, on chain, with your name on it.', tone: 'red' },
];
export const STORY_CARD_MS = 2600;

export function StoryLoading({ pct, line, coarse = false, practice = false }: { pct: number; line: string; coarse?: boolean; practice?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), STORY_CARD_MS);
    return () => clearInterval(t);
  }, []);
  const done = i >= STORY_CARDS.length;
  const c = STORY_CARDS[Math.min(i, STORY_CARDS.length - 1)];
  const last = practice && c.top.startsWith('EVERY BULLET') ? { ...c, top: 'EVERY BULLET COUNTS', line: 'In paid play each one is a real BSV transaction. This run is practice.' } : c;
  const hint = coarse ? 'HOLD FIRE · LEFT THUMB MOVES · RIGHT THUMB AIMS' : 'HOLD MOUSE OR SPACE TO FIRE · WASD MOVE · MOUSE AIMS';
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/55 px-4 text-center" role="status" data-warmup data-story>
      {done ? (
        <div key="hint" className="tbx-pop" data-story-hint>
          <p className="tbx-display text-[clamp(28px,6vw,72px)] leading-none text-white">GET READY</p>
          <p className="mt-4 text-[clamp(13px,1.8vw,20px)] font-bold tracking-[0.2em] text-[var(--tbx-teal)]">{hint}</p>
        </div>
      ) : (
        <div key={i} className="tbx-pop max-w-[1000px]" data-story-card={i + 1}>
          <p className="text-[11px] font-bold tracking-[0.5em] text-white/60">
            {i + 1} / {STORY_CARDS.length}
          </p>
          <p
            className="tbx-display mt-2 text-[clamp(34px,7.5vw,104px)] leading-[0.95]"
            style={{ color: last.tone === 'red' ? 'var(--tbx-red)' : '#fff', textShadow: last.tone === 'red' ? '0 0 50px rgba(255,59,59,.6), 0 6px 40px #000' : '0 0 40px rgba(63,216,232,.45), 0 6px 40px #000' }}
          >
            {last.top}
          </p>
          <p className="mx-auto mt-4 max-w-[640px] text-[clamp(15px,2vw,24px)] font-semibold text-white/90" style={{ textShadow: '0 2px 16px #000' }}>
            {last.line}
          </p>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-[10%] mx-auto w-[min(92%,960px)]">
        <div className="tbx-bar !h-5 sm:!h-6">
          <i style={{ transform: `scaleX(${pct / 100})`, transition: 'transform 0.25s linear' }} />
        </div>
        <p className="tbx-num mt-3 flex items-baseline justify-between gap-4 font-semibold text-white/85" data-load-line>
          <span className="text-[clamp(13px,1.6vw,18px)] tracking-[0.12em]">{line}</span>
          <span className="tbx-display text-[clamp(24px,4vw,44px)] leading-none text-[var(--tbx-teal)]">{pct}%</span>
        </p>
      </div>
    </div>
  );
}
