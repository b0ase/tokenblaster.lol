'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewButton } from '@/components/PreviewButton';
import { startPreview, stopPreview, trackFor, usePreview } from '@/lib/preview';

/**
 * The home hero's cycling showcase of the flagship games: full-colour frames, a Ken Burns push, a chevron wipe with
 * a scanline glitch every ~4.6s, a product code and PLAY button per slide, clickable progress ticks. The tick fill's
 * CSS animation drives the advance (onAnimationEnd), so reduced motion (animations off) simply holds the frame.
 * Each slide plays a short gameplay loop (public/hero/<game>.mp4 H.264, posters .jpg) full-bleed; only the active
 * slide's video runs, the next one preloads metadata, the rest stay at preload=none. Reduced motion or Save-Data
 * show the poster only; a video that errors falls back to the old static arcade card (public/arcade) with Ken Burns.
 * The loops are practice-mode, High/Ultra-quality captures (canvas only, DOM overlays hidden, rendered at a true
 * 1920x1080 with devicePixelRatio 1, not upscaled) from headless Chrome's CDP screencast, cross-faded head-to-tail and
 * encoded with ffmpeg: <game>.mp4 is 1920x1080 30fps H.264 High (yuv420p, no audio, faststart, ~5-6 MB); <game>-720.mp4
 * is the 1280x720 variant a <source media> hands to phones and small windows; <game>.jpg is the 1920x1080 poster.
 */
type Slide = { href: string; img: string; vid?: string; title: string; tag: string; kana: string };
const SLIDES: readonly Slide[] = [
  { href: '/arcade/terrornode', img: '/gallery/loading/boss-fire.webp', vid: '/hero/assault', title: 'Assault on Terrornode', tag: 'Rail shooter', kana: 'テラーノード強襲' },
  { href: '/arena', img: '/arcade/arena.jpg', vid: '/hero/arena', title: 'Arena', tag: 'Hell-forge shooter', kana: 'アリーナ' },
  { href: '/arcade/npg-arena', img: '/arcade/npg-arena.jpg', vid: '/hero/npg-arena', title: 'Ninja Punk Girls: Arena', tag: 'Ninja brawler', kana: '忍者パンクガールズ' },
  { href: '/arcade/bracer', img: '/arcade/bracer.jpg', vid: '/hero/bracer-v2', title: 'bRacer', tag: 'Anti-gravity racer', kana: '反重力レース' },
  { href: '/arcade/city', img: '/arcade/city.jpg', vid: '/hero/city-v2', title: 'Satoshi City', tag: 'Open-world city', kana: 'サトシ市' },
];

/** The active slide, shared with <HeroTitle> (rendered inside the headline column). */
let current = 0;
const subs = new Set<() => void>();
function setCurrent(n: number) {
  current = n;
  subs.forEach((f) => f());
}
const subscribeCurrent = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
const currentSnapshot = () => current;
const currentServer = () => 0;

/** The rotating game title, shown big in the hero's display face; re-keyed per slide so it slams in letter by letter
 * (with a red/cyan split that collapses onto it), a neon glow layer that flickers, and an underline that fills with
 * the slide's progress. Transform/opacity only; reduced motion shows it still (globals.css). */
