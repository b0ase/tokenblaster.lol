'use client';

import { useEffect, useRef } from 'react';

/**
 * A number that tweens to its new value (ease-out, ~0.7s) and flashes when it changes. It writes the text node
 * directly, so a 10 Hz live feed never re-renders React. `fromZero` counts up from 0 the first time it scrolls into
 * view. Server render shows the real value; reduced motion just snaps.
 */
export function CountUp({ value, decimals = 0, fromZero = false, className = '' }: { value: number; decimals?: number; fromZero?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const raf = useRef(0);
  const armed = useRef(!fromZero);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = (from: number, to: number) => {
      cancelAnimationFrame(raf.current);
      if (reduce || from === to) {
        shown.current = to;
        el.textContent = fmt(to);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 700);
        const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
        shown.current = v;
        el.textContent = fmt(v);
        if (k < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
      el.classList.remove('hp-tick');
      void el.offsetWidth;
      el.classList.add('hp-tick');
    };
    if (!armed.current) {
      el.textContent = fmt(0);
      shown.current = 0;
      const io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) {
            armed.current = true;
            io.disconnect();
            run(0, value);
          }
        },
        { threshold: 0.3 },
      );
      io.observe(el);
      return () => io.disconnect();
    }
    run(shown.current, value);
    return () => cancelAnimationFrame(raf.current);
  }, [value, decimals]);

  return (
    <span ref={ref} suppressHydrationWarning className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}
