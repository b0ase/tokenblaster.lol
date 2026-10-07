/**
 * Highway 21M art: every sprite and backdrop is drawn in code onto offscreen canvases (no image files, no
 * upstream sprites). Cars are rear views tinted per transaction kind, billboards are repainted live with
 * ticker text, the backdrop is a dusk skyline. See public/arcade/highway21/CREDITS.md.
 */
export type Sprite = { c: HTMLCanvasElement; w: number; h: number };
export type Layer = { c: HTMLCanvasElement; w: number; h: number };

/** Canvas of logical size w x h backed by k times the pixels (sprites are drawn big, so they stay crisp when the car is near). */
const mk = (w: number, h: number, k = 1): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  return [c, g];
};
const sprite = (c: HTMLCanvasElement, k = 1): Sprite => ({ c, w: c.width / k, h: c.height / k });
const KS = 3;

/** Tiny deterministic RNG so the backdrop is the same every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Rear view of a sports car. `lean` shifts the body for steering frames (-1 left, 1 right). */
export function carSprite(body: string, opts: { lean?: number; w?: number; h?: number; player?: boolean } = {}): Sprite {
  const w = opts.w ?? 80;
  const h = opts.h ?? 46;
  const lean = opts.lean ?? 0;
  const [c, g] = mk(w, h, KS);
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.beginPath();
  g.ellipse(w / 2, h - 3, w * 0.5, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(w / 2, h);
  g.transform(1, 0, lean * 0.14, 1, 0, 0); // shear: the car leans into the turn
  g.translate(-w / 2, -h);
  g.fillStyle = '#0c0c10';
  rr(g, 3, h - 15, 14, 14, 3);
  g.fill();
  rr(g, w - 17, h - 15, 14, 14, 3);
  g.fill();
  const lo = g.createLinearGradient(0, h * 0.35, 0, h * 0.85);
  lo.addColorStop(0, shade(body, 0.18));
  lo.addColorStop(1, shade(body, -0.35));
  g.fillStyle = lo;
  rr(g, 2, h * 0.38, w - 4, h * 0.46, 6);
  g.fill();
  g.fillStyle = shade(body, -0.3);
  g.beginPath();
  g.moveTo(w * 0.16, h * 0.44);
  g.lineTo(w * 0.27, h * 0.08);
  g.lineTo(w * 0.73, h * 0.08);
  g.lineTo(w * 0.84, h * 0.44);
  g.closePath();
  g.fill();
  g.fillStyle = '#0d1c28';
  g.beginPath();
  g.moveTo(w * 0.22, h * 0.42);
  g.lineTo(w * 0.31, h * 0.14);
  g.lineTo(w * 0.69, h * 0.14);
  g.lineTo(w * 0.78, h * 0.42);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.fillRect(w * 0.34, h * 0.17, w * 0.14, h * 0.05);
  if (opts.player) {
    g.fillStyle = '#101018'; // spoiler
    rr(g, w * 0.1, h * 0.3, w * 0.8, h * 0.07, 2);
    g.fill();
  }
  g.shadowColor = '#ff2020';
  g.shadowBlur = 8;
  g.fillStyle = '#ff3030';
  rr(g, 5, h * 0.5, w * 0.24, h * 0.13, 2);
  g.fill();
  rr(g, w - 5 - w * 0.24, h * 0.5, w * 0.24, h * 0.13, 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = '#08080c';
  rr(g, w * 0.2, h * 0.7, w * 0.6, h * 0.12, 2);
  g.fill();
  g.fillStyle = '#e8e4d0';
  rr(g, w * 0.4, h * 0.72, w * 0.2, h * 0.08, 1);
  g.fill();
  g.restore();
  return sprite(c, KS);
}

/** A box truck from behind, trailer in the transaction kind's colour. */
export function truckSprite(body: string): Sprite {
  const w = 120;
  const h = 100;
  const [c, g] = mk(w, h, KS);
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.beginPath();
  g.ellipse(w / 2, h - 3, w * 0.5, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0c0c10';
  rr(g, 6, h - 18, 18, 17, 3);
  g.fill();
  rr(g, w - 24, h - 18, 18, 17, 3);
  g.fill();
  const t = g.createLinearGradient(0, 0, 0, h * 0.82);
  t.addColorStop(0, shade(body, 0.1));
  t.addColorStop(1, shade(body, -0.4));
  g.fillStyle = t;
  rr(g, 4, 2, w - 8, h * 0.78, 4);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(w / 2, 4);
  g.lineTo(w / 2, h * 0.78);
  g.stroke(); // rear door seam
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = 'bold 15px monospace';
  g.textAlign = 'center';
  g.fillText('tx', w / 2, h * 0.36);
  g.fillStyle = '#16161c';
  g.fillRect(4, h * 0.74, w - 8, h * 0.08);
  g.shadowColor = '#ff2020';
  g.shadowBlur = 8;
  g.fillStyle = '#ff3030';
  rr(g, 6, h * 0.58, 14, 10, 2);
  g.fill();
  rr(g, w - 20, h * 0.58, 14, 10, 2);
  g.fill();
  g.shadowBlur = 0;
  return sprite(c, KS);
}

/** A roadside billboard on two posts; repainted live by `paintBillboard`. */
export function billboardSprite(): Sprite {
  const [c] = mk(224, 150, 2);
  const s = sprite(c, 2);
  paintBillboard(s, 'TOKENBLASTER.LOL', 'LIVE MAINNET', '#ffd36a');
  return s;
}

export function paintBillboard(s: Sprite, head: string, main: string, accent: string) {
  const g = s.c.getContext('2d')!;
  const { w, h } = s;
  g.clearRect(0, 0, w, h); // the context is already scaled by the sprite's pixel ratio
  g.fillStyle = '#17141c';
  g.fillRect(w * 0.2, h * 0.55, 8, h * 0.45);
  g.fillRect(w * 0.8 - 8, h * 0.55, 8, h * 0.45);
  const bh = h * 0.64;
  g.fillStyle = '#0b0710';
  rr(g, 2, 2, w - 4, bh, 6);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 3;
  g.shadowColor = accent;
  g.shadowBlur = 8;
  rr(g, 5, 5, w - 10, bh - 6, 5);
  g.stroke();
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.fillStyle = '#e0958a';
  g.font = 'bold 13px "Courier New", monospace';
  g.fillText(head.slice(0, 22), w / 2, 26);
  g.fillStyle = accent;
  let size = 30;
  g.font = `bold ${size}px "Courier New", monospace`;
  while (g.measureText(main).width > w - 24 && size > 12) {
    size -= 2;
    g.font = `bold ${size}px "Courier New", monospace`;
  }
  g.fillText(main, w / 2, 26 + (bh - 26) / 2 + size * 0.3);
  g.fillStyle = 'rgba(255,255,255,.07)';
  for (let y = 8; y < bh; y += 4) g.fillRect(6, y, w - 12, 1);
}

export function pineSprite(): Sprite {
  const [c, g] = mk(90, 200, 2);
  g.fillStyle = '#2a1608';
  g.fillRect(41, 160, 8, 40);
  for (let i = 0; i < 4; i++) {
    const y = 150 - i * 38;
    const half = 44 - i * 8;
    g.fillStyle = i % 2 ? '#0e3a2c' : '#0a2e24';
    g.beginPath();
    g.moveTo(45, y - 62);
    g.lineTo(45 + half, y);
    g.lineTo(45 - half, y);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1d7a5a';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(45, y - 62);
    g.lineTo(45 - half, y);
    g.stroke();
  }
  return sprite(c, 2);
}

/** A tall node rack with blinking-looking LEDs. */
export function rackSprite(): Sprite {
  const [c, g] = mk(54, 150, 2);
  g.fillStyle = '#15121c';
  rr(g, 2, 2, 50, 146, 4);
  g.fill();
  g.strokeStyle = '#3a2a4a';
  g.lineWidth = 2;
  rr(g, 2, 2, 50, 146, 4);
  g.stroke();
  const r = rng(7);
  for (let y = 10; y < 140; y += 12) {
    g.fillStyle = '#0a0810';
    g.fillRect(8, y, 38, 8);
    for (let x = 12; x < 44; x += 7) {
      const on = r();
      g.fillStyle = on > 0.7 ? '#ff5a48' : on > 0.35 ? '#ffd36a' : '#2a8a6a';
      g.fillRect(x, y + 3, 3, 3);
    }
  }
  return sprite(c, 2);
}

/** A stone pillar with an orange glow band: "hash column". */
export function columnSprite(): Sprite {
  const [c, g] = mk(44, 190, 2);
  const lg = g.createLinearGradient(0, 0, 44, 0);
  lg.addColorStop(0, '#2a2030');
  lg.addColorStop(0.5, '#5a4a66');
  lg.addColorStop(1, '#241a2c');
  g.fillStyle = lg;
  g.fillRect(6, 10, 32, 180);
  g.fillRect(0, 0, 44, 12);
  g.fillRect(0, 178, 44, 12);
  g.shadowColor = '#ff7a3a';
  g.shadowBlur = 8;
  g.fillStyle = '#ff7a3a';
  g.fillRect(6, 90, 32, 4);
  return sprite(c, 2);
}

export function crystalSprite(hue: string): Sprite {
  const [c, g] = mk(64, 44, 2);
  g.shadowColor = hue;
  g.shadowBlur = 6;
  const shards: [number, number, number][] = [[16, 40, 22], [32, 44, 40], [48, 38, 26]];
  for (const [x, hgt, base] of shards) {
    g.fillStyle = hue;
    g.beginPath();
    g.moveTo(x, 44 - hgt);
    g.lineTo(x + 9, 44 - 4);
    g.lineTo(x - 9, 44 - 4);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.moveTo(x, 44 - hgt);
    g.lineTo(x - 9, 44 - 4);
    g.lineTo(x - 2, 44 - 4);
    g.closePath();
    g.fill();
    void base;
  }
  return sprite(c, 2);
}

/** Wraps a 1024-wide drawing into a 2048-wide layer (the renderer shows half of it, scrolling and wrapping). */
function layer(draw: (g: CanvasRenderingContext2D) => void, bg?: (g: CanvasRenderingContext2D) => void): Layer {
  const [tile, tg] = mk(1024, 512);
  if (bg) bg(tg);
  draw(tg);
  const [c, g] = mk(2048, 512);
  g.drawImage(tile, 0, 0);
  g.drawImage(tile, 1024, 0);
  return { c, w: 2048, h: 512 };
}

export const FOG_COLOR = '#2b1033';

export function makeBackdrop(): { sky: Layer; hills: Layer; trees: Layer } {
  const sky = layer(
    (g) => {
      const r = rng(11);
      g.fillStyle = '#fff';
      for (let i = 0; i < 60; i++) {
        g.globalAlpha = 0.25 + r() * 0.6;
        g.fillRect(r() * 1024, r() * 150, 2, 2);
      }
      g.globalAlpha = 1;
      // Sun with horizontal cuts.
      const sx = 520;
      const sy = 228;
      const sg = g.createLinearGradient(0, sy - 90, 0, sy + 90);
      sg.addColorStop(0, '#ffe27a');
      sg.addColorStop(1, '#ff3d6e');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(sx, sy, 90, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6a1c4a';
      for (let i = 0; i < 6; i++) g.fillRect(sx - 95, sy + 10 + i * 14, 190, 2 + i * 1.6);
      // Soft clouds.
      for (let i = 0; i < 5; i++) {
        const cx = r() * 1024;
        const cy = 120 + r() * 90;
        g.fillStyle = 'rgba(255,120,110,.25)';
        g.fillRect(cx, cy, 120 + r() * 120, 6);
        g.fillStyle = 'rgba(255,200,140,.18)';
        g.fillRect(cx + 20, cy + 8, 80 + r() * 80, 4);
      }
    },
    (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 512);
      gr.addColorStop(0, '#0e0620');
      gr.addColorStop(0.28, '#3a0f4a');
      gr.addColorStop(0.45, '#c2305a');
      gr.addColorStop(0.5, '#ff7a3a');
      gr.addColorStop(0.52, FOG_COLOR);
      gr.addColorStop(1, FOG_COLOR);
      g.fillStyle = gr;
      g.fillRect(0, 0, 1024, 512);
    },
  );
  const hills = layer((g) => {
    // Far ridge: periodic so the wrap is seamless.
    g.fillStyle = '#3d1546';
    g.beginPath();
    g.moveTo(0, 270);
    for (let x = 0; x <= 1024; x += 8) {
      const t = (x / 1024) * Math.PI * 2;
      g.lineTo(x, 214 - 20 * Math.sin(t * 3 + 1) - 14 * Math.sin(t * 7 + 2) - 8 * Math.sin(t * 13));
    }
    g.lineTo(1024, 270);
    g.closePath();
    g.fill();
    // Block skyline: each building is a block of the chain.
    const r = rng(23);
    let x = 0;
    while (x < 1000) {
      const bw = 18 + r() * 34;
      const bh = 30 + r() * 80;
      const w = Math.min(bw, 1024 - x);
      g.fillStyle = '#24102e';
      g.fillRect(x, 262 - bh, w, bh + 10);
      g.fillStyle = 'rgba(255,170,90,.8)';
      for (let wy = 262 - bh + 6; wy < 256; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (r() > 0.78) g.fillRect(wx, wy, 3, 4);
      x += w + 2 + r() * 8;
    }
  });
  const trees = layer((g) => {
    const r = rng(41);
    for (let x = 6; x < 1000; x += 26 + r() * 40) {
      const h = 36 + r() * 46;
      g.fillStyle = '#0d0716';
      g.beginPath();
      g.moveTo(x, 272);
      g.lineTo(x + 9, 272 - h);
      g.lineTo(x + 18, 272);
      g.closePath();
      g.fill();
    }
    g.fillRect(0, 266, 1024, 12);
  });
  return { sky, hills, trees };
}
