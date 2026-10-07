'use client';

import { useEffect } from 'react';
import { initPreview, setPreviewEnabled, usePreview } from '@/lib/preview';

/** DR-style hero sound switch plus the now-playing ticker. Default OFF; the click is the autoplay unlock. */
export function HeroSound() {
  const s = usePreview();
  useEffect(() => initPreview(), []);
  const on = s.enabled && !s.locked && !s.paused;
  return (
    <div className="mb-3 flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        data-music-ui
        onClick={() => setPreviewEnabled(!on)}
        aria-pressed={on}
        className={`dr-code inline-flex items-center gap-1.5 border-2 px-2 py-1 transition-colors hover:border-[var(--hot)] ${
          on ? 'border-[var(--accent)] !text-[var(--accent)]' : 'border-[var(--border)]'
        } ${s.enabled && s.locked ? 'motion-safe:animate-pulse' : ''} ${!s.enabled ? 'motion-safe:animate-[pulse_2.4s_ease-in-out_3]' : ''}`}
      >
        <span aria-hidden>{on ? '🔊' : '🔇'}</span>
        {on ? 'SOUND ON' : s.enabled ? 'SOUND: CLICK TO PLAY' : 'SOUND OFF'}
      </button>
      <span className="dr-code min-w-0 max-w-full truncate !text-[var(--muted)]" aria-live="polite">
        {on && s.song ? (
          <>
            <span aria-hidden>♪ </span>now playing: {s.song.title} — {s.song.site}
          </>
        ) : on ? (
          'hover a game for its music'
        ) : (
          ''
        )}
      </span>
    </div>
  );
}
