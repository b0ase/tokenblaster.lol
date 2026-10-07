'use client';

/**
 * The ONE site-wide audio system for background music. <SiteMusicPlayer/> (mounted in the root layout) is the UI;
 * this module owns two reused <audio> elements that crossfade.
 *
 *  - Browsers forbid audio until a user ACTIVATION (click / tap / key). Until the first one nothing plays. The first
 *    activation anywhere unlocks both decks (synchronously, inside the gesture) and starts a shuffled playlist across
 *    all stations, unless the visitor muted earlier (remembered in localStorage).
 *  - Rollover: startPreview(key, track) crossfades to a song from that game's station; stopPreview(key) returns to the
 *    playlist after a short delay instead of silence.
 *  - Games own their audio through sfx.ts; the player suppresses itself on game routes (setSuppressed).
 *  - Tab hide pauses, tab show resumes. play() rejections are swallowed and re-arm the unlock.
 */
import { useSyncExternalStore } from 'react';
import type { Song, Track } from '@/lib/sfx';

const FADE_PREVIEW = 350;
const FADE_BED = 800;
const START_AT = 0.25; // previews start ~25% in (the punchy part)
const RETURN_DELAY = 1400;
const LS_MUTE = 'tb-preview-sound'; // '0' = muted, anything else = wanted
const LS_VOL = 'tb-preview-vol';
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Game route (last path segment) to its soundtrack station in sfx.ts. */
const GAME_TRACK: Record<string, Track> = {
  doubleosatoshi: 'doubleo',
  bsvgun: 'gun',
  arena: 'arena',
  frogger: 'frogger',
  hopper: 'hopper',
  invaders: 'invaders',
  snake: 'snake',
  kweg: 'kweg',
  rally: 'bracer',
  bracer: 'bracer',
  highway21: 'bracer',
  city: 'city',
  '2048': 'hopper',
  'bubbo-bubbo': 'invaders',
  'puzzling-potions': 'kweg',
};
export const trackFor = (href: string): Track => GAME_TRACK[href.split('/').filter(Boolean).pop() ?? ''] ?? 'hopper';

export type PreviewState = {
  /** The visitor wants music (not muted). */
  enabled: boolean;
  /** No user activation yet: nothing can play. */
  locked: boolean;
  /** Paused with the transport button (session only). */
  paused: boolean;
  /** Actually audible right now. */
  playing: boolean;
  /** A game page owns the audio. */
  suppressed: boolean;
  volume: number;
  /** Rollover key (href) while a hover preview is on air. */
  key: string | null;
  song: Song | null;
};
const SERVER: PreviewState = { enabled: true, locked: true, paused: false, playing: false, suppressed: false, volume: 0.4, key: null, song: null };
let state: PreviewState = SERVER;
const listeners = new Set<() => void>();
const set = (p: Partial<PreviewState>) => {
  state = { ...state, ...p };
  for (const l of listeners) l();
};

type Deck = { el: HTMLAudioElement; vol: number; target: number; rate: number };
const decks: Deck[] = [];
let active = -1;
let seq = 0;
let serial = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let last = 0;
let inited = false;
let unlocked = false;
let docHidden = false;
let mode: 'bed' | 'preview' = 'bed';
let pendingBed = false;
let returnTimer: ReturnType<typeof setTimeout> | null = null;
let errors = 0;

type SfxMod = typeof import('@/lib/sfx');
let lib: Promise<SfxMod> | null = null;
const loadLib = () => (lib ??= import('@/lib/sfx'));

const shouldPlay = () => unlocked && state.enabled && !state.paused && !state.suppressed && !docHidden;

function getDecks() {
  if (!decks.length) {
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'none';
      const d: Deck = { el, vol: 0, target: 0, rate: 0 };
      el.addEventListener('ended', () => {
        if (decks[active] === d) void advance();
      });
      el.addEventListener('error', () => {
        if (decks[active] !== d || !d.el.src || d.el.src.startsWith('data:')) return;
        if (++errors < 4) void advance();
        else set({ playing: false });
      });
      decks.push(d);
    }
  }
  return decks;
}

