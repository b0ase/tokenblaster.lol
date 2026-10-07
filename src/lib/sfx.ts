'use client';

/**
 * Shared arcade audio: procedurally synthesised SFX + per-game soundtracks.
 * Music streams real tracks from /public/music (shuffled playlist, crossfaded, routed through the
 * AudioContext so mute / music volume / ducking apply). The old procedural step-sequencer loops are
 * kept only as a fallback when a playlist's files fail to load.
 *
 * - The AudioContext is created/resumed only on a user gesture (pointer/touch/key), which also
 *   satisfies mobile Safari.
 * - One global mute (M key or <SoundToggle/>), music + sfx volumes, persisted in localStorage and
 *   shared by every game.
 * - Voices are limited (global cap + per-sound minimum interval) so rapid fire never clips or lags.
 * - Music is ducked under big sounds (explosions, game over).
 */
import { useEffect } from 'react';

export type SfxName =
  | 'shot' | 'laser' | 'coin' | 'token' | 'jump' | 'spring' | 'stomp' | 'explosion' | 'rekt' | 'hit'
  | 'hurt' | 'gameover' | 'level' | 'click' | 'sonar' | 'stamp' | 'pickup' | 'start'
  | 'shotgun' | 'beam' | 'plasma' | 'rocket' | 'grenade';
export type Track = 'doubleo' | 'arena' | 'gun' | 'hopper' | 'invaders' | 'snake' | 'kweg' | 'frogger' | 'city' | 'bracer';

const LS = 'tb.audio';
type Prefs = { muted: boolean; music: number; sfx: number };
let prefs: Prefs = { muted: false, music: 0.5, sfx: 0.8 };
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') loadPrefs();

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode, streamBus: GainNode, duckGain: GainNode;
let noiseBuf: AudioBuffer;
let installed = false;

/** Debug counters (dev only, exposed on window.__tbAudio). */
const stats = { plays: 0, dropped: 0, notes: 0 };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) prefs = { ...prefs, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* storage blocked: defaults */
  }
}
function savePrefs() {
  try {
    localStorage.setItem(LS, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}
function applyGains() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(prefs.muted ? 0 : 1, t, 0.02);
  sfxBus.gain.setTargetAtTime(prefs.sfx * 0.6, t, 0.02);
  musicBus.gain.setTargetAtTime(prefs.music * 0.32, t, 0.05);
  streamBus.gain.setTargetAtTime(prefs.music * 0.8, t, 0.05);
  syncStream();
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  duckGain = ctx.createGain();
  streamBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus.connect(duckGain).connect(master);
  streamBus.connect(duckGain);
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1), ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ctx.addEventListener('statechange', syncStream);
  applyGains();
  return ctx;
}

/** Resume (or create) on a gesture. Safe to call often. */
export function unlockAudio() {
  const c = ensureCtx();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
  if (c && wantTrack) {
    if (fallback) {
      if (!seqTimer) startSeq();
    } else if (!streaming) startStream();
    else syncStream();
    // iOS Safari only lets media start inside a gesture: kick the active deck here, not after resume().
    const d = decks[cur];
    if (streaming && d?.song && d.el.paused && !prefs.muted && prefs.music > 0 && !document.hidden) void d.el.play().catch(() => {});
  }
}

export function installAudio() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  loadPrefs();
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlockAudio, opts);
  window.addEventListener('touchend', unlockAudio, opts);
  window.addEventListener('keydown', (e) => {
    unlockAudio();
    if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    toggleMute();
  }, { capture: true });
  document.addEventListener('visibilitychange', syncStream);
  if (process.env.NODE_ENV !== 'production') {
    (window as unknown as { __tbAudio: unknown }).__tbAudio = {
      stats,
      get state() {
        return ctx?.state ?? 'none';
      },
      get track() {
        return wantTrack;
      },
      get prefs() {
        return prefs;
      },
      get now() {
        return nowPlaying;
      },
      get decks() {
        return decks.map((d) => ({ src: d.el.src, t: d.el.currentTime, paused: d.el.paused, gain: d.g.gain.value }));
      },
      get fallback() {
        return fallback;
      },
    };
  }
}

