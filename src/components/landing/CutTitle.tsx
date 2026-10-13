'use client';

import { useEffect, useRef, useState } from 'react';
import { hit } from './hits';

/** One title phrase: plain runs and `hot` (house red) runs; `wordmark` = TokenBlaster.lol in the logotype face. */
export type Phrase = { parts: (string | { hot: string })[]; wordmark?: boolean };
export const WORDMARK: Phrase = { parts: [], wordmark: true };

export type TitleApi = {
  /** Cut to the next phrase now. */
  bump: () => void;
};

const LOOKS = ['l-solid', 'l-line', 'l-wide', 'l-slab', 'l-solid', 'l-slab'] as const;

/**
 * The headline as a cut cycle: one phrase at a time in the DR display face (Barlow Condensed 900 italic), the
 * TokenBlaster wordmark in the logotype face when its turn comes. Every 5-9 s a hard glitch cut (clip-path band +
 * offset flicks) swaps the phrase and the look: solid / hairline outline / wide-tracked / paper slab. `dynamic()` can
 * hand in a phrase of the moment (the clip on screen, a block). Flat colour only. Reduced motion: the first phrase, still.
 * Server-rendered with the first phrase, so the headline is in the HTML.
 */
export function CutTitle({ phrases, dynamic, reduce, onApi, className = '' }: { phrases: Phrase[]; dynamic?: () => Phrase | null; reduce: boolean; onApi?: (api: TitleApi | null) => void; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [p, setP] = useState<Phrase>(phrases[0]);
  const [look, setLook] = useState(0);
  const cb = useRef({ dynamic, onApi, phrases });
  useEffect(() => {
    cb.current = { dynamic, onApi, phrases };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    let i = 0, k = 0, alive = true, cutting = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (alive) fn();
      }, ms);
      timers.add(t);
      return t;
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
      if (cutting) {
        schedule(1200);
        return;
      }
      if (document.hidden) {
        schedule(3000);
        return;
      }
      cutting = true;
      let n = 0;
      const flick = () => {
        el.style.setProperty('--gx', `${((Math.random() - 0.5) * 22).toFixed(0)}px`);
        el.style.setProperty('--gt', `${(Math.random() * 60).toFixed(0)}%`);
        el.style.setProperty('--gb', `${(Math.random() * 40).toFixed(0)}%`);
        el.classList.toggle('g-on', n % 2 === 0);
        if (n === 0) hit('tick');
        if (n === 2) {
          k = (k + 1) % LOOKS.length;
          const list = cb.current.phrases;
          const dyn = Math.random() < 0.35 ? cb.current.dynamic?.() : null;
          if (!dyn) i = (i + 1) % list.length;
          setP(dyn ?? list[i]);
          setLook(k);
        }
        if (++n < 6) later(flick, 60 + Math.random() * 70);
        else {
          el.classList.remove('g-on');
          cutting = false;
        }
      };
      flick();
      schedule(5000 + Math.random() * 4000);
    };
    schedule(3200);
    cb.current.onApi?.({ bump: () => cut() });
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      el.classList.remove('g-on');
      cb.current.onApi?.(null);
    };
  }, [reduce]);

  const label = p.wordmark ? 'TokenBlaster.lol' : p.parts.map((x) => (typeof x === 'string' ? x : x.hot)).join('');
  return (
    <h1 ref={ref} className={`tbh-title dr-display ${p.wordmark ? 'wordmark ' : ''}${LOOKS[look]} ${className}`} aria-label={label}>
      {p.wordmark ? (
        <>
          Token<span className="hot">Blaster</span>
          <span className="tld">.lol</span>
        </>
      ) : (
        p.parts.map((x, n) =>
          typeof x === 'string' ? (
            <span key={n}>{x}</span>
          ) : (
            <span key={n} className="hot">
              {x.hot}
            </span>
          ),
        )
      )}
    </h1>
  );
}