export function HeroTitle() {
  const n = useSyncExternalStore(subscribeCurrent, currentSnapshot, currentServer);
  const s = SLIDES[n];
  const code = `${String(n + 1).padStart(2, '0')}/${String(SLIDES.length).padStart(2, '0')}`;
  return (
    <Link href={s.href} className="group mb-3 block w-fit max-w-full" aria-live="polite" aria-label={`Now playing ${code}: ${s.title}, ${s.tag}`}>
      <span key={`np-${n}`} className="hp-np dr-code !text-[var(--accent)]" aria-hidden>
        <span className="hp-np-dot" /> Now playing {code} · {s.tag}
      </span>
      <span key={n} className="hp-title dr-display relative block text-[clamp(30px,5.2vw,68px)] leading-[0.95] text-[var(--accent)] [text-shadow:0_2px_0_var(--panel),0_0_22px_var(--panel)]" aria-hidden>
        <span className="hp-title-glow" aria-hidden>
          {s.title}
        </span>
        <span className="hp-title-split hp-title-r" aria-hidden>
          {s.title}
        </span>
        <span className="hp-title-split hp-title-c" aria-hidden>
          {s.title}
        </span>
        <span className="relative">
          {s.title.split(' ').map((w, wi, all) => {
            const at = all.slice(0, wi).join(' ').length + (wi ? 1 : 0); // letter index of this word, for the stagger
            return (
              <Fragment key={wi}>
                <span className="inline-block whitespace-nowrap">
                  {[...w].map((ch, k) => (
                    <span key={k} className="hp-ch" style={{ ['--k' as string]: at + k }}>
                      {ch}
                    </span>
                  ))}
                </span>
                {wi < all.length - 1 && ' '}
              </Fragment>
            );
          })}
        </span>
        <span className="hp-title-bar" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * Re-plays a short punch on its children every time the hero slide changes, through the Web Animations API on the
 * wrapper (transform/opacity only, nothing re-mounted, no layout). `kind`: 'kick' jolts the headline, 'stamp' stamps
 * the stickers down (they also wobble at rest, in CSS). Skipped under reduced motion.
 */
export function HeroKick({ kind, className, children }: { kind: 'kick' | 'stamp'; className?: string; children: ReactNode }) {
  const n = useSyncExternalStore(subscribeCurrent, currentSnapshot, currentServer);
  const el = useRef<HTMLDivElement>(null);
  const seen = useRef(-1);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const firstRun = seen.current === -1;
    seen.current = n;
    if (firstRun || window.matchMedia(RM).matches || typeof e.animate !== 'function') return;
    const frames: Keyframe[] =
      kind === 'kick'
        ? [
            { transform: 'translate3d(0,0,0) skewX(0deg)' },
            { transform: 'translate3d(-10px,0,0) skewX(-7deg)', offset: 0.18 },
            { transform: 'translate3d(6px,0,0) skewX(3deg)', offset: 0.42 },
            { transform: 'translate3d(-2px,0,0) skewX(-1deg)', offset: 0.7 },
            { transform: 'translate3d(0,0,0) skewX(0deg)' },
          ]
        : [
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
            { transform: 'scale(1.35) rotate(-6deg)', opacity: 0, offset: 0.08 },
            { transform: 'scale(0.94) rotate(1.5deg)', opacity: 1, offset: 0.55 },
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          ];
    const a = e.animate(frames, { duration: kind === 'kick' ? 520 : 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', delay: kind === 'stamp' ? 260 : 60 });
    return () => a.cancel();
  }, [n, kind]);
  return (
    <div ref={el} className={className}>
      {children}
    </div>
  );
}

const KB = [
  ['-1.5%', '-1%'],
  ['1.5%', '-1%'],
  ['-1%', '1.2%'],
  ['1.2%', '1%'],
  ['-1.2%', '-1.2%'],
  ['1%', '1.2%'],
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
  // The loops (2-6 MB each) wait for the page's load event plus an idle moment, so they never compete with the
  // HTML, CSS, fonts and JS for bandwidth. Until then the poster (the loop's first frame) is what's on screen anyway.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let idle = 0;
    let t = 0;
    const arm = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) idle = ric(() => setArmed(true), { timeout: 1500 });
      else t = window.setTimeout(() => setArmed(true), 200);
    };
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm, { once: true });
    return () => {
      window.removeEventListener('load', arm);
      window.clearTimeout(t);
      (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(idle);
    };
  }, []);
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
  useEffect(() => setCurrent(i), [i]);
  const s = SLIDES[i];
  const pv = usePreview();
  // Hero height = viewport minus the (sticky, possibly wrapping) nav.
  useEffect(() => {
    const nav = document.querySelector('nav[aria-label="Site"]');
    if (!nav) return;
    const set = () => document.documentElement.style.setProperty('--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
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
    if (motion && armed && inView && v) {
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
  }, [i, motion, armed, inView]);
  const next = (i + 1) % SLIDES.length;
  // While the label is hovered/focused its game's music plays, following the slide as it changes.
  useEffect(() => {
    if (hold && pv.enabled && !pv.locked) startPreview(s.href, trackFor(s.href));
  }, [hold, i, pv.enabled, pv.locked, s.href]);

  return (
    <>
      {/* Full-bleed art, behind the headline (the hero supplies the scrim). */}
      <div ref={stage} className="pointer-events-none absolute inset-0 overflow-hidden bg-black" aria-hidden>
        {SLIDES.map((x, n) => {
          const vid = !!x.vid && motion && !failed.includes(n); // a loop slide; else the poster (reduced motion / Save-Data) or the old card (video failed)
          const live = vid && armed; // its <video> is mounted (after load + idle)
          const near = n === i || n === next || n === prev; // only these slides need their still decoded
          return (
            <div key={x.href} className="dr-slide" data-active={n === i} data-prev={n === prev && n !== i} data-first={first && n === i} data-video={vid} style={{ ['--kx' as string]: KB[n][0], ['--ky' as string]: KB[n][1] }}>
              {/* The poster (first frame of the loop) sits under the video, so there is never a blank frame; the card is the fallback. */}
              {/* Optimised AVIF/WebP sized for the cover crop; only the first slide is the LCP (priority), the next one preloads. */}
              {near && (
                <Image
                  src={!x.vid || (motion && failed.includes(n)) ? x.img : `${x.vid}.jpg`}
                  alt=""
                  fill
                  sizes="(max-aspect-ratio: 16/9) 178vh, 100vw" /* object-fit cover: rendered width = max(100vw, 100vh x 16/9) */
                  quality={80}
                  priority={n === 0}
                  loading={n === 0 ? undefined : 'eager'}
                  fetchPriority={n === 0 ? undefined : 'low'}
                  className="object-[68%_center]"
                />
              )}
              {live && (
                <video
                  ref={(el) => {
                    vids.current[n] = el;
                  }}
                  className="absolute inset-0 h-full w-full object-cover object-[68%_center]"
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
                  <source src={`${x.vid}-720.mp4`} type="video/mp4" media="(max-width: 900px)" />
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
        className="absolute right-3 top-3 z-20 w-[min(300px,calc(100%-1.5rem))] border-2 border-[var(--hot)] bg-[var(--panel)] shadow-[5px_5px_0_var(--accent-fill)] lg:bottom-24 lg:right-6 lg:top-auto lg:w-[320px]"
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
          <div className="min-w-0 flex-1">
            <p key={`c-${i}`} className="hp-card-code dr-code !text-[var(--accent)]">
              {String(i + 1).padStart(2, '0')}/{String(SLIDES.length).padStart(2, '0')} · TB-F{String(i + 1).padStart(2, '0')}
            </p>
            <p key={`t-${i}`} className="hp-card-title dr-display overflow-hidden text-ellipsis !whitespace-nowrap text-[22px] text-hot sm:text-[26px]">{s.title}</p>
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
