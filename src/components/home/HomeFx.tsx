'use client';

import { useEffect } from 'react';

/**
 * Home page effects, no library: arms CSS scroll-reveal for every [data-reveal] element (they show immediately without
 * JS, or when reduced motion is on), feeds the cursor spotlight (--mx / --my) to glass panels and cards, and marks the
 * animated hero / gallery / chevron blocks data-off while off-screen so their CSS loops pause.
 */
export function HomeFx() {
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    // Phones show everything at once (owner, 26 Oct: iPhone showed big black gaps while sections waited to reveal).
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 767px), (pointer: coarse)').matches;
    let io: IntersectionObserver | undefined;
    if (!reduce && 'IntersectionObserver' in window) {
      const vh = window.innerHeight;
      // anything already on screen is revealed at once so the armed state never flashes it away
      for (const el of els) if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add('is-in');
      root.classList.add('hp-armed');
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              io?.unobserve(e.target);
            }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
      );
      for (const el of els) if (!el.classList.contains('is-in')) io.observe(el);
    }
    const move = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest<HTMLElement>('.panel, .hp-card');
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${e.clientX - r.left}px`);
      t.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    // Pause the decorative CSS loops (hero light, tape, ticker, gallery Ken Burns + scan, chevrons) while out of view.
    let off: IntersectionObserver | undefined;
    if ('IntersectionObserver' in window) {
      off = new IntersectionObserver((entries) => {
        for (const e of entries) e.target.toggleAttribute('data-off', !e.isIntersecting);
      });
      for (const el of document.querySelectorAll('.dr-hero, .hp-gal, .dr-chev-march')) off.observe(el);
    }
    return () => {
      off?.disconnect();
      io?.disconnect();
      root.classList.remove('hp-armed');
      document.removeEventListener('pointermove', move);
    };
  }, []);
  return null;
}
