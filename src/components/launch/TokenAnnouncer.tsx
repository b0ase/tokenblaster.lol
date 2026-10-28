'use client';

/**
 * A token page's announcer line + its own music (TOKEN_PAGE_RULES.announcer / .music).
 *  - The line tries to play on the first scroll; if the browser blocks it, on the first pointerdown, click or key.
 *  - Once per visit (sessionStorage). Fails silently: a missing file or a block never shows anything or blocks the page.
 *  - Silent when the viewer turned this speaker off, or muted the site player or the game bar.
 *  - The site music player is held silent while the line plays, then plays this page's playlist (never the site shuffle).
 *  - The small speaker covers both voice and music, saved per viewer.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { holdBed, setPagePlaylist, setPreviewEnabled } from '@/lib/preview';
import { markPlayed, setSpeaker, shouldAnnounce, siteMuted, speakerOn } from '@/lib/launch/announcer';
import type { Announcer, PageSong } from '@/lib/launch/tokenPage';

const ss = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};
const ls = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
/** Sources this browser says it can play, in the rule's order (m4a first); the next one is tried if one fails. */
const playable = (src: string[]) => {
  const probe = document.createElement('audio');
  const ok = src.filter((s) => probe.canPlayType(/\.m4a$/i.test(s) ? 'audio/mp4' : /\.mp3$/i.test(s) ? 'audio/mpeg' : '') !== '');
  return ok.length ? ok : src;
};
const onSubs = new Set<() => void>();
const subOn = (l: () => void) => (onSubs.add(l), () => void onSubs.delete(l));
const readOn = () => speakerOn(ls()) && !siteMuted(ls());
const GESTURES = ['pointerdown', 'click', 'keydown'] as const;

export function TokenAnnouncer({ tokenId, announcer, music }: { tokenId: string; announcer?: Announcer; music?: PageSong[] }) {
  const on = useSyncExternalStore(subOn, readOn, () => true);
  const el = useRef<HTMLAudioElement | null>(null);
  const disarm = useRef<() => void>(() => {});
  const srcKey = announcer?.src.join('|') ?? '';

  useEffect(() => {
    if (music?.length) setPagePlaylist(music);
    return () => setPagePlaylist(null);
  }, [music]);

  useEffect(() => {
    if (!announcer?.src.length || !shouldAnnounce(ss(), ls(), tokenId)) return;
    let done = false;
    let a: HTMLAudioElement | null = null;
    const srcs = playable(announcer.src);
    let si = 0;
    const release = () => {
      if (done) return;
      done = true;
      disarm.current();
      holdBed(false);
    };
    const tryPlay = () => {
      if (done) return;
      try {
        if (!a) {
          const au = (a = new Audio(srcs[0]));
          el.current = au;
          au.addEventListener('ended', release);
          // A source that won't decode: try the next one, else give up quietly.
          au.addEventListener('error', () => {
            if (++si >= srcs.length) return release();
            au.src = srcs[si];
            au.play()?.then(() => markPlayed(ss(), tokenId)).catch(() => release());
          });
        }
        const p = a.play();
        p?.then(() => {
          markPlayed(ss(), tokenId);
          disarm.current();
        }).catch((e: unknown) => {
          // Blocked: wait for a gesture (music can't start without one either); anything else: give up quietly.
          if ((e as { name?: string })?.name !== 'NotAllowedError') release();
        });
      } catch {
        release();
      }
    };
    holdBed(true);
    const opts = { capture: true, passive: true } as const;
    const onScroll = () => tryPlay();
    window.addEventListener('scroll', onScroll, { once: true, passive: true });
    for (const g of GESTURES) window.addEventListener(g, tryPlay, opts);
    disarm.current = () => {
      window.removeEventListener('scroll', onScroll);
      for (const g of GESTURES) window.removeEventListener(g, tryPlay, opts);
    };
    return () => {
      disarm.current();
      a?.pause();
      done = true;
      holdBed(false);
    };
    // srcKey stands in for announcer.src
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, srcKey]);

  if (!announcer && !music?.length) return null;
  const toggle = () => {
    const next = !on;
    setSpeaker(ls(), next);
    setPreviewEnabled(next);
    for (const l of onSubs) l();
    if (!next) {
      el.current?.pause();
      markPlayed(ss(), tokenId);
      holdBed(false);
    }
  };
  return (
    <button
      type="button"
      data-music-ui
      data-announcer-toggle
      onClick={toggle}
      className="btn px-2 py-0.5 text-xs"
      aria-pressed={on}
      aria-label={on ? 'Turn this page’s voice and music off' : 'Turn this page’s voice and music on'}
      title={on ? 'Voice + music on' : 'Voice + music off'}
    >
      {on ? '🔊' : '🔇'}
    </button>
  );
}
