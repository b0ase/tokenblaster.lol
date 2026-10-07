'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewButton } from '@/components/PreviewButton';
import { startPreview, stopPreview, trackFor, usePreview } from '@/lib/preview';

/**
 * The home hero's cycling showcase of the flagship games: full-colour frames, a Ken Burns push, a chevron wipe with
 * a scanline glitch every ~4.6s, a product code and PLAY button per slide, clickable progress ticks. The tick fill's
 * CSS animation drives the advance (onAnimationEnd), so reduced motion (animations off) simply holds the frame.
 * Each slide plays a short gameplay loop (public/hero/<game>.mp4 H.264, posters .jpg) full-bleed; only the active
 * slide's video runs, the next one preloads metadata, the rest stay at preload=none. Reduced motion or Save-Data
 * show the poster only; a video that errors falls back to the old static arcade card (public/arcade) with Ken Burns.
 * The loops are practice-mode, High-quality captures (canvas only, DOM overlays hidden) from headless Chrome's CDP
 * screencast, cross-faded head-to-tail and encoded with ffmpeg (1280x720, 30fps, H.264, no audio, faststart).
 */
const SLIDES = [
  { href: '/arcade/bracer', img: '/arcade/bracer.jpg', vid: '/hero/bracer', title: 'bRacer', tag: 'Anti-gravity racer', kana: '反重力レース' },
  { href: '/arena', img: '/arcade/arena.jpg', vid: '/hero/arena', title: 'Arena', tag: 'Hell-forge shooter', kana: 'アリーナ' },
  { href: '/arcade/doubleosatoshi', img: '/arcade/doubleo.jpg', vid: '/hero/doubleo', title: 'Double-O Satoshi', tag: 'Spy shooter', kana: 'スパイ作戦' },
  { href: '/arcade/rally', img: '/arcade/rally.jpg', vid: '/hero/rally', title: 'Token Rally', tag: '3D rally', kana: 'ラリー' },
  { href: '/arcade/city', img: '/arcade/city.jpg', vid: '/hero/city', title: 'Satoshi City', tag: 'Open-world city', kana: 'サトシ市' },
] as const;

const KB = [
  ['-1.5%', '-1%'],
  ['1.5%', '-1%'],
  ['-1%', '1.2%'],
  ['1.2%', '1%'],
  ['-1.5%', '0.5%'],
];

type Conn = { saveData?: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
const RM = '(prefers-reduced-motion: reduce)';
/** Video allowed? Not under reduced motion or Save-Data. The server snapshot is false: SSR paints the poster. */
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(RM);
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  mq.addEventListener('change', cb);
  conn?.addEventListener?.('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
    conn?.removeEventListener?.('change', cb);
  };
}
const motionSnapshot = () => !window.matchMedia(RM).matches && !(navigator as Navigator & { connection?: Conn }).connection?.saveData;
const motionServer = () => false;

