'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react';

/** Per-viewer preference: go true fullscreen when START / INSERT COIN / PLAY is pressed. Default ON. */
const AUTO_FS_KEY = 'tb-auto-fullscreen';
export const readAutoFullscreen = () => {
  try {
    return localStorage.getItem(AUTO_FS_KEY) !== '0';
  } catch {
    return true;
  }
};
export const writeAutoFullscreen = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_FS_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked: the default (ON) applies */
  }
};
/** iPhone Safari has no element fullscreen; there the immersive full-viewport layout is the fullscreen. */
export const canElementFullscreen = () => typeof document !== 'undefined' && Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);

/** Provided by <GameShell>: games inside it go fullscreen on the shell (bar + stage), not their own wrapper. */
export type GameShellApi = { enter: () => void; exit: () => void; isFs: () => boolean; root: RefObject<HTMLElement | null> };
export const GameShellContext = createContext<GameShellApi | null>(null);
export const useGameShell = () => useContext(GameShellContext);

/** Phones, tablets and low-power devices: the ones where we also ask for a landscape lock. */
export const isMobileish = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Boolean(coarse) || mem <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 720;
};

type Opts = {
  /** The game is on screen (countdown / playing / paused): the wrapper should cover the viewport. */
  playing: boolean;
  /** The run ended (results / game over): leave fullscreen. */
  ended?: boolean;
  /** A payment was cancelled or failed while we were entering fullscreen from the PLAY click: leave again. */
  payFailed?: boolean;
  /** Fullscreen was left (Esc, browser UI) while playing: usually pause. */
  onLeftWhilePlaying?: () => void;
};

/**
 * Shared fullscreen behaviour for the arcade games (same logic bRacer uses): request fullscreen from the click itself,
 * lock landscape on phones (rejection swallowed), cover the viewport so site chrome is hidden, leave on game over.
 * Never throws if the browser refuses; the fixed full-viewport wrapper still covers the page.
 */
export function useGameFullscreen(wrap: RefObject<HTMLElement | null>, { playing, ended, payFailed, onLeftWhilePlaying }: Opts) {
  const shell = useGameShell();
  const shellRef = useRef(shell);
  useEffect(() => {
    shellRef.current = shell;
  });
  const [fs, setFs] = useState(false);
  const pending = useRef(false);
  const playingRef = useRef(playing);
  const leftCb = useRef(onLeftWhilePlaying);
  useEffect(() => {
    playingRef.current = playing;
    leftCb.current = onLeftWhilePlaying;
  });

  const exit = useCallback(() => {
    pending.current = false;
    if (shellRef.current) return shellRef.current.exit();
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      /* nothing to leave */
    }
  }, []);

  /** Call from inside a click handler (the user gesture). */
  const enter = useCallback(() => {
    pending.current = true;
    if (shellRef.current) return shellRef.current.enter();
    const el = wrap.current;
    if (!el || document.fullscreenElement || !el.requestFullscreen) return;
    try {
      void el
        .requestFullscreen()
        .then(() => {
          if (isMobileish()) {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            void o?.lock?.('landscape').catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } catch {
      /* not allowed here */
    }
  }, [wrap]);

  const toggle = useCallback(() => (document.fullscreenElement ? exit() : enter()), [enter, exit]);

  useEffect(() => {
    const on = () => {
      const target = shellRef.current?.root.current ?? wrap.current;
      const now = Boolean(document.fullscreenElement) && document.fullscreenElement === target;
      setFs(now);
      if (!now && playingRef.current) leftCb.current?.();
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [wrap]);

  useEffect(() => {
    if (playing) pending.current = false;
  }, [playing]);
  // Inside a GameShell the player chose fullscreen for the session: the game-over screen stays fullscreen.
  useEffect(() => {
    if (ended && !shellRef.current) exit();
  }, [ended, exit]);
  useEffect(() => {
    if (payFailed && pending.current && !playing) exit();
  }, [payFailed, playing, exit]);
  // Leave fullscreen if the game unmounts mid-run.
  useEffect(
    () => () => {
      if (!shellRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  return { fs, enter, exit, toggle, cover: playing || fs };
}