// ── Prefs API ──
export const getAudioPrefs = () => prefs;
export function subscribeAudio(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export function toggleMute() {
  prefs = { ...prefs, muted: !prefs.muted };
  applyGains();
  savePrefs();
}
export function setVolumes(v: { music?: number; sfx?: number }) {
  prefs = { ...prefs, ...v };
  applyGains();
  savePrefs();
}

/** For legacy in-component synths: route their output through the shared (mutable) sfx bus. */
export function sharedAudio(): { ctx: AudioContext; out: AudioNode } | null {
  installAudio();
  const c = ensureCtx();
  return c ? { ctx: c, out: sfxBus } : null;
}

// ── Voice limiting ──
const MAX_VOICES = 28;
const voiceEnds = new Float64Array(MAX_VOICES);
const lastAt: Partial<Record<SfxName, number>> = {};
const MIN_GAP: Partial<Record<SfxName, number>> = { shot: 0.03, laser: 0.035, hit: 0.03, coin: 0.04, token: 0.05, click: 0.02, stomp: 0.05, explosion: 0.08 };

function claimVoice(now: number, dur: number): boolean {
  for (let i = 0; i < MAX_VOICES; i++) {
    if (voiceEnds[i] <= now) {
      voiceEnds[i] = now + dur;
      return true;
    }
  }
  return false;
}

// ── Synth primitives ──
function tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number, out: AudioNode) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}
function noise(at: number, dur: number, vol: number, ftype: BiquadFilterType, f0: number, f1: number, out: AudioNode) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = ftype;
  f.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out);
  s.start(at, Math.random() * 0.5);
  s.stop(at + dur + 0.02);
}

export function duck(amount = 0.35, secs = 0.6) {
  if (!ctx) return;
  const t = ctx.currentTime;
  duckGain.gain.cancelScheduledValues(t);
  duckGain.gain.setTargetAtTime(amount, t, 0.02);
  duckGain.gain.setTargetAtTime(1, t + secs, 0.25);
}

