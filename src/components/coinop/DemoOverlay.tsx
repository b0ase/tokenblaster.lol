'use client';
/**
 * Demo (taste) mode, owner 28 Oct 2026: no free practice. Anyone can start a game, but a big flashing
 * "INSERT $b TO PLAY" banner sweeps across the stage the whole time. For DEMO_SECONDS the game takes input
 * (an unpaid run: nothing is charged, no score is posted). Then the demo ends: the game freezes (page
 * requestAnimationFrame loops stop) and the banner covers the stage, swallowing all input. One tap on the banner
 * goes to the cabinet (the existing credit / pay flow).
 *
 * Photosensitivity: the flash is one cycle per 1.2 s (well under 3 flashes a second, WCAG 2.3.1) and only an
 * opacity dip, not a full on/off. prefers-reduced-motion: no flash and no sweep, a steady banner (ui.css).
 */
import { useEffect, useState } from 'react';
import './ui.css';

export const DEMO_SECONDS = 20;

export function DemoOverlay({ onInsert, seconds = DEMO_SECONDS }: { onInsert: () => void; seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  const ended = left <= 0;

  useEffect(() => {
    if (ended) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, ended]);

  // Demo over: freeze the game (its rAF loop) and swallow every key and pointer event outside the banner.
  useEffect(() => {
    if (!ended) return;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    const block = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-demo-banner]')) return;
      if (e instanceof KeyboardEvent && (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') && document.activeElement?.closest('[data-demo-banner]')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const kinds = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'wheel', 'gamepadconnected'];
    kinds.forEach((k) => window.addEventListener(k, block, { capture: true, passive: false }));
    document.querySelector<HTMLButtonElement>('[data-demo-banner]')?.focus();
    return () => {
      window.requestAnimationFrame = raf;
      kinds.forEach((k) => window.removeEventListener(k, block, { capture: true }));
    };
  }, [ended]);

  return (
    <div className={`tbx-demo ${ended ? 'tbx-demo-ended' : ''}`} data-demo-overlay={ended ? 'ended' : 'live'}>
      <button type="button" data-demo-banner className="tbx-demo-banner" onClick={onInsert} aria-label="Insert $b to play: open the cabinet to add credit">
        <span className="tbx-demo-sweep" aria-hidden />
        <span className="tbx-demo-text">
          INSERT <span className="normal-case">$b</span> TO PLAY
        </span>
        <span className="tbx-demo-sub">{ended ? 'Demo over. Tap to insert $b.' : `Demo · no score · ${left}s left · tap to insert $b`}</span>
      </button>
    </div>
  );
}

/** The cabinet's secondary button: start a demo run. */
export function DemoButton({ onDemo }: { onDemo: () => void }) {
  return (
    <button type="button" data-demo-start className="btn mx-auto px-3 py-1 text-xs font-bold tracking-wider" onClick={onDemo}>
      Try a {DEMO_SECONDS}s demo (no score)
    </button>
  );
}
