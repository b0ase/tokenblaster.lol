'use client';

/**
 * Landing-page rollover music, arcade-cabinet style. Two reused <audio> elements crossfade (300 ms in, 400 ms out),
 * volume capped at 0.35, one track at a time, stops when the tab hides. Starts ~25% into a track (the punchy part).
 * Audio is lazy: nothing is fetched until the first preview, and the song list (sfx.ts) is imported on demand.
 * Autoplay rules: the preference is remembered, but sound only starts after the visitor has interacted; play()
 * rejections are swallowed and flip the state to "locked" so the toggle can invite a click.
 */
import { useSyncExternalStore } from 'react';
import type { Song, Track } from '@/lib/sfx';

const MAX_VOL = 0.35;
const FADE_IN = 300;
const FADE_OUT = 400;
const START_AT = 0.25;
const LS_KEY = 'tb-preview-sound';

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

export type PreviewState = { enabled: boolean; locked: boolean; key: string | null; song: Song | null };
const SERVER: PreviewState = { enabled: false, locked: false, key: null, song: null };
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
let ticker: ReturnType<typeof setInterval> | null = null;
let last = 0;
let inited = false;

function getDecks() {
  if (!decks.length) {
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'none';
      el.loop = true;
      decks.push({ el, vol: 0, target: 0, rate: 0 });
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
  d.rate = MAX_VOL / ms;
  if (!ticker) {
    last = performance.now();
    ticker = setInterval(tick, 30);
  }
}

function silenceAll(ms = FADE_OUT) {
  for (const d of decks) if (d.vol > 0 || !d.el.paused) fade(d, 0, ms);
}

function onActivation() {
  if (state.locked) set({ locked: false });
}

/** Call once from a client effect: reads the remembered preference, wires tab-hide and first-interaction listeners. */
export function initPreview() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  let on = false;
  try {
    on = localStorage.getItem(LS_KEY) === '1';
  } catch {}
  const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false;
  set({ enabled: on, locked: on && !activated });
  const hide = () => {
    seq++;
    set({ key: null, song: null });
    silenceAll(80);
  };
  document.addEventListener('visibilitychange', () => document.hidden && hide());
  window.addEventListener('pagehide', hide);
  window.addEventListener('pointerdown', onActivation, { capture: true });
  window.addEventListener('keydown', onActivation, { capture: true });
}

/** Call from a click handler: that gesture is what unlocks audio. */
export function setPreviewEnabled(on: boolean) {
  try {
    localStorage.setItem(LS_KEY, on ? '1' : '0');
  } catch {}
  if (!on) {
    seq++;
    silenceAll();
    set({ enabled: false, locked: false, key: null, song: null });
  } else set({ enabled: true, locked: false });
}

export async function startPreview(key: string, track: Track) {
  if (!state.enabled || state.locked || typeof window === 'undefined') return;
  if (state.key === key && active >= 0 && decks[active]?.target > 0) return;
  const mine = ++seq;
  let songs: Song[];
  try {
    songs = (await import('@/lib/sfx')).PLAYLISTS[track] ?? [];
  } catch {
    return;
  }
  if (mine !== seq || !songs.length) return;
  const ds = getDecks();
  const next = active === 0 ? 1 : 0;
  const song = songs[Math.floor(Math.random() * songs.length)];
  const d = ds[next];
  const old = active >= 0 ? ds[active] : null;
  d.el.pause();
  d.vol = 0;
  d.el.volume = 0;
  d.el.src = song.src;
  d.el.preload = 'auto';
  d.el.addEventListener(
    'loadedmetadata',
    () => {
      if (Number.isFinite(d.el.duration) && d.el.duration > 0) d.el.currentTime = d.el.duration * START_AT;
    },
    { once: true },
  );
  let p: Promise<void> | undefined;
  try {
    p = d.el.play();
  } catch {}
  if (old && old !== d) fade(old, 0, FADE_OUT);
  active = next;
  set({ key, song });
  fade(d, MAX_VOL, FADE_IN);
  p?.catch(() => {
    if (mine !== seq) return;
    d.target = 0;
    set({ locked: true, key: null, song: null });
  });
}

export function stopPreview(key?: string) {
  if (key && state.key !== key) return;
  seq++;
  silenceAll();
  set({ key: null, song: null });
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
