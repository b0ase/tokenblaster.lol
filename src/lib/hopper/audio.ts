/** Block Hopper one-shots that the shared sfx set doesn't have, synthesised on the shared bus (respects mute and volume). */
import { sfx, sharedAudio, duck } from '@/lib/sfx';

type Voice = 'dash' | 'walljump' | 'land' | 'checkpoint' | 'combo' | 'warn' | 'slide' | 'life';

const last: Partial<Record<Voice, number>> = {};

function tone(a: { ctx: AudioContext; out: AudioNode }, type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) {
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0003, vol), at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.out);
  o.start(at);
  o.stop(at + dur + 0.03);
}

function hiss(a: { ctx: AudioContext; out: AudioNode }, at: number, dur: number, vol: number, f0: number, f1: number) {
  const n = Math.floor(a.ctx.sampleRate * dur);
  const buf = a.ctx.createBuffer(1, n, a.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = a.ctx.createBufferSource();
  s.buffer = buf;
  const f = a.ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(a.out);
  s.start(at);
}

export function hop(v: Voice, amt = 1) {
  const a = sharedAudio();
  if (!a || a.ctx.state !== 'running') return;
  const t = a.ctx.currentTime;
  if (t - (last[v] ?? -1) < 0.05) return;
  last[v] = t;
  switch (v) {
    case 'dash':
      hiss(a, t, 0.22, 0.5, 1800, 5200);
      tone(a, 'sawtooth', 220, 880, t, 0.14, 0.09);
      break;
    case 'walljump':
      tone(a, 'square', 330, 660, t, 0.1, 0.08);
      hiss(a, t, 0.1, 0.25, 900, 2400);
      break;
    case 'land':
      tone(a, 'sine', 120 + 40 * amt, 55, t, 0.12, 0.2 * Math.min(1, amt));
      hiss(a, t, 0.08, 0.14 * Math.min(1, amt), 600, 200);
      break;
    case 'slide':
      hiss(a, t, 0.06, 0.08, 2400, 1800);
      break;
    case 'combo':
      tone(a, 'square', 523 * (1 + 0.12 * amt), 1046 * (1 + 0.12 * amt), t, 0.12, 0.07);
      tone(a, 'triangle', 784 * (1 + 0.12 * amt), 1568 * (1 + 0.12 * amt), t + 0.05, 0.14, 0.06);
      break;
    case 'life':
      [659, 880, 1175, 1568].forEach((f, i) => tone(a, 'triangle', f, f, t + i * 0.07, 0.16, 0.08));
      break;
    case 'warn':
      tone(a, 'sawtooth', 90, 70, t, 0.35, 0.1);
      break;
    case 'checkpoint': {
      duck(0.3, 1.6);
      // A rising stacked fanfare.
      [392, 523, 659, 784, 1046].forEach((f, i) => {
        tone(a, 'square', f, f, t + i * 0.07, 0.3, 0.07);
        tone(a, 'triangle', f / 2, f / 2, t + i * 0.07, 0.3, 0.1);
      });
      tone(a, 'sawtooth', 1046, 1046, t + 0.4, 0.8, 0.06);
      hiss(a, t, 0.9, 0.18, 400, 6000);
      break;
    }
  }
}

export { sfx };
