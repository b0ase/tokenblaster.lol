/** bRacer audio: a procedural techno soundtrack, a hover-engine, wind, boost roar and weapon sounds, through the shared sfx bus. */
import { getAudioPrefs, sharedAudio } from '@/lib/sfx';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// Minor-key bass riff (semitones above A1 = 33) and an arp, 16 steps per bar, 4 bars.
const BASS = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 3, 0, 10, 0];
const ARP = [0, 7, 12, 15, 19, 15, 12, 7];
const CHORDS = [0, 0, -2, -4];

export class HyperAudio {
  private ctx: AudioContext | null = null;
  private out!: AudioNode;
  private music!: GainNode;
  private mute!: GainNode;
  private nodes: AudioNode[] = [];
  private noiseBuf!: AudioBuffer;
  private eng!: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode };
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private boostN!: { g: GainNode; f: BiquadFilterNode };
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextT = 0;
  private bpm = 140;
  private intensity = 0;
  private playing = false;

  start() {
    const sa = sharedAudio();
    if (!sa || this.ctx) return;
    const { ctx, out } = sa;
    this.ctx = ctx;
    this.out = out;
    const mk = <T extends AudioNode>(n: T) => (this.nodes.push(n), n);
    this.music = mk(ctx.createGain());
    this.music.gain.value = 0.5;
    this.mute = mk(ctx.createGain());
    this.music.connect(this.mute).connect(out);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = (type: BiquadFilterType, f: number, q: number) => {
      const s = mk(ctx.createBufferSource());
      s.buffer = this.noiseBuf;
      s.loop = true;
      const fl = mk(ctx.createBiquadFilter());
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = mk(ctx.createGain());
      g.gain.value = 0;
      s.connect(fl).connect(g).connect(out);
      s.start();
      return { g, f: fl };
    };
    this.wind = loopNoise('bandpass', 700, 0.6);
    this.boostN = loopNoise('highpass', 1200, 0.8);
    const o1 = mk(ctx.createOscillator());
    const o2 = mk(ctx.createOscillator());
    o1.type = 'sawtooth';
    o2.type = 'triangle';
    const f = mk(ctx.createBiquadFilter());
    f.type = 'lowpass';
    f.frequency.value = 500;
    f.Q.value = 4;
    const g = mk(ctx.createGain());
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(out);
    o1.start();
    o2.start();
    this.eng = { o1, o2, g, f };
  }

  /** Begin the soundtrack (called when a race or the menu showcase starts). */
  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.nextT = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 40);
  }
  stopMusic() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const spb = 60 / this.bpm / 4;
    while (this.nextT < ctx.currentTime + 0.18) {
      this.hit(this.step, this.nextT);
      this.step++;
      this.nextT += spb;
    }
  }
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private hit(step: number, t: number) {
    const ctx = this.ctx!;
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const I = this.intensity;
    const dst = this.music;
    // Kick every beat.
    if (s16 % 4 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this.env(g, t, 0.003, 0.9, 0.22);
      o.connect(g).connect(dst);
      o.start(t);
      o.stop(t + 0.3);
      // Duck pad/bass feel via the music bus.
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setValueAtTime(0.28, t);
      this.music.gain.linearRampToValueAtTime(0.55, t + 0.2);
    }
    // Off-beat hat, 16th ghost hats, clap on 2 and 4.
    const noise = (dur: number, vol: number, hp: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      const g = ctx.createGain();
      this.env(g, t, 0.002, vol, dur);
      s.connect(f).connect(g).connect(dst);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
    };
    if (s16 % 4 === 2) noise(0.07, 0.35, 7000);
    else if (I > 0.3 && s16 % 2 === 1) noise(0.03, 0.12, 9000);
    if (s16 === 4 || s16 === 12) noise(0.16, 0.45, 1500);
    // Bass.
    const bn = BASS[s16];
    if (bn !== undefined && (s16 % 2 === 0 || bn !== 0)) {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(33 + bn + CHORDS[bar]);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900 + I * 1400, t);
      f.frequency.exponentialRampToValueAtTime(180, t + 0.14);
      f.Q.value = 6;
      this.env(g, t, 0.004, 0.32, 0.14);
      o.connect(f).connect(g).connect(dst);
      o.start(t);
      o.stop(t + 0.2);
    }
    // Arp (comes in with speed).
    if (I > 0.15 && s16 % 2 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = NOTE(57 + ARP[(s16 / 2) % 8] + CHORDS[bar]);
      this.env(g, t, 0.003, 0.05 + I * 0.07, 0.12);
      o.connect(g).connect(dst);
      o.start(t);
      o.stop(t + 0.17);
    }
  }

  /** Per-frame: speed 0..1, boosting, scrape. */
  update(speed: number, boost: boolean, scrape: boolean, active: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const prefs = getAudioPrefs();
    const t = ctx.currentTime;
    this.intensity += ((boost ? 1 : speed) - this.intensity) * 0.02;
    this.mute.gain.value = prefs.muted ? 0 : Math.min(1.4, prefs.music * 1.6);
    const on = active && !prefs.muted;
    const f = 70 + speed * 210 + (boost ? 60 : 0);
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(f * 1.505, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(380 + speed * 1500 + (boost ? 900 : 0), t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.05 + speed * 0.07 : 0, t, 0.1);
    this.wind.g.gain.setTargetAtTime(on ? speed * speed * 0.2 : 0, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(500 + speed * 1800, t, 0.1);
    this.boostN.g.gain.setTargetAtTime(on && boost ? 0.12 : scrape && on ? 0.07 : 0, t, 0.05);
    this.boostN.f.frequency.setTargetAtTime(boost ? 1800 : 3500, t, 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || getAudioPrefs().muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private burst(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || getAudioPrefs().muted) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  fx(n: 'pad' | 'cell' | 'weapon' | 'rocket' | 'mine' | 'boom' | 'shield' | 'quake' | 'turbo' | 'wall' | 'roll' | 'jump' | 'land' | 'lap' | 'hit' | 'go' | 'beep' | 'win') {
    switch (n) {
      case 'pad': this.burst(0.9, 0.5, 400, 5000, 'bandpass'); this.tone('sawtooth', 120, 600, 0.6, 0.18); break;
      case 'turbo': this.burst(1.1, 0.6, 300, 6000); this.tone('sawtooth', 90, 900, 0.9, 0.2); break;
      case 'cell': this.tone('square', 880, 1760, 0.12, 0.12); break;
      case 'weapon': this.tone('triangle', 520, 1040, 0.18, 0.2); this.tone('triangle', 780, 1560, 0.22, 0.14); break;
      case 'rocket': this.burst(0.5, 0.45, 2500, 300); this.tone('sawtooth', 300, 90, 0.4, 0.15); break;
      case 'mine': this.tone('square', 200, 120, 0.2, 0.15); break;
      case 'boom': this.burst(0.9, 0.9, 1200, 60, 'lowpass'); this.tone('sine', 120, 28, 0.7, 0.5); break;
      case 'shield': this.tone('sine', 400, 900, 0.5, 0.2); this.burst(0.4, 0.2, 3000, 6000, 'highpass'); break;
      case 'quake': this.tone('sine', 90, 24, 1.4, 0.6); this.burst(1.4, 0.6, 400, 40, 'lowpass'); break;
      case 'wall': this.burst(0.25, 0.4, 4000, 800); break;
      case 'roll': this.burst(0.5, 0.3, 1500, 4500); break;
      case 'jump': this.tone('sine', 200, 500, 0.3, 0.25); break;
      case 'land': this.burst(0.3, 0.5, 600, 80, 'lowpass'); break;
      case 'lap': this.tone('square', 660, 990, 0.3, 0.16); this.tone('square', 990, 1320, 0.35, 0.12); break;
      case 'hit': this.burst(0.6, 0.7, 900, 100, 'lowpass'); this.tone('sawtooth', 220, 50, 0.5, 0.3); break;
      case 'go': this.tone('square', 1320, 1320, 0.5, 0.22); break;
      case 'beep': this.tone('square', 660, 660, 0.18, 0.2); break;
      case 'win': for (let i = 0; i < 4; i++) setTimeout(() => this.tone('square', 523 * Math.pow(1.25, i), 523 * Math.pow(1.25, i), 0.25, 0.14), i * 120); break;
    }
  }
  stop() {
    this.stopMusic();
    for (const n of this.nodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* not a source, or already stopped */
      }
      try {
        n.disconnect();
      } catch {
        /* gone */
      }
    }
    try {
      this.eng?.o1.stop();
      this.eng?.o2.stop();
    } catch {
      /* stopped */
    }
    this.nodes = [];
    this.ctx = null;
  }
}
