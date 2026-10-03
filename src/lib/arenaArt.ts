/**
 * Arena art and sound, all generated in the browser: pixel textures for each zone of the maze,
 * imp sprite frames (with the player's token on the chest), fireballs, medkits, and WebAudio
 * sound effects. No asset files.
 */
import * as THREE from 'three';

// ── Textures ─────────────────────────────────────────────────────────

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

const grit = (c: CanvasRenderingContext2D, amt: number, n = 700) => {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(0,0,0,${Math.random() * amt})`;
    c.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 1, 1);
  }
};

const bricks = (mortar: string, shades: string[], hi: string): Draw => (c) => {
  c.fillStyle = mortar;
  c.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 5; col++) {
      const x = col * 16 + (row % 2 ? 8 : 0) - 8;
      c.fillStyle = shades[(row * 3 + col) % shades.length];
      c.fillRect(x, row * 8, 15, 7);
      c.fillStyle = hi;
      c.fillRect(x, row * 8, 15, 1);
    }
  grit(c, 0.35);
};

const steel: Draw = (c) => {
  c.fillStyle = '#1a2a44';
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#2c4670';
  c.fillRect(2, 2, 60, 28);
  c.fillRect(2, 34, 60, 28);
  c.fillStyle = '#4a72a8';
  c.fillRect(2, 2, 60, 2);
  c.fillRect(2, 34, 60, 2);
  c.fillStyle = '#0e1828';
  for (let i = 0; i < 6; i++) c.fillRect(6 + i * 9, 10, 4, 14);
  c.fillStyle = '#7fd4ff';
  c.fillRect(8, 44, 48, 3);
  c.fillStyle = '#9ab0cc';
  [4, 58].forEach((x) => [6, 38, 26, 58].forEach((y) => c.fillRect(x, y, 2, 2)));
  grit(c, 0.3);
};

const marble: Draw = (c) => {
  c.fillStyle = '#1c4a32';
  c.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 30; i++) {
    c.strokeStyle = i % 3 ? 'rgba(120,220,160,0.18)' : 'rgba(10,30,20,0.5)';
    c.beginPath();
    let x = Math.random() * 64;
    c.moveTo(x, 0);
    for (let y = 0; y <= 64; y += 8) c.lineTo((x += (Math.random() - 0.5) * 10), y);
    c.stroke();
  }
  c.fillStyle = '#0c2418';
  c.fillRect(0, 31, 64, 2);
  c.fillRect(31, 0, 2, 64);
  grit(c, 0.25);
};

const wood: Draw = (c) => {
  for (let i = 0; i < 8; i++) {
    c.fillStyle = ['#5a3418', '#6a3e1c', '#4e2c14', '#704420'][i % 4];
    c.fillRect(i * 8, 0, 8, 64);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(i * 8, 0, 1, 64);
    for (let k = 0; k < 6; k++) {
      c.fillStyle = 'rgba(30,14,4,0.4)';
      c.fillRect(i * 8 + 2 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 64), 1, 6);
    }
  }
  c.fillStyle = '#d8a040';
  c.fillRect(0, 28, 64, 3);
  grit(c, 0.25);
};

const panel = (base: string, light: string): Draw => (c) => {
  c.fillStyle = '#141010';
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = base;
  c.fillRect(2, 2, 60, 60);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(6, 6, 52, 22);
  c.fillRect(6, 34, 24, 24);
  c.fillRect(34, 34, 24, 24);
  c.fillStyle = light;
  c.fillRect(10, 14, 44, 3);
  for (let i = 0; i < 4; i++) c.fillRect(10 + i * 12, 44, 4, 4);
  grit(c, 0.3);
};

/** One wall set per quarter of the maze, so you can tell where you are. */
export function zoneMaterials() {
  const mat = (d: Draw) => new THREE.MeshLambertMaterial({ map: pixelTexture(d) });
  return [
    { wall: mat(bricks('#2a0c08', ['#8a2818', '#7a2214', '#9a3420', '#6e1e10'], 'rgba(255,150,120,0.2)')), trim: mat(panel('#4a2a24', '#ff5a48')) },
    { wall: mat(steel), trim: mat(panel('#22344e', '#7fd4ff')) },
    { wall: mat(marble), trim: mat(panel('#1e3a2a', '#7dff9a')) },
    { wall: mat(wood), trim: mat(panel('#4a3218', '#ffcc44')) },
  ];
}

export const floorTexture = (repeat: number) =>
  pixelTexture((c) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        c.fillStyle = ['#3a2a22', '#33241d', '#2e2620', '#3a2e24'][(x + y * 3) % 4];
        c.fillRect(x * 16, y * 16, 16, 16);
        c.fillStyle = '#161010';
        c.fillRect(x * 16, y * 16, 16, 1);
        c.fillRect(x * 16, y * 16, 1, 16);
      }
    grit(c, 0.4);
  }, repeat);

export const ceilingTexture = (repeat: number) =>
  pixelTexture((c) => {
    c.fillStyle = '#1c1614';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#2a201c';
    for (let i = 0; i < 4; i++) c.fillRect(0, i * 16 + 6, 64, 4);
    grit(c, 0.4);
  }, repeat);

export const slimeTexture = () =>
  pixelTexture((c) => {
    c.fillStyle = '#2a8a1a';
    c.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 90; i++) {
      c.fillStyle = ['#5adc2a', '#1e6a10', '#8aff4a'][i % 3];
      c.fillRect(Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 4, 2);
    }
  });

// ── Sprites ──────────────────────────────────────────────────────────

export type ImpFrame = 'walk0' | 'walk1' | 'pain' | 'die0' | 'die1' | 'die2';
const FRAMES: ImpFrame[] = ['walk0', 'walk1', 'pain', 'die0', 'die1', 'die2'];

function drawImp(c: CanvasRenderingContext2D, frame: ImpFrame, icon: HTMLImageElement | null) {
  c.clearRect(0, 0, 32, 32);
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  };
  const skin = frame === 'pain' ? '#ffd0c0' : '#a8502a';
  const dark = frame === 'pain' ? '#ff9a85' : '#6a2c14';
  if (frame.startsWith('die')) {
    const k = Number(frame[3]);
    // Collapsing heap: shorter and redder each frame.
    const h = [18, 10, 5][k];
    px(8, 32 - h, 16, h, k === 2 ? '#7a1010' : skin);
    px(6, 31 - Math.floor(h / 2), 20, 2, '#c01818');
    if (k < 2) px(12, 32 - h + 2, 8, 3, '#ffcc00');
    px(4, 30, 24, 2, '#5a0808');
    return;
  }
  const step = frame === 'walk1' ? 1 : 0;
  px(10, 2, 3, 4, '#e8d8a0'); // horns
  px(19, 2, 3, 4, '#e8d8a0');
  px(10, 4, 12, 9, skin); // head
  px(12, 7, 3, 2, '#ffee00'); // eyes
  px(17, 7, 3, 2, '#ffee00');
  px(13, 11, 6, 1, '#3a0a00'); // mouth
  px(8, 13, 16, 11, skin); // torso
  px(5, 14 + step, 3, 9, dark); // arms
  px(24, 14 - step, 3, 9, dark);
  px(4, 22 + step, 4, 3, '#e8d8a0'); // claws
  px(24, 22 - step, 4, 3, '#e8d8a0');
  px(9, 24, 5, 7 - step * 2, dark); // legs
  px(18, 24, 5, 5 + step * 2, dark);
  // Token on the chest.
  px(11, 15, 10, 8, '#0a0404');
  if (icon) c.drawImage(icon, 12, 16, 8, 6);
  else px(13, 17, 6, 4, '#ff5a48');
}

/** Imp frames as textures; call `paint(icon)` again when the token icon loads. */
export function impFrames() {
  const map = new Map<ImpFrame, { cv: HTMLCanvasElement; tex: THREE.CanvasTexture }>();
  for (const f of FRAMES) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    map.set(f, { cv, tex });
  }
  const paint = (icon: HTMLImageElement | null) => {
    for (const [f, { cv, tex }] of map) {
      drawImp(cv.getContext('2d')!, f, icon);
      tex.needsUpdate = true;
    }
  };
  paint(null);
  return { tex: (f: ImpFrame) => map.get(f)!.tex, paint };
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

export const medkitTexture = () =>
  pixelTexture((c) => {
    c.clearRect(0, 0, 16, 16);
    c.fillStyle = '#e8e8e8';
    c.fillRect(1, 4, 14, 10);
    c.fillStyle = '#d01818';
    c.fillRect(6, 5, 4, 8);
    c.fillRect(3, 7, 10, 4);
    c.fillStyle = '#9a9a9a';
    c.fillRect(1, 13, 14, 1);
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