/** Play a one-shot effect. `vol` scales it (0..1+). No-op before the first gesture or when muted. */
export function sfx(name: SfxName, vol = 1) {
  if (!ctx || ctx.state !== 'running' || prefs.muted) return;
  const now = ctx.currentTime;
  const last = lastAt[name] ?? -1;
  if (now - last < (MIN_GAP[name] ?? 0.01)) {
    stats.dropped++;
    return;
  }
  const dur = name === 'gameover' ? 1.6 : name === 'level' ? 1 : name === 'explosion' || name === 'rekt' ? 0.8 : 0.3;
  if (!claimVoice(now, dur)) {
    stats.dropped++;
    return;
  }
  lastAt[name] = now;
  stats.plays++;
  const o = sfxBus;
  const v = vol;
  const t = now + 0.005;
  switch (name) {
    case 'shot':
      noise(t, 0.09, 0.7 * v, 'bandpass', 2600, 500, o);
      tone('square', 420, 70, t, 0.08, 0.35 * v, o);
      break;
    case 'laser':
      tone('sawtooth', 1500 + Math.random() * 200, 180, t, 0.14, 0.3 * v, o);
      break;
    case 'coin':
      tone('square', 988, 988, t, 0.06, 0.22 * v, o);
      tone('square', 1319, 1319, t + 0.06, 0.18, 0.22 * v, o);
      break;
    case 'token':
      tone('triangle', 1568, 1568, t, 0.09, 0.3 * v, o);
      tone('triangle', 2093, 2093, t + 0.05, 0.09, 0.25 * v, o);
      tone('sine', 2637, 2637, t + 0.1, 0.25, 0.22 * v, o);
      tone('sine', 3136, 3136, t + 0.15, 0.2, 0.12 * v, o);
      break;
    case 'pickup':
      tone('square', 523, 523, t, 0.08, 0.25 * v, o);
      tone('square', 784, 784, t + 0.08, 0.1, 0.25 * v, o);
      break;
    case 'jump':
      tone('square', 280, 620, t, 0.14, 0.2 * v, o);
      break;
    case 'spring':
      tone('triangle', 200, 1200, t, 0.28, 0.35 * v, o);
      tone('sine', 400, 900, t + 0.04, 0.22, 0.15 * v, o);
      break;
    case 'stomp':
      tone('square', 600, 90, t, 0.12, 0.3 * v, o);
      noise(t, 0.07, 0.4 * v, 'lowpass', 1800, 400, o);
      break;
    case 'hit':
      noise(t, 0.08, 0.5 * v, 'lowpass', 2400, 800, o);
      tone('square', 300, 150, t, 0.05, 0.15 * v, o);
      break;
    case 'explosion':
      noise(t, 0.7, 0.9 * v, 'lowpass', 3000, 80, o);
      tone('sine', 120, 35, t, 0.5, 0.6 * v, o);
      duck(0.45, 0.4);
      break;
    case 'rekt':
      tone('sawtooth', 440, 55, t, 0.6, 0.3 * v, o);
      tone('square', 330, 40, t + 0.05, 0.55, 0.2 * v, o);
      noise(t, 0.35, 0.5 * v, 'lowpass', 1200, 100, o);
      duck(0.4, 0.5);
      break;
    case 'hurt':
      tone('square', 180, 70, t, 0.22, 0.35 * v, o);
      noise(t, 0.12, 0.3 * v, 'bandpass', 900, 300, o);
      break;
    case 'gameover':
      tone('square', 392, 392, t, 0.25, 0.22 * v, o);
      tone('square', 330, 330, t + 0.28, 0.25, 0.22 * v, o);
      tone('square', 262, 262, t + 0.56, 0.3, 0.22 * v, o);
      tone('triangle', 196, 98, t + 0.86, 0.7, 0.35 * v, o);
      duck(0.15, 1.8);
      break;
    case 'level':
      for (let i = 0; i < 5; i++) tone('square', [523, 659, 784, 1047, 1319][i], 0, t + i * 0.08, i === 4 ? 0.5 : 0.12, 0.2 * v, o);
      duck(0.3, 1);
      break;
    case 'click':
      tone('square', 1800, 1200, t, 0.03, 0.15 * v, o);
      break;
    case 'start':
      tone('square', 440, 440, t, 0.08, 0.2 * v, o);
      tone('square', 880, 880, t + 0.09, 0.16, 0.2 * v, o);
      break;
    case 'sonar': {
      tone('sine', 1320, 1280, t, 0.9, 0.35 * v, o);
      tone('sine', 1320, 1300, t + 0.35, 0.6, 0.1 * v, o); // echo
      break;
    }
    case 'shotgun':
      noise(t, 0.28, 1 * v, 'lowpass', 2200, 140, o);
      tone('sine', 140, 38, t, 0.22, 0.7 * v, o);
      noise(t + 0.02, 0.08, 0.5 * v, 'bandpass', 3800, 1200, o);
      break;
    case 'beam':
      tone('sine', 2400, 900, t, 0.18, 0.28 * v, o);
      tone('sawtooth', 1200, 300, t, 0.12, 0.12 * v, o);
      noise(t, 0.05, 0.25 * v, 'highpass', 6000, 3000, o);
      break;
    case 'plasma':
      tone('square', 900, 160, t, 0.16, 0.22 * v, o);
      tone('sine', 1800, 400, t, 0.12, 0.18 * v, o);
      break;
    case 'rocket':
      noise(t, 0.6, 0.6 * v, 'bandpass', 500, 1600, o);
      tone('sawtooth', 90, 220, t, 0.45, 0.2 * v, o);
      break;
    case 'grenade':
      tone('sine', 180, 60, t, 0.16, 0.6 * v, o);
      noise(t, 0.1, 0.4 * v, 'lowpass', 900, 200, o);
      break;
    case 'stamp':
      noise(t, 0.12, 0.9 * v, 'lowpass', 900, 120, o);
      tone('sine', 160, 50, t, 0.15, 0.6 * v, o);
      tone('square', 1200, 1200, t + 0.13, 0.05, 0.08 * v, o);
      break;
  }
}

