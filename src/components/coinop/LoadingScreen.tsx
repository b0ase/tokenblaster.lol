'use client';
/**
 * Modern full-screen game loading screen for the coin-op shooting games (owner, 24 Oct 2026: AAA console
 * shooters, never retro). Reusable: pass your own shots, lore beats, characters and tips (the Shooting Gallery's
 * live in src/lib/gallery/story.ts).
 *
 *  - Full-bleed key art with a slow dolly and soft crossfades, cinematic letterbox bars, a teal/blue grade with
 *    a red accent, film grain and a vignette.
 *  - A chapter rail, the story beat in big display type, and the character it is about on a bio card.
 *  - A slim glowing progress bar with a percentage ticking up, and a plain status line.
 *  - Art slots: a shot or a portrait that does not exist yet is skipped by itself (useExisting), so new renders
 *    only need dropping into public/gallery/.
 *  - Music: the site's own soundtrack (src/lib/sfx.ts playMusic), so the mute button and player apply.
 *
 * Plain words only (owner's rule): no technical terms. Transaction ids stay in the ON CHAIN panel.
 */
import { useEffect, useMemo, useState } from 'react';
import { playMusic, unlockAudio, type Track } from '@/lib/sfx';
import { tbxFontClass } from './fonts';
import { Icon, Ticker, useExisting } from './ui';

export type LoadState =
  | { kind: 'approve' }
  | { kind: 'paid' }
  | { kind: 'loading'; pct: number; slowSecs: number }
  | { kind: 'ready' }
  | { kind: 'failed'; text: string };

export type LoadShot = { src: string; beat: string; focus?: string; pos?: string; caption?: string };
export type LoadBeat = { id: string; title: string; line: string; focus?: string };
export type LoadCharacter = { id: string; name: string; role: string; bio: string; threat: string; colour: string; portrait: string; kind: string };

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

const BEAT_MS = 7000;

/** The drawn badge shown until a portrait render exists. */
export function Badge({ c, size = 72 }: { c: Pick<LoadCharacter, 'name' | 'colour' | 'kind'>; size?: number }) {
  const mono = c.name.replace(/^(THE|DR)\s+/i, '').slice(0, 2).toUpperCase();
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={`b${c.name.length}${mono}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.colour} stopOpacity="0.9" />
          <stop offset="1" stopColor={c.colour} stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d="M40 4l32 12v24c0 18-13 31-32 36C21 71 8 58 8 40V16z" fill="rgba(4,10,16,.8)" stroke={`url(#b${c.name.length}${mono})`} strokeWidth="2.5" />
      <text x="40" y="49" textAnchor="middle" fontSize="26" fontWeight="900" fill={c.colour} style={{ fontFamily: 'var(--tbx-display), Impact, sans-serif', letterSpacing: '0.04em' }}>
        {mono}
      </text>
    </svg>
  );
}

export function CharacterCard({ c, portrait, compact = false }: { c: LoadCharacter; portrait: boolean; compact?: boolean }) {
  return (
    <div className="tbx-glass flex gap-3 p-3 sm:gap-4 sm:p-4" style={{ ['--c' as string]: c.colour }}>
      <div className="relative shrink-0 overflow-hidden rounded-lg border border-[var(--tbx-line)]" style={{ width: compact ? 56 : 96, height: compact ? 70 : 120, background: 'rgba(3,8,14,.7)' }}>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.portrait} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Badge c={c} size={compact ? 48 : 76} />
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: c.colour, boxShadow: `0 0 12px ${c.colour}` }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: c.colour }}>
          {c.kind === 'hero' ? 'Ally' : c.kind === 'villain' ? 'The villain' : c.kind === 'boss' ? 'Boss' : 'Erobot'}
        </p>
        <p className="tbx-display mt-1 text-[clamp(22px,2.4vw,30px)]">{c.name}</p>
        <p className="text-xs text-[var(--tbx-dim)]">{c.role}</p>
        {!compact && <p className="mt-2 text-[13px] leading-snug text-[var(--tbx-text)]/90">{c.bio}</p>}
        <p className="mt-2 flex gap-1.5 text-xs leading-snug text-[var(--tbx-dim)]">
          <Icon name="target" size={13} className="mt-px shrink-0" style={{ color: c.colour }} />
          {c.threat}
        </p>
      </div>
    </div>
  );
}

