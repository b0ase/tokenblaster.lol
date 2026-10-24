'use client';
/**
 * A short original loading-screen loop in the style of 80s/90s home computer games: square-wave arpeggios,
 * a pulse bass and a noise hat. It plays through the site's sound-effects bus (src/lib/sfx.ts sharedAudio),
 * so the existing mute button and volume apply. It keeps the game music ducked while it plays; on stop it
 * fades out and the game music comes back up by itself.
 *
 * Start it from a click (LOCK & LOAD is the user gesture browsers need for audio).
 */
import { duck, sharedAudio } from '@/lib/sfx';

const BPM = 150;
const STEP = 60 / BPM / 4; // 16th notes
// A minor → F → C → G, four bars, arpeggiated (MIDI note numbers).
const CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [48, 52, 55, 60],
  [55, 59, 62, 67],
];
const BASS = [45, 41, 36, 43];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

let timer: ReturnType<typeof setInterval> | null = null;
let master: GainNode | null = null;
let duckTimer: ReturnType<typeof setInterval> | null = null;

export function startChiptune() {
  if (timer) return;
  const a = sharedAudio();
  if (!a) return;
  const { ctx, out } = a;
  void ctx.resume().catch(() => undefined);
  master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.4);
  master.connect(out);
  const m = master;
  let step = 0;
  let next = ctx.currentTime + 0.05;
  const note = (type: OscillatorType, f: number, at: number, len: number, vol: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(m);
    o.start(at);
    o.stop(at + len + 0.02);
  };
  const hat = (at: number) => {
    const n = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    s.connect(g).connect(m);
    s.start(at);
  };
  // Schedule a little ahead on a timer (the usual WebAudio lookahead pattern).
  timer = setInterval(() => {
    while (next < ctx.currentTime + 0.2) {
      const bar = Math.floor(step / 16) % 4;
      const i = step % 16;
      const chord = CHORDS[bar];
      note('square', hz(chord[i % 4] + (i >= 8 ? 12 : 0)), next, STEP * 0.9, 0.06);
      if (i % 4 === 0) note('triangle', hz(BASS[bar]), next, STEP * 3.5, 0.18);
      if (i % 2 === 1) hat(next);
      next += STEP;
      step++;
    }
  }, 50);
  // Keep the game music down while the loader plays; it recovers by itself after stop.
  duck(0.15, 2.5);
  duckTimer = setInterval(() => duck(0.15, 2.5), 2000);
}

export function stopChiptune() {
  if (timer) clearInterval(timer);
  if (duckTimer) clearInterval(duckTimer);
  timer = null;
  duckTimer = null;
  const m = master;
  master = null;
  if (!m) return;
  const t = m.context.currentTime;
  m.gain.cancelScheduledValues(t);
  m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), t);
  m.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  setTimeout(() => m.disconnect(), 1000);
}