/** The firing sound for an ammo type (1Sat Ordnance guns). */
export const AMMO_SFX: Record<'bullet' | 'pellet' | 'laser' | 'plasma' | 'rocket' | 'grenade', SfxName> = {
  bullet: 'shot',
  pellet: 'shotgun',
  laser: 'beam',
  plasma: 'plasma',
  rocket: 'rocket',
  grenade: 'grenade',
};

// ── Minigun (continuous, one persistent voice) ──
let mg: { spin: OscillatorNode; spinG: GainNode; rat: AudioBufferSourceNode; ratG: GainNode; ratF: BiquadFilterNode; lfo: OscillatorNode } | null = null;
/** Spin the minigun up (whine) and run its firing loop while `on`; spin down when off. */
export function minigun(on: boolean) {
  const c = ctx;
  if (!c) return;
  if (!mg && on) {
    const spin = c.createOscillator();
    spin.type = 'sawtooth';
    spin.frequency.value = 60;
    const spinF = c.createBiquadFilter();
    spinF.type = 'bandpass';
    spinF.frequency.value = 1200;
    spinF.Q.value = 2;
    const spinG = c.createGain();
    spinG.gain.value = 0;
    spin.connect(spinF).connect(spinG).connect(sfxBus);
    const rat = c.createBufferSource();
    rat.buffer = noiseBuf;
    rat.loop = true;
    const ratF = c.createBiquadFilter();
    ratF.type = 'bandpass';
    ratF.frequency.value = 1800;
    const ratG = c.createGain();
    ratG.gain.value = 0;
    // Amplitude-modulate the noise with a square LFO -> a "brrrt" at ~50 rounds/sec.
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 50;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.5;
    const am = c.createGain();
    am.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    rat.connect(ratF).connect(am).connect(ratG).connect(sfxBus);
    spin.start();
    rat.start();
    lfo.start();
    mg = { spin, spinG, rat, ratG, ratF, lfo };
  }
  if (!mg) return;
  const t = c.currentTime;
  if (on) {
    mg.spin.frequency.setTargetAtTime(220, t, 0.35);
    mg.spinG.gain.setTargetAtTime(0.12, t, 0.1);
    mg.ratG.gain.setValueAtTime(0, t);
    mg.ratG.gain.setTargetAtTime(0.55, t + 0.45, 0.05);
  } else {
    mg.ratG.gain.setTargetAtTime(0, t, 0.03);
    mg.spin.frequency.setTargetAtTime(40, t, 0.6);
    mg.spinG.gain.setTargetAtTime(0, t + 0.3, 0.4);
  }
}
function killMinigun() {
  if (!mg) return;
  try {
    mg.spin.stop();
    mg.rat.stop();
    mg.lfo.stop();
  } catch {
    /* stopped */
  }
  mg = null;
}

// ── Music sequencer ──
// Patterns are 16th-note steps. Notes are MIDI numbers, 0 = rest. Drums: k kick, s snare, h hat, o open hat.
type Loop = { bpm: number; lead: number[]; bass: number[]; drums: string; leadWave: OscillatorType; bassWave: OscillatorType; leadVol?: number; swing?: number };
const N = (s: string) => s.trim().split(/\s+/).map((x) => (x === '.' ? 0 : Number(x)));