export function LoadingScreen({
  title,
  kicker = 'TOKENBLASTER',
  setting,
  shots,
  lore,
  characters,
  tips,
  state,
  onFire,
  track,
}: {
  title: string;
  kicker?: string;
  /** A small line under the title, e.g. the place and year. */
  setting?: string;
  shots: LoadShot[];
  lore: LoadBeat[];
  characters: LoadCharacter[];
  tips: string[];
  state: LoadState;
  onFire?: () => void;
  /** The site soundtrack to play while loading (it carries on into the game). */
  track?: Track;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), BEAT_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!track) return;
    unlockAudio();
    playMusic(track);
  }, [track]);

  const have = useExisting([...shots.map((s) => s.src), ...characters.map((c) => c.portrait)]);
  const live = useMemo(() => shots.filter((s) => have.has(s.src)), [shots, have]);

  const failed = state.kind === 'failed';
  const ready = state.kind === 'ready';
  const pct = pctOf(state);
  const L = Math.max(1, lore.length);
  const beat = lore[i % L];
  // The shot that belongs to a beat (rotating if several do), else the next one in the reel.
  const pick = (j: number) => {
    const b = lore[j % L];
    const m = live.filter((s) => s.beat === b?.id);
    return m.length ? m[Math.floor(j / L) % m.length] : live[j % Math.max(1, live.length)];
  };
  const shot = pick(i);
  /** When shot s last came on (so its dolly restarts only when it returns, not when it fades out). */
  const lastOn = (s: LoadShot) => {
    for (let j = i; j >= 0 && j > i - 64; j--) if (pick(j) === s) return j;
    return -1;
  };
  const focusId = (shot && shot.beat === beat?.id && shot.focus) || beat?.focus || shot?.focus;
  const who = characters.find((c) => c.id === focusId);
  const tip = tips[i % Math.max(1, tips.length)];

  return (
    <div className={`${tbxFontClass} fixed inset-0 z-[70] overflow-hidden bg-[#03070c] text-white`} role="status" aria-live="polite" data-loading-screen>
      {/* Key art: crossfading shots, each on a slow dolly. */}
      {live.map((s, k) => {
        const on = s === shot;
        return (
          <div key={s.src} className="absolute inset-0 transition-opacity duration-[1400ms] ease-out" style={{ opacity: on ? 1 : 0 }} aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={`${s.src}:${lastOn(s)}`} src={s.src} alt="" className={`h-full w-full object-cover ${on ? 'tbx-dolly' : ''}`} style={{ objectPosition: s.pos ?? 'center', ['--dir' as string]: k % 2 ? '-1' : '1' }} />
          </div>
        );
      })}
      {/* Grade: teal shadows, a red kiss on the horizon, darken top and bottom so the type reads. */}
      <div aria-hidden className="absolute inset-0 mix-blend-multiply" style={{ background: 'linear-gradient(180deg, #0a2a3a 0%, #0b1b2c 55%, #14080c 100%)', opacity: 0.38 }} />
      <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(2,6,10,.7) 0%, rgba(2,6,10,0) 30%, rgba(2,6,10,0) 42%, rgba(2,6,10,.92) 100%)' }} />
      <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 38%, transparent 50%, rgba(0,0,0,.6))' }} />
      <div aria-hidden className="tbx-grain" />
      {/* Letterbox bars slide in */}
      <div aria-hidden className="tbx-in-d absolute inset-x-0 top-0 h-[clamp(14px,3.2vh,40px)] bg-black" />
      <div aria-hidden className="tbx-rise absolute inset-x-0 bottom-0 h-[clamp(14px,3.2vh,40px)] bg-black" style={{ ['--d' as string]: '0s' }} />

      <div className="relative flex h-full flex-col justify-between px-[clamp(18px,4vw,64px)] py-[clamp(26px,6vh,72px)]">
        <header className="flex items-start justify-between gap-6">
          <div className="tbx-in-l" style={{ ['--d' as string]: '0.1s' }}>
            <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-teal)' }}>
              <span className="inline-block h-[2px] w-6 bg-[var(--tbx-red)]" />
              {kicker}
            </p>
            <h1 className="tbx-display mt-2 text-[clamp(44px,8.5vw,132px)]" style={{ textShadow: '0 8px 50px rgba(0,0,0,.7)' }}>
              {title}
            </h1>
            {setting && <p className="mt-2 text-[clamp(11px,1.1vw,14px)] font-semibold uppercase tracking-[0.4em] text-white/65">{setting}</p>}
          </div>
          {/* Chapter rail */}
          <div className="tbx-in-r hidden shrink-0 flex-col items-end gap-2 sm:flex" style={{ ['--d' as string]: '0.25s' }} aria-hidden>
            <p className="tbx-display text-[clamp(26px,2.6vw,38px)] tbx-num">
              {String((i % L) + 1).padStart(2, '0')}
              <span className="text-white/35"> / {String(L).padStart(2, '0')}</span>
            </p>
            <div className="flex gap-1">
              {lore.map((b, k) => (
                <span key={b.id} className="h-[3px] w-6 rounded-full transition-all duration-500" style={{ background: k === i % L ? 'var(--tbx-red)' : k < i % L ? 'rgba(63,216,232,.7)' : 'rgba(255,255,255,.2)', boxShadow: k === i % L ? '0 0 10px var(--tbx-red)' : undefined }} />
              ))}
            </div>
            {shot?.caption && <p className="text-[11px] uppercase tracking-[0.3em] text-white/55">{shot.caption}</p>}
          </div>
        </header>

        <div className="flex flex-col gap-[clamp(12px,2.2vh,26px)]">
          <div className="flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-end">
            {ready ? (
              <button type="button" data-fs-skip onClick={onFire} className="tbx-btn tbx-btn-red tbx-pop self-start !min-h-[56px] !px-8 !text-lg">
                Press fire <Icon name="play" size={18} />
              </button>
            ) : (
              <>
                {beat && (
                  <div key={`beat${i}`} className="tbx-rise max-w-[600px]">
                    <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-red)' }}>
                      <Icon name="chevron" size={13} /> Chapter {String((i % L) + 1).padStart(2, '0')}
                    </p>
                    <p className="tbx-display mt-1.5 text-[clamp(30px,4.2vw,58px)]">{beat.title}</p>
                    <p className="mt-2 max-w-[560px] text-[clamp(15px,1.5vw,19px)] font-medium leading-snug text-white/90" style={{ textShadow: '0 2px 18px rgba(0,0,0,.8)' }}>
                      {beat.line}
                    </p>
                    {tip && (
                      <p className="mt-3 flex items-start gap-2 text-[clamp(12px,1.1vw,14px)] text-white/65">
                        <Icon name="bolt" size={14} className="mt-px shrink-0 text-[var(--tbx-amber)]" />
                        {tip}
                      </p>
                    )}
                  </div>
                )}
                {who && (
                  <div key={`who${who.id}${i}`} className="tbx-in-r w-full lg:max-w-[460px]">
                    <div className="hidden sm:block">
                      <CharacterCard c={who} portrait={have.has(who.portrait)} />
                    </div>
                    <div className="sm:hidden">
                      <CharacterCard c={who} portrait={have.has(who.portrait)} compact />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <div className="mb-2.5 flex items-end justify-between gap-4">
              <p className={`text-[clamp(14px,1.5vw,19px)] font-semibold ${failed ? 'text-[#ff8a7a]' : 'text-white'}`} data-load-status>
                {statusText(state)}
              </p>
              {!failed && (
                <p className="tbx-display text-[clamp(30px,3.6vw,52px)] tbx-num">
                  <Ticker value={pct} ease={0.12} />%
                </p>
              )}
            </div>
            <div className="tbx-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ transform: `scaleX(${pct / 100})`, background: failed ? 'var(--tbx-red)' : undefined }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