function tick() {
  const now = performance.now();
  const dt = now - last;
  last = now;
  let busy = false;
  for (const d of decks) {
    if (d.vol === d.target) continue;
    d.vol = d.vol < d.target ? Math.min(d.target, d.vol + d.rate * dt) : Math.max(d.target, d.vol - d.rate * dt);
    d.el.volume = d.vol;
    if (d.vol === 0 && d.target === 0) d.el.pause();
    else busy = true;
  }
  if (!busy && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
function fade(d: Deck, target: number, ms: number) {
  d.target = target;
  d.rate = Math.max(state.volume, 0.05) / ms;
  if (!ticker) {
    last = performance.now();
    ticker = setInterval(tick, 30);
  }
}

function hardStop() {
  for (const d of decks) {
    d.target = 0;
    d.vol = 0;
    d.el.volume = 0;
    d.el.pause();
  }
}

/** Crossfade the active deck to `song`. Synchronous so a gesture-initiated call keeps its activation. */
function crossTo(song: Song, frac: number, ms: number, as: 'bed' | 'preview') {
  const ds = getDecks();
  const next = active === 0 ? 1 : 0;
  const d = ds[next];
  const old = active >= 0 ? ds[active] : null;
  const mine = ++serial;
  d.el.pause();
  d.vol = 0;
  d.el.volume = 0;
  d.el.src = song.src;
  d.el.loop = false;
  d.el.preload = 'auto';
  if (frac > 0) {
    d.el.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(d.el.duration) && d.el.duration > 0) d.el.currentTime = d.el.duration * frac;
      },
      { once: true },
    );
  }
  let p: Promise<void> | undefined;
  try {
    p = d.el.play();
  } catch {}
  if (old && old !== d) fade(old, 0, ms);
  active = next;
  mode = as;
  errors = as === 'bed' ? errors : 0;
  set({ song, playing: true });
  fade(d, state.volume, ms);
  p?.catch((err: unknown) => {
    // Aborts come from our own src swaps; only a policy block means "locked again".
    if (mine !== serial || (err as { name?: string })?.name !== 'NotAllowedError') return;
    d.target = 0;
    unlocked = false;
    set({ locked: true, playing: false, key: null });
  });
}

// ---- playlist (shuffled across every station) ----
let queue: Song[] = [];
let qi = 0;
async function nextBed(): Promise<Song | null> {
  const { PLAYLISTS } = await loadLib();
  if (qi >= queue.length) {
    const seen = new Set<string>();
    const all: Song[] = [];
    for (const list of Object.values(PLAYLISTS)) for (const s of list) if (!seen.has(s.src)) {
        seen.add(s.src);
        all.push(s);
      }
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const prev = state.song?.src;
    if (all.length > 1 && all[0].src === prev) all.push(all.shift()!);
    queue = all;
    qi = 0;
  }
  return queue[qi++] ?? null;
}

async function startBed(ms = FADE_BED) {
  if (pendingBed) return;
  pendingBed = true;
  const mine = seq;
  try {
    const song = await nextBed();
    if (!song || mine !== seq || !shouldPlay() || state.key) return;
    crossTo(song, 0, ms, 'bed');
  } catch {
    // song list failed to load: stay silent
  } finally {
    pendingBed = false;
  }
}

async function advance() {
  if (!shouldPlay()) return;
  if (mode === 'preview' && state.key) {
    const key = state.key;
    const mine = ++seq;
    try {
      const songs = (await loadLib()).PLAYLISTS[trackFor(key)] ?? [];
      if (mine !== seq || !songs.length || !shouldPlay()) return;
      const pool = songs.filter((s) => s.src !== state.song?.src);
      crossTo((pool.length ? pool : songs)[Math.floor(Math.random() * (pool.length || songs.length))], 0, FADE_PREVIEW, 'preview');
    } catch {}
  } else void startBed();
}

/** Reconcile the decks with the state: play, resume or fade out. */
function sync() {
  if (!shouldPlay()) {
    if (docHidden) hardStop();
    else for (const d of decks) if (d.target > 0 || !d.el.paused) fade(d, 0, 400);
    if (state.playing) set({ playing: false });
    return;
  }
  const d = active >= 0 ? decks[active] : null;
  if (d && d.el.src && !d.el.src.startsWith('data:') && !d.el.ended) {
    if (d.target === 0 || d.el.paused) {
      let p: Promise<void> | undefined;
      try {
        p = d.el.play();
      } catch {}
      fade(d, state.volume, 400);
      p?.catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'NotAllowedError') return;
        unlocked = false;
        set({ locked: true, playing: false });
      });
    }
    if (!state.playing) set({ playing: true });
  } else void startBed();
}

/**
 * Bless both elements inside the activation (Safari/iOS only allow later src swaps on elements that already played),
 * then start. Safe to call repeatedly.
 */