const SONGS: Record<Track, Loop> = {
  // Original spy-surf style: twangy minor riff with chromatic slides over a driving beat.
  doubleo: {
    bpm: 140, leadWave: 'sawtooth', bassWave: 'triangle', leadVol: 0.1,
    lead: N('64 . 66 66 . 67 . 66  64 . . 63 64 . . .  64 . 66 66 . 67 . 69  71 . 69 . 67 . 66 .'),
    bass: N('40 . . 40 . . 40 .  43 . . 43 . . 42 .  40 . . 40 . . 40 .  47 . . 45 . . 43 .'),
    drums: 'k.h.s.hkk.h.s.h.k.h.s.hkk.hss.h.',
  },
  arena: {
    bpm: 150, leadWave: 'square', bassWave: 'sawtooth', leadVol: 0.07,
    lead: N('57 . . 60 . . 64 .  62 . 60 . 59 . 60 .  57 . . 60 . . 65 .  64 . 62 . 60 . 59 .'),
    bass: N('33 33 45 33 33 45 33 45  36 36 48 36 36 48 36 48  29 29 41 29 29 41 29 41  31 31 43 31 31 43 31 43'),
    drums: 'k.hkskh.k.hksk.sk.hkskh.k.hkssss',
  },
  gun: {
    bpm: 128, leadWave: 'sawtooth', bassWave: 'sawtooth', leadVol: 0.06,
    lead: N('69 . . . 72 . . . 76 . . . 74 . 72 .  69 . . . 72 . . . 79 . . . 76 . . .'),
    bass: N('45 . 45 . 45 . 45 .  45 . 45 . 45 . 45 .  41 . 41 . 41 . 41 .  43 . 43 . 43 . 43 .'),
    drums: 'k.h.s.h.k.h.s.h.k.h.s.h.k.hks.ho',
  },
  hopper: {
    bpm: 132, leadWave: 'square', bassWave: 'triangle', leadVol: 0.08,
    lead: N('72 . 76 . 79 . 76 .  77 . 74 . 71 . 74 .  72 . 76 . 79 . 84 .  83 . 79 . 76 . . .'),
    bass: N('48 . . 55 . . 48 .  43 . . 50 . . 43 .  48 . . 55 . . 48 .  43 . . 47 . . 43 .'),
    drums: 'k.h.s.h.k.hks.h.k.h.s.h.k.hks.hh',
  },
  invaders: {
    bpm: 120, leadWave: 'square', bassWave: 'square', leadVol: 0.05,
    lead: N('. . . . . . . .  . . . . . . . .  76 . . 75 . . 74 . . 73 . . . . . .'),
    bass: N('40 . . . 38 . . .  36 . . . 35 . . .  40 . . . 38 . . .  36 . . . 35 . . .'),
    drums: 'k...h...k...h...k...h...k.k.h...',
  },
  snake: {
    bpm: 116, leadWave: 'triangle', bassWave: 'square', leadVol: 0.1,
    lead: N('69 . 72 . 74 . 72 69  . . 67 . 69 . . .  69 . 72 . 76 . 74 72  . . 74 . 72 . . .'),
    bass: N('45 . . 45 . . 52 .  43 . . 43 . . 50 .  41 . . 41 . . 48 .  40 . . 40 . . 47 .'),
    drums: 'k.h.s.h.k.h.s.h.k.h.s.h.k.hhs.hh',
  },
  // Jaunty 6/8-ish shanty feel: bouncing major tune, oom-pah bass.
  kweg: {
    bpm: 118, leadWave: 'triangle', bassWave: 'triangle', leadVol: 0.13, swing: 0.18,
    lead: N('67 . 72 . 72 72 72 .  74 . 76 . 74 . 72 .  71 . 74 . 74 74 74 .  76 . 77 . 76 . 74 .  72 . 72 . 76 . 79 .  77 . 76 . 74 . 72 .  71 . 74 . 71 . 67 .  72 . . . 72 . . .'),
    bass: N('48 . 55 . 48 . 55 .  48 . 55 . 48 . 55 .  43 . 50 . 43 . 50 .  43 . 50 . 43 . 50 .  48 . 55 . 48 . 55 .  41 . 48 . 41 . 48 .  43 . 50 . 43 . 50 .  48 . 55 . 48 . . .'),
    drums: 'k...s...k...s...k...s...k..ks...',
  },
  frogger: {
    bpm: 136, leadWave: 'square', bassWave: 'triangle', leadVol: 0.08,
    lead: N('76 . 76 . 79 . 76 .  74 . 72 . 74 . . .  76 . 76 . 79 . 81 .  79 . 76 . 74 . . .'),
    bass: N('48 . 52 . 55 . 52 .  50 . 53 . 57 . 53 .  48 . 52 . 55 . 52 .  43 . 47 . 50 . 47 .'),
    drums: 'k.h.s.hkk.h.s.h.k.h.s.hkk.h.sshh',
  },
  city: {
    bpm: 104, leadWave: 'sawtooth', bassWave: 'sawtooth', leadVol: 0.06,
    lead: N('74 . . . 77 . . 76  . . 74 . . . 72 .  74 . . . 77 . . 79  . . 81 . . . . .'),
    bass: N('38 . 38 50 38 . 38 50  34 . 34 46 34 . 34 46  36 . 36 48 36 . 36 48  33 . 33 45 33 . 33 45'),
    drums: 'k..hs..hk.khs..hk..hs..hk.khs.sh',
  },
};

