'use client';
/**
 * Demo (taste) mode, friendly version (owner, 31 Oct 2026: the old flashing INSERT $b banner that froze the
 * whole page was "pretty rude"). Logic: src/lib/coinop/demo.ts.
 *
 *  - While the demo runs: only a small corner chip, "DEMO · 14s". It takes no clicks and covers no play.
 *    The clock waits until the run actually starts (`started`), so menus and intros do not eat it.
 *  - At 0: `onOver` lets the caller pause or stop ITS game through the game's own path, then a calm panel sits
 *    over the game stage only: Play for real / Try the demo again / Close (Escape = Close).
 *  - Never patches window.requestAnimationFrame and never blocks input outside the stage: the page, menu, nav
 *    and links keep working. A demo run pays nothing and posts no score (InsertCoin, HighScores).
 */
import { useEffect, useReducer, useRef } from 'react';
import { DEMO_SECONDS, demoChipText, demoInit, demoReduce } from '@/lib/coinop/demo';
import './ui.css';

export { DEMO_SECONDS };

export function DemoOverlay({
  started,
  onOver,
  onPlayForReal,
  onAgain,
  onClose,
  seconds = DEMO_SECONDS,
}: {
  /** True once the player's run has begun: the countdown starts then. */
  started: boolean;
  /** The demo just ended: pause / stop the game (its own path). */
  onOver: () => void;
  /** Opens the cabinet (LOCK & LOAD). Moves no money by itself. */
  onPlayForReal: () => void;
  onAgain: () => void;
  /** Back to the attract / start screen. */
  onClose: () => void;
  seconds?: number;
}) {
  const [s, dispatch] = useReducer(demoReduce, seconds, demoInit);
  const over = s.phase === 'over';

  useEffect(() => {
    if (started) dispatch('play');
  }, [started]);

  useEffect(() => {
    if (s.phase !== 'running') return;
    const t = setTimeout(() => dispatch('tick'), 1000);
    return () => clearTimeout(t);
  }, [s.phase, s.left]);

  const overRef = useRef(onOver);
  const closeRef = useRef(onClose);
  useEffect(() => {
    overRef.current = onOver;
    closeRef.current = onClose;
  });
  const playRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!over) return;
    overRef.current();
    playRef.current?.focus({ preventScroll: true });
  }, [over]);

  // Escape = Close, only while the end panel is up. A normal listener: nothing else on the page is blocked.
  useEffect(() => {
    if (!over) return;
    const kd = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [over]);

  if (!over)
    return (
      <div className="tbx-demo-chip" data-demo-chip data-demo-overlay="live" aria-hidden>
        {demoChipText(s)}
      </div>
    );

  return (
    <div className="tbx-demo-end" data-demo-overlay="ended">
      <div className="tbx-demo-panel" role="dialog" aria-modal="false" aria-labelledby="tbx-demo-title" data-demo-panel>
        <h2 id="tbx-demo-title" className="tbx-demo-title">
          Demo over. Liked it?
        </h2>
        <p className="tbx-demo-note">Load credit at the cabinet to play for real and get on the scoreboard.</p>
        <div className="tbx-demo-actions">
          <button ref={playRef} type="button" className="tbx-demo-btn tbx-demo-primary" onClick={onPlayForReal} data-demo-play>
            Play for real
          </button>
          <button type="button" className="tbx-demo-btn" onClick={onAgain} data-demo-again>
            Try the demo again
          </button>
          <button type="button" className="tbx-demo-btn tbx-demo-quiet" onClick={onClose} data-demo-close>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** After "Play for real": bring the cabinet's LOCK &amp; LOAD / START button into view and focus it. Pays nothing. */
export function focusCabinetStart() {
  let tries = 0;
  const go = () => {
    const el = document.querySelector<HTMLElement>('[data-fs-start]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    } else if (++tries < 20) setTimeout(go, 100);
  };
  setTimeout(go, 0);
}
