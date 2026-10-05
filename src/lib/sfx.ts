'use client';

/**
 * Shared arcade audio: procedurally synthesised SFX + a tiny step sequencer for per-game music loops.
 * Everything is generated with the Web Audio API (no samples, nothing downloaded).
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
  | 'hurt' | 'gameover' | 'level' | 'click' | 'sonar' | 'stamp' | 'pickup' | 'start';
export type Track = 'doubleo' | 'arena' | 'gun' | 'hopper' | 'invaders' | 'snake' | 'kweg' | 'frogger' | 'city';

const LS = 'tb.audio';
type Prefs = { muted: boolean; music: number; sfx: number };
let prefs: Prefs = { muted: false, music: 0.5, sfx: 0.8 };
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') loadPrefs();

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode, duckGain: GainNode;
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
  sfxBus.connect(master);
  musicBus.connect(duckGain).connect(master);
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1), ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyGains();
  return ctx;
}

/** Resume (or create) on a gesture. Safe to call often. */
export function unlockAudio() {
  const c = ensureCtx();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
  if (c && wantTrack && !seqTimer) startSeq();
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
    case 'stamp':
      noise(t, 0.12, 0.9 * v, 'lowpass', 900, 120, o);
      tone('sine', 160, 50, t, 0.15, 0.6 * v, o);
      tone('square', 1200, 1200, t + 0.13, 0.05, 0.08 * v, o);
      break;
  }
}

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
type Song = { bpm: number; lead: number[]; bass: number[]; drums: string; leadWave: OscillatorType; bassWave: OscillatorType; leadVol?: number; swing?: number };
const N = (s: string) => s.trim().split(/\s+/).map((x) => (x === '.' ? 0 : Number(x)));

const SONGS: Record<Track, Song> = {
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

export function playMusic(track: Track | null) {
  installAudio();
  if (wantTrack === track) return;
  wantTrack = track;
  stopSeq();
  if (track && ctx) startSeq();
}

/** Mount in a game component: installs the audio system, runs its music loop while mounted. */
export function useGameAudio(track: Track) {
  useEffect(() => {
    playMusic(track);
    return () => {
      if (wantTrack === track) playMusic(null);
      killMinigun();
    };
  }, [track]);
}
