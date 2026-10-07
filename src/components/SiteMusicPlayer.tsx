'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { initPreview, nextTrack, playNow, setPreviewEnabled, setSuppressed, setVolume, togglePause, usePreview } from '@/lib/preview';

const LS_OPEN = 'tb-player-collapsed';
/** Routes that run their own game audio / canvas: the player steps aside there. */
const isGameRoute = (p: string | null) => !!p && (/^\/arena(\/|$)/.test(p) || /^\/arcade\/[^/]+/.test(p));

const collapseSubs = new Set<() => void>();
const readCollapsed = () => {
  try {
    return localStorage.getItem(LS_OPEN) === '1';
  } catch {
    return false;
  }
};
const subCollapsed = (l: () => void) => (collapseSubs.add(l), () => void collapseSubs.delete(l));

const btn =
  'dr-code flex h-8 min-w-8 items-center justify-center border-2 border-[var(--border)] bg-[var(--panel)] px-1.5 transition-colors hover:border-[var(--hot)] hover:!text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

/**
 * Site-wide mini music player, mounted once in the root layout so it survives client-side navigation.
 * Audio lives in lib/preview.ts; this is only the UI. Hidden on game routes and in fullscreen.
 */
export function SiteMusicPlayer() {
  const s = usePreview();
  const path = usePathname();
  const game = isGameRoute(path);
  const collapsed = useSyncExternalStore(subCollapsed, readCollapsed, () => false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    initPreview();
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => setSuppressed(game), [game]);

  const toggleCollapsed = () => {
    const v = !collapsed;
    try {
      localStorage.setItem(LS_OPEN, v ? '1' : '0');
    } catch {}
    for (const l of collapseSubs) l();
  };

  if (game || full) return null;
  const wrap = 'fixed z-40 [bottom:calc(env(safe-area-inset-bottom)+12px)] [left:calc(env(safe-area-inset-left)+12px)]';
  const invite = s.enabled && s.locked; // wanted, but no activation yet
  const muted = !s.enabled;
  const audible = s.playing && !s.paused;

  if (invite && !collapsed) {
    return (
      <div className={wrap} data-music-ui>
        <button
          type="button"
          onClick={playNow}
          className="dr-code flex items-center gap-2 border-2 border-[var(--accent)] bg-[var(--panel)] px-3 py-2 !text-[var(--accent)] shadow-[4px_4px_0_var(--accent-fill)] hover:border-[var(--hot)] motion-safe:animate-pulse"
        >
          <span aria-hidden>▶</span> PLAY MUSIC
        </button>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className={wrap} data-music-ui>
        <button type="button" aria-label="Open music player" onClick={toggleCollapsed} className={`${btn} h-9 w-9 ${audible ? '!border-[var(--accent)] !text-[var(--accent)]' : ''}`}>
          <span aria-hidden>♪</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`${wrap} flex max-w-[calc(100vw-24px)] items-center gap-1.5 border-2 border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-[4px_4px_0_var(--accent-fill)]`}
      role="region"
      aria-label="Music player"
      data-music-ui
    >
      <button type="button" aria-label={audible ? 'Pause music' : 'Play music'} aria-pressed={audible} onClick={togglePause} className={btn}>
        <span aria-hidden>{audible ? '❚❚' : '▶'}</span>
      </button>
      <button type="button" aria-label="Next track" onClick={nextTrack} className={btn}>
        <span aria-hidden>▶▶</span>
      </button>
      <span className="dr-code hidden min-w-0 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap !text-[var(--muted)] sm:block" aria-live="polite">
        {s.song ? (
          <>
            <span aria-hidden>♪ </span>
            {s.song.title} — {s.song.site}
            {s.key ? ' · rollover' : ''}
          </>
        ) : (
          'TokenBlaster radio'
        )}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={s.volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        aria-label="Music volume"
        className="hidden h-1 w-16 accent-[var(--accent)] sm:block"
      />
      <button type="button" aria-label={muted ? 'Unmute music' : 'Mute music'} aria-pressed={muted} onClick={() => setPreviewEnabled(muted)} className={btn}>
        <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
      </button>
      <button type="button" aria-label="Collapse music player" onClick={toggleCollapsed} className={btn}>
        <span aria-hidden>–</span>
      </button>
    </div>
  );
}
