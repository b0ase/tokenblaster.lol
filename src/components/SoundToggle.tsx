'use client';

/** Small speaker button: global mute (also the M key) plus music / sfx volume. Shared by every game. */
import { useState, useSyncExternalStore } from 'react';
import { getAudioPrefs, installAudio, setVolumes, subscribeAudio, toggleMute, unlockAudio, useGameAudio, type Track } from '@/lib/sfx';

const DEFAULTS = { muted: false, music: 0.5, sfx: 0.8 };
const server = () => DEFAULTS;

export function SoundToggle({ className = '' }: { className?: string }) {
  const p = useSyncExternalStore(subscribeAudio, getAudioPrefs, server);
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => {
          installAudio();
          unlockAudio();
          toggleMute();
        }}
        className="btn px-2 py-0.5 text-xs"
        title={p.muted ? 'Sound off (M)' : 'Sound on (M)'}
        aria-label={p.muted ? 'Unmute sound' : 'Mute sound'}
      >
        {p.muted ? '🔇' : '🔊'}
      </button>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn px-1 py-0.5 text-xs" aria-label="Volume settings" title="Volume">
        ▾
      </button>
      {open && (
        <span className="inset absolute bottom-full right-0 z-50 mb-1 flex flex-col gap-1 bg-black/90 p-2 text-xs">
          <label className="flex items-center gap-2">
            music
            <input type="range" min={0} max={1} step={0.05} value={p.music} onChange={(e) => setVolumes({ music: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            sfx
            <input type="range" min={0} max={1} step={0.05} value={p.sfx} onChange={(e) => setVolumes({ sfx: Number(e.target.value) })} />
          </label>
        </span>
      )}
    </span>
  );
}

/** Drop into a game: runs its music loop while mounted and floats the speaker button bottom-right. */
export function GameAudio({ track }: { track: Track }) {
  useGameAudio(track);
  return <SoundToggle className="fixed bottom-3 right-3 z-[60]" />;
}