let wantTrack: Track | null = null;
let seqTimer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextT = 0;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function drum(ch: string, at: number) {
  const o = musicBus;
  if (ch === 'k') tone('sine', 150, 40, at, 0.18, 0.9, o);
  else if (ch === 's') {
    noise(at, 0.14, 0.45, 'highpass', 1500, 1500, o);
    tone('triangle', 220, 160, at, 0.06, 0.25, o);
  } else if (ch === 'h') noise(at, 0.035, 0.18, 'highpass', 7000, 7000, o);
  else if (ch === 'o') noise(at, 0.2, 0.18, 'highpass', 6000, 6000, o);
}

function tick() {
  const c = ctx;
  if (!c || !wantTrack) return;
  if (c.state !== 'running' || prefs.muted || prefs.music <= 0) {
    nextT = c.currentTime + 0.05;
    return;
  }
  const s = SONGS[wantTrack];
  const sp = 60 / s.bpm / 4;
  if (nextT < c.currentTime) nextT = c.currentTime + 0.05;
  while (nextT < c.currentTime + 0.12) {
    const at = nextT + (step % 2 ? (s.swing ?? 0) * sp : 0);
    const li = step % s.lead.length;
    const bi = step % s.bass.length;
    if (s.lead[li]) {
      tone(s.leadWave, mtof(s.lead[li]), mtof(s.lead[li]), at, sp * 1.8, s.leadVol ?? 0.08, musicBus);
      stats.notes++;
    }
    if (s.bass[bi]) tone(s.bassWave, mtof(s.bass[bi]), mtof(s.bass[bi]), at, sp * 1.5, 0.16, musicBus);
    const dc = s.drums[step % s.drums.length];
    if (dc && dc !== '.') drum(dc, at);
    step++;
    nextT += sp;
  }
}
function startSeq() {
  if (seqTimer || !ctx) return;
  step = 0;
  nextT = ctx.currentTime + 0.1;
  seqTimer = setInterval(tick, 25);
}
function stopSeq() {
  if (seqTimer) clearInterval(seqTimer);
  seqTimer = null;
}

// ── Streaming soundtrack ──
export type Song = { src: string; title: string; site: string };
const S = (dir: string, file: string, title: string, site: string): Song => ({ src: `/music/${dir}/${file}.m4a`, title, site });
const SPY = [
  S('doubleo', 'hidden-blade', 'Echoes of the Hidden Blade', 'VexVoid.com'),
  S('doubleo', 'silent-blade', 'Echoes of the Silent Blade', 'VexVoid.com'),
  S('doubleo', 'shadows-in-the-smoke', 'Shadows in the Smoke', 'VexVoid.com'),
  S('doubleo', 'four-ton-shadow', 'Four Ton Shadow', 'VexVoid.com'),
  S('doubleo', 'ghost-in-the-echoes', 'Ghost in the Echoes', 'VexVoid.com'),
  S('doubleo', 'shadow-steps', 'Shadow Steps', 'VexVoid.com'),
];
const PUNK = [
  S('arena', 'shibuya-mosh-pit', 'Shibuya Mosh Pit', 'NPG-X.com'),
  S('arena', 'chrome-fist', 'Chrome Fist', 'NPG-X.com'),
  S('arena', 'harajuku-chainsaw', 'Harajuku Chainsaw', 'NPG-X.com'),
  S('arena', 'akihabara-fury', 'Akihabara Fury', 'NPG-X.com'),
];
const ARCADE = [
  S('arcade', 'pixel-dreams', 'Pixel Dreams', 'ninjapunkgirls.com'),
  S('arcade', 'pxel-optik', 'P_XEL Øptik V.2', 'b0ase.com'),
  S('arcade', 'kintsugi-breaks', 'Kintsugi Breaks', 'CherryX.space'),
  S('arcade', 'shattered-frequencies', 'Shattered Frequencies', 'CherryX.space'),
];
const QUIRKY = [
  S('kweg', 'unicorn-dreamscape', 'Unicorn Dreamscape', 'ninjapunkgirls.com'),
  S('kweg', 'midnight-graffiti-symphony', 'Midnight Graffiti Symphony', 'b0ase.com'),
  S('kweg', 'echo-chamber', 'Echo Chamber', 'b0ase.com'),
];
const CITY = [
  S('city', 'veins-of-the-city', 'Toshi no Jōmyaku (Veins of the City)', 'CherryX.space'),
  S('city', 'neon-rust', 'Neon Rust', 'CherryX.space'),
  S('city', 'tokaido-reload', 'Tokaido Reload', 'NPG-X.com'),
];
/** bRacer: the fastest tracks on the site (180-196 BPM). */
const BRACER = [ARCADE[2], ARCADE[3], PUNK[2], PUNK[3], CITY[1], CITY[0], ARCADE[1]];
export const PLAYLISTS: Record<Track, Song[]> = {
  bracer: BRACER,
  doubleo: SPY, arena: PUNK, gun: PUNK, hopper: ARCADE, invaders: ARCADE, snake: ARCADE, kweg: QUIRKY, frogger: CITY, city: CITY,
};

