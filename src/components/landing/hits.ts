'use client';

/**
 * Arcade hits for the landing mix: tiny Web Audio one-shots (no files, no music) for cuts, slams, blocks and
 * flashes. Off by default; the FX toggle (a user gesture) creates the context. Remembered in localStorage.
 * Every call is a no-op while off, so the visuals never depend on sound.
 */
import { useSyncExternalStore } from 'react';

const LS = 'tb-hero-fx';
let enabled = false;
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  try {
    enabled = localStorage.getItem(LS) === '1';
  } catch {
    enabled = false;
  }
}

const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const get = () => enabled;
const server = () => false;
export const useHits = () => useSyncExternalStore(subscribe, get, server);

function ensure() {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  out = ctx.createGain();
  out.gain.value = 0.35;
  out.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Flip the hits on/off. Call from a click: the gesture unlocks the context. */
export function setHits(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(LS, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (on) {
    const c = ensure();
    if (c && c.state !== 'running') void c.resume().catch(() => undefined);
    hit('cut');
  }
  emit();
}

export type Hit = 'cut' | 'slam' | 'block' | 'flash' | 'tick';

/** One short hit. `cut`: filtered noise burst. `slam`: thud. `block`: thud + burst. `flash`: click. `tick`: faint tick. */
export function hit(kind: Hit) {
  if (!enabled || !ctx || !out || !noise || ctx.state !== 'running' || document.hidden) return;
  const t = ctx.currentTime;
  const burst = (dur: number, hz: number, q: number, vol: number) => {
    const s = ctx!.createBufferSource();
    s.buffer = noise;
    const f = ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out!);
    s.start(t);
    s.stop(t + dur + 0.02);
  };
  const thud = (hz: number, dur: number, vol: number) => {
    const o = ctx!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, hz * 0.3), t + dur);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  switch (kind) {
    case 'cut':
      burst(0.06, 1800, 0.8, 0.5);
      break;
    case 'slam':
      thud(140, 0.18, 0.7);
      burst(0.04, 3200, 1.2, 0.25);
      break;
    case 'block':
      thud(70, 0.42, 0.9);
      burst(0.12, 900, 0.6, 0.5);
      break;
    case 'flash':
      burst(0.025, 6000, 2, 0.35);
      break;
    case 'tick':
      burst(0.015, 4200, 3, 0.12);
      break;
  }
}
