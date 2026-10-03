/**
 * Arena sound effects (WebAudio, no files) and the fireball sprite. The HD art lives in
 * src/lib/arenaHD.ts (CC0 models and textures, public/arena/CREDITS.md).
 */
import * as THREE from 'three';

type Draw = (c: CanvasRenderingContext2D) => void;

function canvas(size: number, draw: Draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!);
  return cv;
}

export function pixelTexture(draw: Draw, repeat = 1, size = 64) {
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const fireballTexture = () =>
  pixelTexture((c) => {
    c.clearRect(0, 0, 16, 16);
    c.fillStyle = '#ff4400';
    c.fillRect(3, 3, 10, 10);
    c.fillStyle = '#ffaa00';
    c.fillRect(5, 5, 6, 6);
    c.fillStyle = '#ffff88';
    c.fillRect(7, 7, 2, 2);
  }, 1, 16);


// ── Sound ────────────────────────────────────────────────────────────

/** Tiny synth for retro sound effects. Create on a user gesture (browsers block audio before one). */
export function makeSfx() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ac = new Ctx();
  const master = ac.createGain();
  master.gain.value = 0.35;
  master.connect(ac.destination);

  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.5, delay = 0) => {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur);
  };
  const noise = (dur: number, vol = 0.5, cutoff = 2000) => {
    const t = ac.currentTime;
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur);
  };

  return {
    resume: () => ac.state === 'suspended' && ac.resume(),
    shoot: () => {
      tone('square', 880, 110, 0.12, 0.35);
      noise(0.08, 0.4, 3500);
    },
    hit: () => noise(0.1, 0.5, 1200),
    growl: () => tone('sawtooth', 140, 70, 0.35, 0.25),
    die: () => {
      tone('sawtooth', 300, 40, 0.6, 0.35);
      noise(0.4, 0.3, 600);
    },
    fireball: () => noise(0.35, 0.25, 900),
    hurt: () => tone('square', 160, 60, 0.2, 0.4),
    pickup: () => {
      tone('square', 520, 520, 0.08, 0.3);
      tone('square', 780, 780, 0.1, 0.3, 0.08);
    },
    dead: () => tone('triangle', 400, 30, 1.2, 0.5),
  };
}
export type Sfx = NonNullable<ReturnType<typeof makeSfx>>;
