'use client';

/**
 * NPG live graphics as the page frame (owner, 27 Oct): a light port of ninjapunkgirls.com's LiveMix. Two muted
 * videos of NPG footage crossfade behind the page, with an occasional glitch or mono cut, darkened so the panels on
 * top stay readable. No audio (the game has its own music). Mounted with the loadout screen only, so it is gone
 * while a round is played; loads after first paint, pauses while the tab is hidden, and is off in mobile-lite and
 * under prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import { isMobileLite } from '@/lib/mobileLite';

const CLIPS = ['/terrornode/npgvx/npg-03.mp4', '/terrornode/npgvx/npg-11.mp4', '/terrornode/npgvx/npg-19.mp4', '/terrornode/npgvx/npg-26.mp4'];
const HOLD_MS = 7000;

export function NpgBackdrop() {
  const [on, setOn] = useState(false);
  const [front, setFront] = useState(0); // which of the two <video>s is showing
  const [fx, setFx] = useState<'' | 'glitch' | 'mono'>('');
  const vids = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const clip = useRef(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isMobileLite() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // after first paint and idle: the backdrop never competes with the game for the first load
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const t = window.setTimeout(() => (ric ? ric(() => setOn(true), { timeout: 2500 }) : setOn(true)), 1200);
    const vis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => (window.clearTimeout(t), document.removeEventListener('visibilitychange', vis));
  }, []);

  const stopped = hidden;
  // the loadout screen lets the frame show through while the backdrop runs (globals.css, html[data-npg-backdrop])
  useEffect(() => {
    if (!on) return;
    document.documentElement.dataset.npgBackdrop = '1';
    return () => void delete document.documentElement.dataset.npgBackdrop;
  }, [on]);
  useEffect(() => {
    if (!on) return;
    const cur = vids[front].current;
    if (stopped) {
      vids.forEach((v) => v.current?.pause());
      return;
    }
    cur?.play().catch(() => {});
    const t = window.setTimeout(() => {
      // load the next clip into the back video, then cut to it (a glitch now and then, a mono stretch rarely)
      const back = vids[1 - front].current;
      if (!back) return;
      clip.current = (clip.current + 1) % CLIPS.length;
      back.src = CLIPS[clip.current];
      back.play().catch(() => {});
      const r = Math.random();
      setFx(r < 0.3 ? 'glitch' : r < 0.42 ? 'mono' : '');
      window.setTimeout(() => setFx((f) => (f === 'glitch' ? '' : f)), 260);
      window.setTimeout(() => setFx((f) => (f === 'mono' ? '' : f)), 3200);
      setFront(1 - front);
      window.setTimeout(() => cur?.pause(), 1300);
    }, HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, front, stopped]);

  if (!on) return null;
  const filter = fx === 'mono' ? 'grayscale(1) contrast(1.3) brightness(.5)' : fx === 'glitch' ? 'hue-rotate(140deg) saturate(2) brightness(.7)' : 'saturate(1.15) brightness(.55)';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[6] overflow-hidden bg-black" data-npg-backdrop={stopped ? 'paused' : 'live'}>
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={vids[i]}
          src={i === 0 ? CLIPS[0] : undefined}
          muted
          loop
          playsInline
          preload={i === 0 ? 'auto' : 'none'}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
          style={{ opacity: front === i ? 1 : 0, filter, transform: fx === 'glitch' ? 'translateX(-1.5%) scale(1.04)' : undefined }}
        />
      ))}
      {/* darken the middle where the content sits, keep the frame edges lit; faint scanlines */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 75% at 50% 50%, rgba(3,6,10,.86) 35%, rgba(3,6,10,.45) 100%)' }} />
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,.6) 0 1px, transparent 1px 3px)' }} />
    </div>
  );
}
