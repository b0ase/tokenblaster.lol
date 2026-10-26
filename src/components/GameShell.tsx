'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FullscreenButton, LeaderboardButton, SoundButton, WalletBar, menuRowClass, roundBtn } from '@/components/walletbar/WalletBar';
import { BackIcon } from '@/components/walletbar/icons';
import { SiteLogo } from '@/components/SiteNav';
import { CoinOpGate } from '@/components/coinop/CoinOpGate';
import { GoLiveButton } from '@/components/GoLiveButton';
import { GameShellContext, canElementFullscreen, isMobileish, type GameShellApi } from '@/lib/useGameFullscreen';

const subNothing = () => () => undefined;

/**
 * Fullscreen-first frame for every game page: the site chrome is hidden (globals.css, body:has([data-game-shell])),
 * a slim DR bar sits on top, the game stage fills the rest of the viewport on load, and the page text
 * (descriptions, credits, scores) sits below the fold. Real fullscreen is only the bar button (the player taps it), on the
 * shell (bar + stage); nothing enters it automatically. iPhone Safari has no element
 * fullscreen, so there the immersive layout is the fullscreen.
 *
 * Games mark their root with `game-root` and the play area with `game-stage` (fills the stage) or
 * `game-stage-fit` + `--ar` (letterboxed, keeps its aspect ratio); the CSS puts the play area first.
 */
/**
 * `game`: the coin-op slug (src/lib/coinop/credit.ts PLAY_PRICE_USD). With it, the stage starts behind the coin-op
 * gate (no free play, owner 24 Oct 2026). The Shooting Gallery passes none: its loadout is its own cabinet.
 * `liveTicker`: the token room this game streams into (GO LIVE, src/lib/goLive.ts), e.g. 'TERRORNODE'.
 */
export function GameShell({ title, game, back = '/arcade', backLabel = 'ARCADE', below, lock = false, liveTicker, tabs, children }: { title: string; game?: string; liveTicker?: string; back?: string; backLabel?: string; below?: ReactNode; lock?: boolean; tabs?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
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

  // No automatic fullscreen on START / PLAY / LOCK & LOAD (owner, 25 Oct 2026: "I don't like the screen going
  // fullscreen either. It doesn't help."). The bar's fullscreen button is the only way in: the player's own tap.

  return (
    <GameShellContext.Provider value={api}>
      <div data-game-shell className={`gs-shell${lock ? ' gs-lock' : ''}`}>
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
                  {/* Phones: the bar only has room for the menu, the mode tabs and Connect (back is in the menu; scores and sound are in the game). */}
                  <span className="hidden sm:contents">
                    <Link href={back} className={roundBtn} aria-label={`Back to ${backLabel.toLowerCase()}`} title={`Back to ${backLabel.toLowerCase()}`}>
                      <BackIcon size={16} />
                    </Link>
                    {liveTicker && <GoLiveButton ticker={liveTicker} root={root} />}
                    <LeaderboardButton />
                    <SoundButton />
                  </span>
                  {canFs && <FullscreenButton on={fs} onToggle={() => (fs ? exit() : enter())} />}
                  {/* A game's own mode tabs live in the bar, not above the stage (owner, 25 Oct 2026: TERRORNODE SOLO / TEAM). */}
                  {tabs}
                </>
              }
              menu={
                <>
                  <Link href={back} role="menuitem" className={menuRowClass}>
                    &lt; {backLabel}
                  </Link>
                  <Link href="/arcade" role="menuitem" className={menuRowClass}>
                    All games
                  </Link>
                </>
              }
            />
          </header>
          <div className="gs-stage">{game ? <CoinOpGate game={game} title={title}>{children}</CoinOpGate> : children}</div>
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
