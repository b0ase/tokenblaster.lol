/** Procedural rally audio through the shared sfx bus: engine, gravel roar, tyre squeal, wind, nitro. */
import { sharedAudio } from '@/lib/sfx';

export class RallyAudio {
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private o3!: OscillatorNode;
  private eng!: GainNode;
  private lp!: BiquadFilterNode;
  private roar!: GainNode;
  private roarF!: BiquadFilterNode;
  private squeal!: GainNode;
  private squealF!: BiquadFilterNode;
  private wind!: GainNode;
  private windF!: BiquadFilterNode;
  private nit!: GainNode;
  private ok = false;
  start() {
    const sa = sharedAudio();
    if (!sa || this.ok) return;
    const { ctx, out } = sa;
    this.ctx = ctx;
    const mk = <T extends AudioNode>(n: T) => (this.nodes.push(n), n);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = (f: number, type: BiquadFilterType, q = 0.8) => {
      const s = mk(ctx.createBufferSource());
      s.buffer = noiseBuf;
      s.loop = true;
      const fl = mk(ctx.createBiquadFilter());
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = mk(ctx.createGain());
      g.gain.value = 0;
      s.connect(fl).connect(g).connect(out);
      s.start();
      return { g, fl };
    };
    // Engine: two saws + a square sub through a lowpass.
    this.lp = mk(ctx.createBiquadFilter());
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 600;
    this.lp.Q.value = 3;
    this.eng = mk(ctx.createGain());
    this.eng.gain.value = 0;
    const mkOsc = (type: OscillatorType) => {
      const o = mk(ctx.createOscillator());
      o.type = type;
      o.frequency.value = 50;
      o.start();
      return o;
    };
    this.o1 = mkOsc('sawtooth');
    this.o2 = mkOsc('sawtooth');
    this.o3 = mkOsc('square');
    const g1 = mk(ctx.createGain());
    g1.gain.value = 0.5;
    const g2 = mk(ctx.createGain());
    g2.gain.value = 0.35;
    const g3 = mk(ctx.createGain());
    g3.gain.value = 0.5;
    this.o1.connect(g1).connect(this.lp);
    this.o2.connect(g2).connect(this.lp);
    this.o3.connect(g3).connect(this.lp);
    this.lp.connect(this.eng).connect(out);
    const r = noiseSrc(700, 'bandpass', 0.6);
    this.roar = r.g;
    this.roarF = r.fl;
    const q = noiseSrc(2300, 'bandpass', 6);
    this.squeal = q.g;
    this.squealF = q.fl;
    const w = noiseSrc(900, 'highpass', 0.3);
    this.wind = w.g;
    this.windF = w.fl;
    const n = noiseSrc(1500, 'bandpass', 0.7);
    this.nit = n.g;
    this.ok = true;
  }
  update(p: { rpm: number; throttle: number; speed: number; surf: number; skid: number; slide: number; nitro: boolean; air: boolean; on: boolean }) {
    if (!this.ok || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 34 + p.rpm * 150;
    for (const [o, m] of [[this.o1, 1], [this.o2, 1.005], [this.o3, 0.5]] as [OscillatorNode, number][]) o.frequency.setTargetAtTime(f * m, t, 0.03);
    this.lp.frequency.setTargetAtTime(280 + p.rpm * 1100 + p.throttle * 700, t, 0.05);
    const vol = p.on ? 0.1 + 0.16 * p.throttle + 0.06 * p.rpm : 0;
    this.eng.gain.setTargetAtTime(p.air ? vol * 0.6 : vol, t, 0.06);
    const sp = Math.min(1, p.speed / 40);
    const loose = p.surf === 0 ? 0.55 : 1;
    this.roar.gain.setTargetAtTime(p.on && !p.air ? (0.04 + 0.22 * sp) * loose : 0, t, 0.08);
    this.roarF.frequency.setTargetAtTime(350 + sp * 900, t, 0.1);
    this.squeal.gain.setTargetAtTime(p.on && !p.air ? Math.min(0.1, p.skid * 0.1 * Math.min(1, p.speed / 12)) : 0, t, 0.05);
    this.squealF.frequency.setTargetAtTime(1900 + p.slide * 900, t, 0.08);
    this.wind.gain.setTargetAtTime(p.on ? sp * sp * 0.09 : 0, t, 0.15);
    this.windF.frequency.setTargetAtTime(500 + sp * 1800, t, 0.2);
    this.nit.gain.setTargetAtTime(p.on && p.nitro ? 0.16 : 0, t, 0.05);
  }
  stop() {
    this.ok = false;
    for (const n of this.nodes) {
      try {
        if ('stop' in n) (n as OscillatorNode).stop();
      } catch {
        /* already stopped */
      }
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes = [];
  }
}