export function HeroShowcase() {
  const motion = useSyncExternalStore(subscribeMotion, motionSnapshot, motionServer);
  const [failed, setFailed] = useState<number[]>([]);
  const [inView, setInView] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const vids = useRef<(HTMLVideoElement | null)[]>([]);
  const lastI = useRef(-1);
  const want = useRef(-1); // the slide whose loop should be running (-1: none)
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState(-1);
  const [first, setFirst] = useState(true);
  const [hold, setHold] = useState(false);
  const go = (n: number) => {
    const to = (n + SLIDES.length) % SLIDES.length;
    if (to === i) return;
    setPrev(i);
    setI(to);
    setFirst(false);
  };
  const s = SLIDES[i];
  const pv = usePreview();
  // Only the active slide's loop runs (the outgoing one finishes under the wipe); everything pauses off-screen.
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = vids.current[i];
    if (motion && inView && v) {
      if (lastI.current !== i && v.currentTime > 0.05) v.currentTime = 0; // each slide's loop starts from its first frame under the wipe
      void v.play().catch(() => undefined); // muted, so allowed; a refusal (battery saver) just leaves the poster up
    }
    lastI.current = i;
    want.current = motion && inView ? i : -1;
    const t = window.setTimeout(() => {
      vids.current.forEach((x, n) => {
        if (!x) return;
        if (n !== i || !motion || !inView) x.pause();
        else if (x.paused) void x.play().catch(() => undefined); // Chrome can pause a muted video that starts under the wipe's zero-size clip
      });
    }, motion && inView ? 800 : 0);
    return () => window.clearTimeout(t);
  }, [i, motion, inView]);
  const next = (i + 1) % SLIDES.length;
  // While the label is hovered/focused its game's music plays, following the slide as it changes.
  useEffect(() => {
    if (hold && pv.enabled && !pv.locked) startPreview(s.href, trackFor(s.href));
  }, [hold, i, pv.enabled, pv.locked, s.href]);

  return (
    <>
      {/* Full-bleed art, behind the headline (the hero supplies the scrim). */}
      <div ref={stage} className="pointer-events-none absolute inset-x-0 top-0 h-[330px] overflow-hidden bg-black lg:inset-0 lg:h-auto" aria-hidden>
        {SLIDES.map((x, n) => {
          const live = motion && !failed.includes(n); // loop playing; else the poster (reduced motion / Save-Data) or the old card (video failed)
          return (
            <div key={x.href} className="dr-slide" data-active={n === i} data-prev={n === prev && n !== i} data-first={first && n === i} data-video={live} style={{ ['--kx' as string]: KB[n][0], ['--ky' as string]: KB[n][1] }}>
              {/* The poster (first frame of the loop) sits under the video, so there is never a blank frame; the card is the fallback. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={motion && failed.includes(n) ? x.img : `${x.vid}.jpg`} alt="" loading={n === 0 ? 'eager' : 'lazy'} fetchPriority={n === 0 ? 'high' : 'auto'} decoding="async" className="object-[70%_center]" />
              {live && (
                <video
                  ref={(el) => {
                    vids.current[n] = el;
                  }}
                  className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
                  poster={`${x.vid}.jpg`}
                  muted
                  loop
                  playsInline
                  disablePictureInPicture
                  autoPlay={n === 0}
                  preload={n === i ? 'auto' : n === next ? 'metadata' : 'none'}
                  tabIndex={-1}
                  onPause={(e) => {
                    if (want.current === n) void e.currentTarget.play().catch(() => undefined);
                  }}
                >
                  <source src={`${x.vid}.mp4`} type="video/mp4" onError={() => setFailed((f) => (f.includes(n) ? f : [...f, n]))} />
                </video>
              )}
            </div>
          );
        })}
        {!first && <div key={i} className="dr-glitch" />}
      </div>

      {/* Corner label: code, title, katakana, PLAY, clickable progress ticks. */}
      <div
        className="absolute right-2 top-2 z-20 w-[min(300px,calc(100%-1rem))] border-2 border-[var(--hot)] bg-[var(--panel)] shadow-[5px_5px_0_var(--accent-fill)] lg:bottom-16 lg:right-5 lg:top-auto lg:w-[320px]"
        onMouseEnter={() => setHold(true)}
        onMouseLeave={() => {
          setHold(false);
          stopPreview(s.href);
        }}
        onFocus={() => setHold(true)}
        onBlur={() => {
          setHold(false);
          stopPreview(s.href);
        }}
        role="region"
        aria-roledescription="carousel"
        aria-label="Flagship games"
      >
        <div className="dr-hazard !h-1.5" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-2.5 py-2" aria-live={hold ? 'polite' : 'off'}>
          <div className="min-w-0">
            <p className="dr-code !text-[var(--accent)]">
              {String(i + 1).padStart(2, '0')}/{String(SLIDES.length).padStart(2, '0')} · TB-F{String(i + 1).padStart(2, '0')}
            </p>
            <p className="dr-display overflow-hidden text-ellipsis whitespace-nowrap text-[22px] text-hot sm:text-[26px]">{s.title}</p>
            <p className="dr-kana text-[10px] text-[var(--muted)]" aria-hidden>
              {s.kana}
            </p>
          </div>
          <PreviewButton href={s.href} title={s.title} className="!opacity-100 shrink-0" />
          <Link href={s.href} className="btn-fire inline-flex shrink-0 items-center !px-3 !py-1.5 !text-lg">
            Play <span aria-hidden>&nbsp;▶</span>
          </Link>
        </div>
        <div className="flex gap-1 px-2.5 pb-1.5" role="group" aria-label="Choose a game">
          {SLIDES.map((x, n) => (
            <button key={x.href} type="button" onClick={() => go(n)} aria-label={`Show ${x.title}`} aria-current={n === i} className="group relative h-6 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--border-dim)] transition-all group-hover:h-2.5" />
              {n < i && <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--text)] opacity-60 transition-all group-hover:h-2.5" />}
              {n === i && (
                <span
                  key={`${i}-${prev}`}
                  className="dr-fill absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--accent-fill)] transition-[height] group-hover:h-2.5"
                  style={{ animationPlayState: hold ? 'paused' : 'running' }}
                  onAnimationEnd={() => go(i + 1)}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
