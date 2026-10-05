'use client';

/**
 * The shared sound control for every game: global mute (also the M key), a now-playing chip that
 * opens the music player (station, track list, prev/next, progress, volumes), and a banner that
 * announces each new song.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  STATIONS,
  getAudioPrefs,
  getNowPlaying,
  getPlaylist,
  getProgress,
  getStation,
  installAudio,
  playSong,
  prevTrack,
  setStation,
  setVolumes,
  skipTrack,
  subscribeAudio,
  toggleMute,
  unlockAudio,
  useGameAudio,
  type Song,
  type Track,
} from '@/lib/sfx';

const DEFAULTS = { muted: false, music: 0.5, sfx: 0.8 };
const server = () => DEFAULTS;
const noSong = () => null;
const noStation = () => null;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Progress() {
  const [p, setP] = useState({ t: 0, d: 0 });
  useEffect(() => {
    const id = setInterval(() => setP(getProgress()), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[10px] text-white/60">
      <span>{mmss(p.t)}</span>
      <div className="h-1 flex-1 bg-white/15">
        <div className="h-full bg-fg" style={{ width: p.d ? `${(p.t / p.d) * 100}%` : '0%' }} />
      </div>
      <span>{p.d ? mmss(p.d) : '--:--'}</span>
    </div>
  );
}

/** Big "now playing" card for a few seconds whenever the song changes. */
function NowPlayingBanner({ song }: { song: Song | null }) {
  const [shown, setShown] = useState<Song | null>(null);
  useEffect(() => {
    if (!song) return;
    void Promise.resolve().then(() => setShown(song));
    const id = setTimeout(() => setShown(null), 4500);
    return () => clearTimeout(id);
  }, [song]);
  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[70] -translate-x-1/2 border border-[var(--border)] bg-black/85 px-4 py-2 text-center shadow-[0_0_24px_rgba(255,90,72,0.25)]">
      <p className="text-[10px] tracking-widest text-dim">NOW PLAYING</p>
      <p className="text-base font-bold text-hot">♪ {shown.title}</p>
      <p className="text-xs text-accent">{shown.site}</p>
    </div>
  );
}

const playPause = () => {
  installAudio();
  unlockAudio();
  toggleMute();
};

export function SoundToggle({ className = '' }: { className?: string }) {
  const p = useSyncExternalStore(subscribeAudio, getAudioPrefs, server);
  const now = useSyncExternalStore(subscribeAudio, getNowPlaying, noSong);
  const station = useSyncExternalStore(subscribeAudio, getStation, noStation);
  const [open, setOpen] = useState(false);
  const list = open ? getPlaylist() : [];
  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`}>
      <NowPlayingBanner song={p.muted ? null : now} />
      {now && !p.muted && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="max-w-[40vw] overflow-hidden text-ellipsis whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-left text-[10px] leading-tight text-white/80 hover:text-white" title="Open the music player">
            ♪ {now.title} <span className="text-white/45">· {now.site}</span>
          </button>
          <button type="button" onClick={skipTrack} className="btn px-1.5 py-0.5 text-xs" aria-label="Next track" title="Next track">
            ⏭
          </button>
        </>
      )}
      <button type="button" onClick={playPause} className="btn px-2 py-0.5 text-xs" title={p.muted ? 'Sound off (M)' : 'Sound on (M)'} aria-label={p.muted ? 'Unmute sound' : 'Mute sound'}>
        {p.muted ? '🔇' : '🔊'}
      </button>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn px-1.5 py-0.5 text-xs" aria-label="Music player" title="Music player">
        ♫
      </button>
      {open && (
        <span className="inset absolute bottom-full right-0 z-50 mb-1 flex w-72 max-w-[90vw] flex-col gap-2 bg-black/95 p-3 text-xs">
          <span className="flex items-center justify-between">
            <span className="font-bold tracking-widest text-hot">MUSIC PLAYER</span>
            <button type="button" onClick={() => setOpen(false)} className="text-dim hover:text-hot" aria-label="Close">
              ✕
            </button>
          </span>
          <span className="flex flex-col gap-1 border border-[var(--border-dim)] p-2">
            <span className="text-[10px] tracking-widest text-dim">{p.muted ? 'PAUSED' : now ? 'NOW PLAYING' : 'STARTING…'}</span>
            <span className="text-sm font-bold text-hot">{now ? now.title : '—'}</span>
            <span className="text-accent">{now?.site ?? ''}</span>
            <Progress />
            <span className="flex justify-center gap-1">
              <button type="button" onClick={prevTrack} className="btn px-3 py-1" aria-label="Previous track" title="Previous">
                ⏮
              </button>
              <button type="button" onClick={playPause} className="btn px-3 py-1" aria-label={p.muted ? 'Play' : 'Pause'} title={p.muted ? 'Play' : 'Pause'}>
                {p.muted ? '▶' : '⏸'}
              </button>
              <button type="button" onClick={skipTrack} className="btn px-3 py-1" aria-label="Next track" title="Next">
                ⏭
              </button>
            </span>
          </span>
          <label className="flex items-center justify-between gap-2">
            <span className="text-dim">station</span>
            <select value={station ?? ''} onChange={(e) => setStation(e.target.value as Track)} className="flex-1 border border-[var(--border-dim)] bg-input px-1 py-0.5 text-hot">
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <span className="flex max-h-48 flex-col overflow-auto">
            {list.map((s) => (
              <button key={s.src} type="button" onClick={() => playSong(s)} className={`overflow-hidden text-ellipsis whitespace-nowrap px-1 py-0.5 text-left hover:bg-[var(--active-bg)] ${now?.src === s.src ? 'font-bold text-hot' : 'text-white/75'}`}>
                {now?.src === s.src ? '▶ ' : ''}
                {s.title} <span className="text-white/40">· {s.site}</span>
              </button>
            ))}
          </span>
          <label className="flex items-center gap-2">
            <span className="w-8 text-dim">music</span>
            <input aria-label="Music volume" className="flex-1" type="range" min={0} max={1} step={0.05} value={p.music} onChange={(e) => setVolumes({ music: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-8 text-dim">sfx</span>
            <input aria-label="Sound effects volume" className="flex-1" type="range" min={0} max={1} step={0.05} value={p.sfx} onChange={(e) => setVolumes({ sfx: Number(e.target.value) })} />
          </label>
        </span>
      )}
    </span>
  );
}

/** Drop into a game: runs its music loop while mounted and floats the sound control bottom-right. */
export function GameAudio({ track }: { track: Track }) {
  useGameAudio(track);
  return <SoundToggle className="fixed bottom-3 right-3 z-[60]" />;
}
