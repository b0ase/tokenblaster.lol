'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

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
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      /* nothing to leave */
    }
  }, []);

  /** Call from inside a click handler (the user gesture). */
  const enter = useCallback(() => {
    const el = wrap.current;
    pending.current = true;
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
      const now = Boolean(document.fullscreenElement) && document.fullscreenElement === wrap.current;
      setFs(now);
      if (!now && playingRef.current) leftCb.current?.();
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [wrap]);

  useEffect(() => {
    if (playing) pending.current = false;
  }, [playing]);
  useEffect(() => {
    if (ended) exit();
  }, [ended, exit]);
  useEffect(() => {
    if (payFailed && pending.current && !playing) exit();
  }, [payFailed, playing, exit]);
  // Leave fullscreen if the game unmounts mid-run.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  return { fs, enter, exit, toggle, cover: playing || fs };
}