/** Stations a player can switch to, whatever game they are in. */
export const STATIONS: { id: Track; name: string }[] = [
  { id: 'doubleo', name: 'Spy · VexVoid' },
  { id: 'arena', name: 'Punk · NPG-X' },
  { id: 'hopper', name: 'Arcade' },
  { id: 'kweg', name: 'Quirky' },
  { id: 'city', name: 'City' },
];
let station: Track | null = null; // player's pick; null = the game's own soundtrack
const playlist = () => PLAYLISTS[station ?? wantTrack ?? 'doubleo'];
export const getStation = () => station ?? wantTrack;
export const getPlaylist = () => (wantTrack ? playlist() : []);

const XFADE = 1.5;
type Deck = { el: HTMLAudioElement; g: GainNode; song: Song | null };
const decks: Deck[] = [];
let cur = 0;
let queue: Song[] = [];
let qi = -1;
let fails = 0;
let fading = false;
let streaming = false;
let fallback = false;
let preloader: HTMLAudioElement | null = null;
let nowPlaying: Song | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

export const getNowPlaying = () => nowPlaying;
function setNow(s: Song | null) {
  nowPlaying = s;
  for (const l of listeners) l();
}

function shuffle(list: Song[], avoidFirst?: Song | null): Song[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (avoidFirst && a.length > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

function makeDecks() {
  if (decks.length || !ctx) return;
  for (let i = 0; i < 2; i++) {
    const el = new Audio();
    el.preload = 'auto';
    const g = ctx.createGain();
    g.gain.value = 0;
    ctx.createMediaElementSource(el).connect(g).connect(streamBus);
    const d: Deck = { el, g, song: null };
    el.addEventListener('timeupdate', () => {
      if (decks[cur] !== d || fading || !streaming) return;
      if (Number.isFinite(el.duration) && el.duration - el.currentTime < XFADE + 0.1) advance();
    });
    el.addEventListener('ended', () => {
      if (decks[cur] === d && streaming) advance();
    });
    el.addEventListener('playing', () => {
      if (decks[cur] === d) fails = 0;
    });
    el.addEventListener('error', () => {
      if (decks[cur] !== d || !streaming || !d.el.getAttribute('src')) return;
      fails++;
      if (fails >= queue.length) {
        // Nothing in this playlist loads: fall back to the procedural loop.
        streaming = false;
        fallback = true;
        setNow(null);
        startSeq();
      } else advance(true);
    });
    decks.push(d);
  }
}

function shouldPlay() {
  return !!ctx && ctx.state === 'running' && !prefs.muted && prefs.music > 0 && !!wantTrack && typeof document !== 'undefined' && !document.hidden;
}

/** Pause/resume the active deck to match mute, volume, tab visibility and context state. */
function syncStream() {
  if (!streaming || !decks.length) return;
  const d = decks[cur];
  if (shouldPlay()) {
    if (d.el.paused && d.song) void d.el.play().catch(() => {});
  } else {
    for (const x of decks) x.el.pause();
  }
}

/** Crossfade to the next song in the queue (reshuffles when it wraps). */
function advance(immediate = false, pick?: Song) {
  if (!ctx || !wantTrack) return;
  const list = playlist();
  if (pick) {
    queue = [pick, ...shuffle(list.filter((x) => x !== pick))];
    qi = -1;
  }
  qi++;
  if (qi >= queue.length) {
    queue = shuffle(list, queue[queue.length - 1]);
    qi = 0;
  }
  const song = queue[qi];
  const old = decks[cur];
  cur = 1 - cur;
  const nd = decks[cur];
  const t = ctx.currentTime;
  const fade = immediate ? 0.05 : XFADE;
  fading = true;
  nd.song = song;
  nd.el.src = song.src;
  nd.el.currentTime = 0;
  nd.g.gain.cancelScheduledValues(t);
  nd.g.gain.setValueAtTime(0.0001, t);
  nd.g.gain.linearRampToValueAtTime(1, t + fade);
  old.g.gain.cancelScheduledValues(t);
  old.g.gain.setValueAtTime(old.g.gain.value, t);
  old.g.gain.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => {
    if (decks[cur] !== old) old.el.pause();
    fading = false;
  }, fade * 1000 + 100);
  setNow(song);
  if (shouldPlay() || (ctx.state !== 'running' && !prefs.muted && prefs.music > 0)) void nd.el.play().catch(() => {});
  // Warm the cache for the song after this one.
  const nxt = queue[qi + 1] ?? null;
  if (nxt) {
    preloader ??= new Audio();
    preloader.preload = 'auto';
    preloader.src = nxt.src;
  }
}

function startStream() {
  if (!ctx || !wantTrack || fallback) return;
  makeDecks();
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  streaming = true;
  fails = 0;
  queue = shuffle(playlist());
  qi = -1;
  advance();
}

function stopStream() {
  streaming = false;
  setNow(null);
  if (!ctx || !decks.length) return;
  const t = ctx.currentTime;
  for (const d of decks) {
    d.g.gain.cancelScheduledValues(t);
    d.g.gain.setValueAtTime(d.g.gain.value, t);
    d.g.gain.linearRampToValueAtTime(0, t + 0.4);
  }
  stopTimer = setTimeout(() => {
    for (const d of decks) d.el.pause();
  }, 450);
}

/** Skip to the next song in the current game's playlist. */
export function skipTrack() {
  unlockAudio();
  if (streaming && !fading) advance();
}

/** Back to the previous song (or the start of this one if it has played a few seconds). */
export function prevTrack() {
  unlockAudio();
  if (!streaming || fading) return;
  const d = decks[cur];
  if (d.el.currentTime > 4 || qi <= 0) {
    d.el.currentTime = 0;
    return;
  }
  qi -= 2;
  advance(true);
}

/** Play this song now (from the player's track list). */
export function playSong(song: Song) {
  unlockAudio();
  if (prefs.muted) toggleMute();
  if (streaming) advance(true, song);
}

/** Switch station (null = back to the game's own soundtrack). */
export function setStation(t: Track | null) {
  station = t === wantTrack ? null : t;
  unlockAudio();
  if (streaming) {
    queue = [];
    qi = -1;
    advance(true);
  }
  for (const l of listeners) l();
}

/** Seconds played / length of the song on air (for the progress bar). */
export function getProgress(): { t: number; d: number } {
  const d = decks[cur];
  return d && Number.isFinite(d.el.duration) ? { t: d.el.currentTime, d: d.el.duration } : { t: 0, d: 0 };
}

export function playMusic(track: Track | null) {
  installAudio();
  if (wantTrack === track) return;
  wantTrack = track;
  stopSeq();
  stopStream();
  fallback = false;
  if (track && ctx) startStream();
}

/** Mount in a game component: installs the audio system, plays its soundtrack while mounted. */
export function useGameAudio(track: Track) {
  useEffect(() => {
    playMusic(track);
    return () => {
      if (wantTrack === track) playMusic(null);
      killMinigun();
    };
  }, [track]);
}