function unlock() {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;
  for (const d of getDecks()) {
    d.el.src = SILENT;
    d.el.volume = 0;
    try {
      d.el.play()?.catch(() => {});
    } catch {}
  }
  set({ locked: false });
  sync();
}

const onGesture = (e: Event) => {
  if (unlocked) return;
  // The music controls call unlock() themselves so they can act on the first click.
  if (e.target instanceof Element && e.target.closest('[data-music-ui]')) return;
  unlock();
};

/** Call once from a client effect: reads remembered prefs, wires first-activation, tab-hide listeners. */
export function initPreview() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  let muted = false;
  let vol = 0.4;
  try {
    muted = localStorage.getItem(LS_MUTE) === '0';
    const v = parseFloat(localStorage.getItem(LS_VOL) ?? '');
    if (Number.isFinite(v)) vol = Math.min(1, Math.max(0, v));
  } catch {}
  docHidden = document.hidden;
  set({ enabled: !muted, volume: vol, locked: true });
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', onGesture, opts);
  window.addEventListener('keydown', onGesture, opts);
  window.addEventListener('touchstart', onGesture, opts);
  const vis = () => {
    docHidden = document.hidden;
    sync();
  };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('pagehide', () => {
    docHidden = true;
    sync();
  });
  window.addEventListener('pageshow', vis);
  // Already activated earlier in this tab (e.g. reload): sticky activation lets play() through.
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua?.hasBeenActive && !muted) unlock();
}

/** Mute toggle. Call from a click handler: that gesture unlocks audio. */
export function setPreviewEnabled(on: boolean) {
  try {
    localStorage.setItem(LS_MUTE, on ? '1' : '0');
  } catch {}
  unlock();
  if (!on) seq++;
  set({ enabled: on, paused: on ? false : state.paused, ...(on ? {} : { key: null }) });
  sync();
}

/** Play / pause transport. If nothing has started yet (locked or muted) this starts the music. */
export function togglePause() {
  if (!state.enabled || state.locked) return setPreviewEnabled(true);
  unlock();
  set({ paused: !state.paused });
  sync();
}

/** Start immediately (the invitation button), whatever the previous state. */
export function playNow() {
  if (!state.enabled || state.locked || state.paused) {
    setPreviewEnabled(true);
    if (state.paused) set({ paused: false });
    sync();
  }
}

export function nextTrack() {
  if (!state.enabled || state.locked || state.paused) playNow();
  seq++;
  pendingBed = false;
  if (returnTimer) clearTimeout(returnTimer);
  set({ key: null });
  if (shouldPlay()) void startBed(500);
}

export function setVolume(v: number) {
  const vol = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(LS_VOL, String(vol));
  } catch {}
  set({ volume: vol });
  for (const d of decks)
    if (d.target > 0) {
      d.target = vol;
      d.vol = vol;
      d.el.volume = vol;
    }
}

/** The player sets this on game routes (games run their own audio via sfx.ts). */
export function setSuppressed(on: boolean) {
  if (state.suppressed === on) return;
  if (on) {
    seq++;
    if (returnTimer) clearTimeout(returnTimer);
  }
  set({ suppressed: on, ...(on ? { key: null } : {}) });
  sync();
}

export async function startPreview(key: string, track: Track) {
  if (!shouldPlay() || typeof window === 'undefined') return;
  if (returnTimer) clearTimeout(returnTimer);
  if (state.key === key && mode === 'preview' && active >= 0 && decks[active]?.target > 0) return;
  const mine = ++seq;
  let songs: Song[];
  try {
    songs = (await loadLib()).PLAYLISTS[track] ?? [];
  } catch {
    return;
  }
  if (mine !== seq || !songs.length || !shouldPlay()) return;
  const cur = state.song?.src;
  const pool = songs.filter((s) => s.src !== cur);
  const list = pool.length ? pool : songs;
  set({ key });
  crossTo(list[Math.floor(Math.random() * list.length)], START_AT, FADE_PREVIEW, 'preview');
}

export function stopPreview(key?: string) {
  if (key && state.key !== key) return;
  seq++;
  set({ key: null });
  if (returnTimer) clearTimeout(returnTimer);
  if (mode !== 'preview') return;
  // Back to the playlist after a beat (a hover on the next card cancels this).
  returnTimer = setTimeout(() => {
    if (!state.key && mode === 'preview' && shouldPlay()) void startBed();
  }, RETURN_DELAY);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const usePreview = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
