'use client';
/**
 * Modern full-screen game loading screen for the coin-op shooting games (owner, 24 Oct 2026: "modern
 * graphics", think big console shooters). Reusable: pass your own key-art shots, lore lines and tips.
 *
 *  - Full-bleed, high-resolution key art rendered from our own 3D engine (public/gallery/loading/*.webp),
 *    with a slow dolly / parallax and soft crossfades between shots.
 *  - Bold display title, a slim glowing progress bar with a percentage, and one line of lore plus one tip
 *    in a glassy (backdrop-blur) panel. Plenty of negative space, subtle motion.
 *  - Music: the site's own soundtrack (src/lib/sfx.ts playMusic), so the mute button and player apply.
 *
 * Plain words only (owner's rule): no technical terms. Transaction ids stay in the ON CHAIN panel.
 */
import { useEffect, useState } from 'react';
import { DR } from '@/lib/dr/tokens';
import { playMusic, unlockAudio, type Track } from '@/lib/sfx';

export type StoryCard = { title: string; line: string };
export type LoadState =
  | { kind: 'approve' }
  | { kind: 'paid' }
  | { kind: 'loading'; pct: number; slowSecs: number }
  | { kind: 'ready' }
  | { kind: 'failed'; text: string };

function statusText(s: LoadState) {
  switch (s.kind) {
    case 'approve':
      return 'Waiting for you to approve in your wallet…';
    case 'paid':
      return 'Payment received.';
    case 'loading':
      return s.slowSecs > 0 ? `Still loading. The network is busy, hang on… ${s.slowSecs}s` : 'Loading your gun…';
    case 'ready':
      return 'Gun loaded.';
    case 'failed':
      return s.text;
  }
}
const pctOf = (s: LoadState) => (s.kind === 'approve' ? 4 : s.kind === 'paid' ? 10 : s.kind === 'loading' ? Math.max(10, s.pct) : s.kind === 'ready' ? 100 : 0);

const SHOT_MS = 7000;

export function LoadingScreen({
  title,
  kicker = 'TOKENBLASTER',
  shots,
  story,
  tips,
  state,
  onFire,
  track,
}: {
  title: string;
  kicker?: string;
  /** Key-art renders (hi-res, from the game engine). */
  shots: string[];
  story: StoryCard[];
  tips: string[];
  state: LoadState;
  onFire?: () => void;
  /** The site soundtrack to play while loading (it carries on into the game). */
  track?: Track;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), SHOT_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!track) return;
    unlockAudio();
    playMusic(track);
  }, [track]);

  const failed = state.kind === 'failed';
  const ready = state.kind === 'ready';
  const pct = pctOf(state);
  const lore = story[i % Math.max(1, story.length)];
  const tip = tips[i % Math.max(1, tips.length)];
  const shot = i % Math.max(1, shots.length);

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-black text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" }} role="status" aria-live="polite" data-loading-screen>
      {/* Key art: crossfading shots, each on a slow dolly. */}
      {shots.map((src, k) => (
        <div key={src} className="absolute inset-0 transition-opacity duration-[1600ms] ease-out" style={{ opacity: k === shot ? 1 : 0 }} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className={`h-full w-full object-cover ${k === shot ? 'lsm-dolly' : ''}`} style={{ ['--lsm-dir' as string]: k % 2 ? '-1' : '1' }} />
        </div>
      ))}
      {/* Grade: darken the top and bottom so the type reads. */}
      <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 50%, rgba(0,0,0,.88) 100%)' }} />
      <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,.5))' }} />

      <div className="relative flex h-full flex-col justify-between p-[clamp(20px,4vw,64px)]">
        <header className="lsm-rise">
          <p className="text-[clamp(11px,1.1vw,14px)] font-semibold uppercase tracking-[0.5em] text-white/70">{kicker}</p>
          <h1 className="mt-1 text-[clamp(40px,7vw,112px)] font-black uppercase leading-[0.88]" style={{ fontFamily: DR.font.display, textShadow: '0 6px 40px rgba(0,0,0,.6)' }}>
            {title}
          </h1>
        </header>

        <div className="flex flex-col gap-[clamp(14px,2.4vh,28px)]">
          {ready ? (
            <button
              type="button"
              data-fs-skip
              onClick={onFire}
              className="lsm-rise self-start rounded-full px-[clamp(22px,3vw,40px)] py-[clamp(12px,1.6vw,18px)] text-[clamp(16px,1.8vw,22px)] font-bold uppercase tracking-[0.25em] text-black"
              style={{ background: DR.colour.paper, boxShadow: `0 0 40px ${DR.colour.signal}aa` }}
            >
              Press fire ▶
            </button>
          ) : (
            <div key={i} className="lsm-rise max-w-[560px] rounded-2xl border border-white/15 bg-white/[0.07] p-[clamp(14px,1.8vw,22px)] backdrop-blur-xl" style={{ boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
              {lore && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.35em]" style={{ color: DR.colour.amber }}>
                    {lore.title}
                  </p>
                  <p className="mt-1.5 text-[clamp(16px,1.5vw,20px)] font-medium leading-snug text-white/95">{lore.line}</p>
                </>
              )}
              {tip && (
                <p className="mt-3 border-t border-white/10 pt-3 text-[clamp(13px,1.15vw,15px)] text-white/70">
                  <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white">Tip</span>
                  {tip}
                </p>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-end justify-between gap-4">
              <p className={`text-[clamp(15px,1.6vw,20px)] font-semibold ${failed ? 'text-[#ff8a7a]' : 'text-white'}`} data-load-status>
                {statusText(state)}
              </p>
              {!failed && <p className="text-[clamp(22px,2.6vw,36px)] font-black tabular-nums leading-none">{Math.round(pct)}%</p>}
            </div>
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%`, background: failed ? '#ff5a4a' : `linear-gradient(90deg, ${DR.colour.signal}, #ff7a4a)`, boxShadow: failed ? undefined : `0 0 12px ${DR.colour.signal}, 0 0 24px ${DR.colour.signal}88` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
