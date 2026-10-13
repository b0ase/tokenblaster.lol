'use client';

import { useEffect, useRef } from 'react';
import { clipPoster, clipSrc, type Clip } from './clips';

export type DeckApi = {
  /** Hard cut to the next clip now (a block, a big move). */
  cut: () => void;
};

type Props = {
  clips: Clip[];
  /** Still frame only (reduced motion / Save-Data): the lead poster, no video. */
  still: boolean;
  /** Milliseconds until the next scheduled cut; read fresh each time, so the chain can speed the rhythm up. */
  nextDelay: () => number;
  /** Chance that a cut is followed by a clean stretch (overlays bow out, the clip runs 6-11 s untouched). */
  cleanChance?: number;
  onClean?: (clean: boolean) => void;
  /** Which clip is on. */
  onShow?: (clip: Clip) => void;
  onCut?: () => void;
  onApi?: (api: DeckApi | null) => void;
};

/**
 * Two stacked <video>s swapped with a hard glitch cut (a few 60 ms clip-path flicks, then the swap). Every showing is
 * different: a shuffled never-repeat deck, random in-point, speed and zoom, never mirrored (the footage carries HUD
 * lettering). The lead clip's poster sits underneath for first paint. Pauses off-screen and in hidden tabs.
 * The cut cadence is the owner's: `nextDelay()` is asked after every cut, `cut()` forces one.
 */
export function ClipDeck({ clips, still, nextDelay, cleanChance = 0.28, onClean, onShow, onCut, onApi }: Props) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const cb = useRef({ nextDelay, onClean, onShow, onCut, onApi });
  useEffect(() => {
    cb.current = { nextDelay, onClean, onShow, onCut, onApi };
  });
  const lead = clips[0];

  useEffect(() => {
    const a = aRef.current, b = bRef.current;
    if (!a || !b || clips.length === 0 || still) {
      cb.current.onShow?.(clips[0]);
      return;
    }
    const shuffle = <T,>(arr: T[]) => {
      for (let k = arr.length - 1; k > 0; k--) {
        const j = (Math.random() * (k + 1)) | 0;
        [arr[k], arr[j]] = [arr[j], arr[k]];
      }
      return arr;
    };
    // the lead stays first (its poster is the first paint); the rest shuffles, reshuffled on every lap
    const deck = [clips[0], ...shuffle(clips.slice(1))];
    let pos = -1;
    const next = () => {
      pos++;
      if (pos >= deck.length) {
        const last = deck[deck.length - 1];
        shuffle(deck);
        if (deck.length > 1 && deck[0] === last) deck.push(deck.shift()!);
        pos = 0;
      }
      return deck[pos];
    };
    const vary = (v: HTMLVideoElement) => {
      const z = 1 + Math.random() * 0.3;
      v.style.transformOrigin = `${50 + (Math.random() - 0.5) * 26}% ${50 + (Math.random() - 0.5) * 18}%`;
      v.style.transform = `scale(${z.toFixed(3)})`;
      const rate = [0.7, 0.85, 1, 1, 1, 1.25][(Math.random() * 6) | 0];
      const seek = () => {
        v.playbackRate = rate;
        if (v.duration && isFinite(v.duration)) v.currentTime = Math.random() * Math.max(0, v.duration - 2.5);
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener('loadedmetadata', seek, { once: true });
    };
    const shown = new Map<HTMLVideoElement, Clip>();
    const load = (v: HTMLVideoElement, c: Clip) => {
      shown.set(v, c);
      v.src = clipSrc(c);
      v.load();
      vary(v);
    };
    let cur = a, nxt = b, alive = true, clean = false, cutting = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (alive) fn();
      }, ms);
      timers.add(t);
      return t;
    };
    load(cur, next());
    if (clips.length > 1) load(nxt, next());
    const first = () => {
      cur.classList.add('on');
      cur.play().catch(() => undefined);
      cb.current.onShow?.(shown.get(cur)!);
    };
    cur.addEventListener('canplay', first, { once: true });

    let vis = true;
    const io = new IntersectionObserver((es) => {
      vis = es[0]?.isIntersecting ?? true;
      if (!vis) cur.pause();
      else if (cur.classList.contains('on')) cur.play().catch(() => undefined);
    });
    io.observe(a.parentElement!);
    const onVis = () => {
      if (document.hidden) cur.pause();
      else if (vis && cur.classList.contains('on')) cur.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);

    const setClean = (on: boolean) => {
      clean = on;
      cb.current.onClean?.(on);
    };
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms: number) => {
      if (scheduled) {
        clearTimeout(scheduled);
        timers.delete(scheduled);
      }
      scheduled = later(cut, ms);
    };
    const cut = () => {
      if (cutting) return;
      if (clean) setClean(false);
      if (!vis || document.hidden || clips.length < 2) {
        schedule(4000);
        return;
      }
      cutting = true;
      let n = 0;
      nxt.play().catch(() => undefined);
      const flick = () => {
        const v = n % 2 ? cur : nxt;
        v.style.setProperty('--vx', `${((Math.random() - 0.5) * 48).toFixed(0)}px`);
        v.style.setProperty('--vt', `${(Math.random() * 60).toFixed(0)}%`);
        v.style.setProperty('--vb', `${(Math.random() * 30).toFixed(0)}%`);
        v.classList.add('glitch');
        later(() => v.classList.remove('glitch'), 55);
        if (n === 3) {
          cur.classList.remove('on');
          nxt.classList.add('on');
          const old = cur;
          cur = nxt;
          nxt = old;
          old.pause();
          load(nxt, next());
          cb.current.onShow?.(shown.get(cur)!);
          cb.current.onCut?.();
        }
        if (++n < 6) later(flick, 60 + Math.random() * 60);
        else cutting = false;
      };
      flick();
      // a clean moment: the footage plays on its own, longer, before the next cut
      if (Math.random() < cleanChance) {
        later(() => setClean(true), 500);
        schedule(6500 + Math.random() * 4500);
      } else schedule(Math.max(900, cb.current.nextDelay()));
    };
    schedule(3800);
    cb.current.onApi?.({ cut: () => cut() });

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      cb.current.onApi?.(null);
      cb.current.onClean?.(false);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      cur.removeEventListener('canplay', first);
      [a, b].forEach((v) => {
        v.pause();
        v.removeAttribute('src');
        v.load();
      });
    };
  }, [clips, cleanChance, still]);

  return (
    <div className="tbh-vids tbh-fill" data-still={still} aria-hidden="true">
      {/* the lead clip's first frame: painted by the server, so the hero is never blank (the LCP image) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clipPoster(lead)} alt="" fetchPriority="high" decoding="async" />
      <video ref={aRef} muted playsInline loop preload={still ? 'none' : 'auto'} disablePictureInPicture tabIndex={-1} />
      <video ref={bRef} muted playsInline loop preload={still ? 'none' : 'auto'} disablePictureInPicture tabIndex={-1} />
    </div>
  );
}
