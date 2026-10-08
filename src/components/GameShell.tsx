'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FullscreenButton, LeaderboardButton, SoundButton, WalletBar, menuRowClass, roundBtn } from '@/components/walletbar/WalletBar';
import { BackIcon } from '@/components/walletbar/icons';
import { SiteLogo } from '@/components/SiteNav';
import { GameShellContext, canElementFullscreen, isMobileish, readAutoFullscreen, writeAutoFullscreen, type GameShellApi } from '@/lib/useGameFullscreen';

/** Buttons that start a run: pressing one (a user gesture) is when we ask for true fullscreen. */
const START_RE = /\b(start|play|insert coin|coin|race|go|launch|deal|fight|practice|new game|continue|retry|again|mission|deploy|enter|run|drive|begin|resume)\b/i;

const autoSubs = new Set<() => void>();
const subAuto = (l: () => void) => (autoSubs.add(l), () => void autoSubs.delete(l));
const subNothing = () => () => undefined;

/**
 * Fullscreen-first frame for every game page: the site chrome is hidden (globals.css, body:has([data-game-shell])),
 * a slim DR bar sits on top, the game stage fills the rest of the viewport on load, and the page text
 * (descriptions, credits, scores) sits below the fold. START / PLAY / INSERT COIN asks for real fullscreen on the
 * shell (bar + stage) when the viewer's "auto fullscreen" preference is on (default). iPhone Safari has no element
 * fullscreen, so there the immersive layout is the fullscreen.
 *
 * Games mark their root with `game-root` and the play area with `game-stage` (fills the stage) or
 * `game-stage-fit` + `--ar` (letterboxed, keeps its aspect ratio); the CSS puts the play area first.
 */
export function GameShell({ title, back = '/arcade', backLabel = 'ARCADE', below, children }: { title: string; back?: string; backLabel?: string; below?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const auto = useSyncExternalStore(subAuto, readAutoFullscreen, () => true);
  const canFs = useSyncExternalStore(subNothing, canElementFullscreen, () => true);

  useEffect(() => {
    const el = root.current;
    const on = () => setFs(Boolean(document.fullscreenElement) && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const enter = useCallback(() => {
    const el = root.current;
    if (!el || document.fullscreenElement === el) return;
    if (!el.requestFullscreen) {
      // iOS Safari: no element fullscreen. The stage already fills the viewport; make sure it is in view.
      el.scrollIntoView({ block: 'start' });
      return;
    }
    try {
      void el
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          if (isMobileish()) {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            void o?.lock?.('landscape').catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } catch {
      /* refused: the immersive layout still covers the viewport */
    }
  }, []);
  const exit = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      /* nothing to leave */
    }
  }, []);

  const api = useMemo<GameShellApi>(() => ({ enter, exit, isFs: () => Boolean(document.fullscreenElement) && document.fullscreenElement === root.current, root }), [enter, exit]);

  // Any START / PLAY / INSERT COIN style button inside the stage (or one marked data-fs-start) enters fullscreen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (!readAutoFullscreen() || document.fullscreenElement) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('[data-gs-bar]')) return;
      const b = t.closest('button, [role="button"], [data-fs-start]') as HTMLElement | null;
      if (!b || b.hasAttribute('disabled') || b.hasAttribute('data-fs-skip')) return;
      if (b.hasAttribute('data-fs-start') || START_RE.test(b.textContent ?? '') || START_RE.test(b.getAttribute('aria-label') ?? '')) enter();
    };
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  }, [enter]);

  const flipAuto = () => {
    writeAutoFullscreen(!auto);
    for (const l of autoSubs) l();
  };

  return (
    <GameShellContext.Provider value={api}>
      <div data-game-shell className="gs-shell">
        <div ref={root} className="gs-root">
          {/* Owner, 8 Oct 2026: the game bar is drawn to bWalletX's side-panel header too (components/walletbar). */}
          <header data-gs-bar className="gs-bar">
            <WalletBar
              sticky={false}
              label="Game"
              logo={<SiteLogo />}
              title={title}
              tools={
                <>
                  <Link href={back} className={roundBtn} aria-label={`Back to ${backLabel.toLowerCase()}`} title={`Back to ${backLabel.toLowerCase()}`}>
                    <BackIcon size={16} />
                  </Link>
                  <LeaderboardButton />
                  <SoundButton />
                  {canFs && <FullscreenButton on={fs} onToggle={() => (fs ? exit() : enter())} />}
                </>
              }
              menu={
                <>
                  <Link href={back} role="menuitem" className={menuRowClass}>
                    &lt; {backLabel}
                  </Link>
                  {canFs && (
                    <label className={`${menuRowClass} cursor-pointer`} title="Go fullscreen automatically when you press START">
                      <input type="checkbox" checked={auto} onChange={flipAuto} className="h-3.5 w-3.5 accent-[#F5B800]" />
                      Auto fullscreen on START
                    </label>
                  )}
                  <Link href="/arcade" role="menuitem" className={menuRowClass}>
                    All games
                  </Link>
                </>
              }
            />
          </header>
          <div className="gs-stage">{children}</div>
        </div>
        {below && (
          <div className="gs-below mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
            <p className="text-center text-[11px] uppercase tracking-widest text-dim" aria-hidden>
              ▼ scores, info and credits
            </p>
            {below}
          </div>
        )}
      </div>
    </GameShellContext.Provider>
  );
}
