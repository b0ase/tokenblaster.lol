/**
 * Mempool Invaders audio: the site's music keeps playing (src/lib/sfx.ts); this adds the game's own sound
 * effects through the shared bus and reads the music's bass (an analyser on the music buses) to give the
 * scene a beat. No music signal (muted, not unlocked yet, tab in the background) falls back to a metronome.
 */
import { getAudioPrefs, musicAnalyser, sharedAudio, sfx } from '../sfx';
import { BeatDetector } from './sim';

// Pentatonic ladder for combo kills: each kill in a chain climbs one step.
const PENTA = [0, 2, 4, 7, 9];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export type Fx = 'shot' | 'rail' | 'kill' | 'bigkill' | 'hit' | 'pickup' | 'power' | 'bomb' | 'warn' | 'bossHit' | 'bossDown' | 'shield' | 'shieldBreak' | 'wave' | 'combo' | 'breach' | 'token';

export class InvadersAudio {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private tap: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(256);
  private det = new BeatDetector();
  private lastShot = 0;
  /** Beat envelope: 1 on the beat, falling to 0. */
  env = 0;
  /** performance.now() of the last beat. */
  lastBeat = 0;
  /** Seconds in a beat. */
  get beatLen() {
    return this.det.beatLength;
  }

  start() {
    const sa = sharedAudio();
    if (!sa) return;
    this.ctx = sa.ctx;
    this.out = sa.out;
    this.tap = musicAnalyser();
    if (this.tap) this.buf = new Uint8Array(this.tap.frequencyBinCount);
    const c = sa.ctx;
    const n = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  }

  /** Call every frame. Returns true on the frame a beat lands. */
  update(dt: number, nowMs: number): boolean {
    let e = 0;
    const tap = this.tap;
    if (tap && this.ctx?.state === 'running' && !getAudioPrefs().muted) {
      tap.getByteFrequencyData(this.buf);
      // Bass: the lowest ~340 Hz (bins 0-3 at 44.1k / 512).
      e = (this.buf[0] + this.buf[1] + this.buf[2] + this.buf[3]) / (4 * 255);
    }
    const beat = this.det.feed(e, nowMs / 1000);
    if (beat) {
      this.env = 1;
      this.lastBeat = nowMs;
    } else this.env = Math.max(0, this.env - dt * 3.2);
    return beat;
  }

  /** How close `nowMs` is to a beat: 0 on it, up to half a beat away. */
  beatDistance(nowMs: number) {
    const L = this.det.beatLength * 1000;
    const since = nowMs - this.lastBeat;
    return Math.min(since, Math.abs(L - since));
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, filter = 0) {
    const c = this.ctx;
    if (!c || !this.out || getAudioPrefs().muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f).connect(g);
    } else o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private burst(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || getAudioPrefs().muted) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** `n`: combo count (kill pitch climbs the ladder) or any small variation index. */
  fx(name: Fx, n = 0) {
    const now = performance.now();
    switch (name) {
      case 'shot':
        if (now - this.lastShot < 45) return;
        this.lastShot = now;
        this.tone('sawtooth', 900 + Math.random() * 80, 220, 0.09, 0.07, 0, 3200);
        break;
      case 'rail':
        this.tone('square', 1500, 180, 0.14, 0.08, 0, 4000);
        this.burst(0.1, 0.08, 6000, 1500, 'highpass');
        break;
      case 'kill': {
        const step = Math.min(n, 24);
        const note = 69 + PENTA[step % 5] + 12 * Math.floor(step / 5);
        this.tone('square', midi(note), midi(note), 0.11, 0.07, 0, 5200);
        this.tone('triangle', midi(note - 12), midi(note - 12), 0.14, 0.12);
        this.burst(0.12, 0.12, 3000, 400, 'bandpass');
        break;
      }
      case 'bigkill':
        this.burst(0.5, 0.35, 2500, 90, 'lowpass');
        this.tone('sine', 140, 38, 0.4, 0.4);
        break;
      case 'hit':
        this.burst(0.7, 0.6, 1200, 80, 'lowpass');
        this.tone('sawtooth', 240, 45, 0.55, 0.28);
        sfx('rekt', 0.5);
        break;
      case 'pickup':
        this.tone('triangle', 660, 1320, 0.12, 0.14);
        this.tone('triangle', 990, 1980, 0.14, 0.1, 0.07);
        break;
      case 'power':
        for (let i = 0; i < 4; i++) this.tone('square', midi(64 + i * 4), midi(64 + i * 4), 0.1, 0.07, i * 0.055, 4800);
        break;
      case 'token':
        sfx('token', 0.9);
        this.tone('sine', 1760, 2640, 0.2, 0.1, 0.05);
        break;
      case 'bomb':
        this.burst(1.1, 0.7, 5000, 60, 'lowpass');
        this.tone('sine', 110, 24, 0.9, 0.6);
        this.tone('sawtooth', 60, 300, 0.4, 0.12);
        break;
      case 'warn':
        for (let i = 0; i < 3; i++) {
          this.tone('sawtooth', 220, 330, 0.28, 0.11, i * 0.4, 1800);
          this.tone('sawtooth', 330, 220, 0.28, 0.11, i * 0.4 + 0.2, 1800);
        }
        break;
      case 'bossHit':
        this.burst(0.16, 0.2, 1800, 400, 'bandpass');
        this.tone('square', 180, 90, 0.09, 0.1, 0, 1500);
        break;
      case 'bossDown':
        for (let i = 0; i < 5; i++) this.burst(0.6, 0.5, 3000 - i * 400, 60, 'lowpass', i * 0.12);
        this.tone('sine', 90, 20, 1.6, 0.7);
        for (let i = 0; i < 6; i++) this.tone('square', midi(60 + i * 3), midi(60 + i * 3), 0.16, 0.08, 0.5 + i * 0.09, 5000);
        break;
      case 'shield':
        this.tone('sine', 420, 960, 0.4, 0.16);
        this.burst(0.3, 0.1, 3000, 7000, 'highpass');
        break;
      case 'shieldBreak':
        this.burst(0.5, 0.4, 6000, 500, 'bandpass');
        this.tone('sine', 900, 120, 0.4, 0.2);
        break;
      case 'wave':
        for (let i = 0; i < 3; i++) this.tone('square', midi(57 + i * 5), midi(57 + i * 5), 0.14, 0.07, i * 0.1, 4200);
        break;
      case 'combo':
        this.tone('triangle', midi(72 + n), midi(79 + n), 0.22, 0.14);
        break;
      case 'breach':
        this.burst(0.9, 0.6, 900, 60, 'lowpass');
        this.tone('sawtooth', 300, 40, 0.9, 0.3);
        break;
    }
  }
}
