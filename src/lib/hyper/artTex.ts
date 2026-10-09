/**
 * Generated textures for the bRacer environment: deck plating, hull plating, sponsor boards, crowd and bay
 * lights. Everything is drawn on canvases at load (no downloads); normal maps come from height canvases.
 */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import { FONTS } from './signs';

export const cnv = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
export const texOf = (c: HTMLCanvasElement, srgb: boolean, rep = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};

/** Tangent-space normal map from a grey height canvas (Sobel, tiling). */
export function normalFromHeight(h: HTMLCanvasElement, strength: number) {
  const w = h.width;
  const H = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, w, H).data;
  const out = cnv(w, H);
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, H);
  const d = img.data;
  const at = (x: number, y: number) => src[((((y + H) % H) * w + ((x + w) % w)) * 4)] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      d[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      d[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      d[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return texOf(out, false);
}

type P = { a1: string; a2: string };

/**
 * Track deck: 6 x 4 machined panels per tile with recessed seams, rivet rows, vent grates, thrust scorch down
 * the racing line and glossy wet patches (low roughness picks up the sky reflection).
 */
export function deckTextures(p: P, S: number, withNormal: boolean) {
  const c = cnv(S, S);
  const e = cnv(S, S);
  const r = cnv(S, S);
  const h = cnv(S, S);
  const g = c.getContext('2d')!;
  const ge = e.getContext('2d')!;
  const gr = r.getContext('2d')!;
  const gh = h.getContext('2d')!;
  const R = rng(5);
  const k = S / 512;
  g.fillStyle = '#1a1f2b';
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  gr.fillStyle = '#4a4a4a';
  gr.fillRect(0, 0, S, S);
  gh.fillStyle = '#808080';
  gh.fillRect(0, 0, S, S);
  const cols = 6;
  const rows = 4;
  const pw = S / cols;
  const ph = S / rows;
  // Per-panel tone shift and brushed grain.
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const t = R();
    g.fillStyle = `rgba(${30 + t * 18},${36 + t * 20},${52 + t * 26},0.55)`;
    g.fillRect(i * pw, j * ph, pw, ph);
    for (let q = 0; q < 50; q++) {
      g.fillStyle = `rgba(255,255,255,${0.012 + R() * 0.02})`;
      g.fillRect(i * pw + R() * pw, j * ph, 1 * k, ph);
    }
    // Some panels are vent grates.
    if (R() < 0.12 && i > 0 && i < cols - 1) {
      for (let y = j * ph + 10 * k; y < (j + 1) * ph - 10 * k; y += 7 * k) {
        g.fillStyle = '#07090d';
        g.fillRect(i * pw + 10 * k, y, pw - 20 * k, 3 * k);
        gh.fillStyle = '#303030';
        gh.fillRect(i * pw + 10 * k, y, pw - 20 * k, 3 * k);
      }
    }
  }
  // Grit.
  for (let i = 0; i < 6000 * k * k; i++) {
    const v = R();
    g.fillStyle = `rgba(${Math.floor(v * 60)},${Math.floor(v * 66)},${Math.floor(v * 80)},0.3)`;
    g.fillRect(R() * S, R() * S, (1 + R() * 3) * k, (1 + R() * 2) * k);
  }
  // Thrust scorch along the racing lines (v runs along the track).
  for (let q = 0; q < 5; q++) {
    const x = S * (0.25 + R() * 0.5);
    const w = (20 + R() * 50) * k;
    const grd = g.createLinearGradient(x - w, 0, x + w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - w, 0, w * 2, S);
    gr.fillStyle = 'rgba(150,150,150,0.25)';
    gr.fillRect(x - w * 0.5, 0, w, S);
  }
  // Wet / polished patches: low roughness.
  for (let q = 0; q < 14; q++) {
    const x = R() * S;
    const y = R() * S;
    const rad = (30 + R() * 90) * k;
    const grd = gr.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(10,10,10,0.85)');
    grd.addColorStop(1, 'rgba(10,10,10,0)');
    gr.fillStyle = grd;
    gr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Seams: dark, rough, recessed; bevel highlight on the far edge.
  const seam = 5 * k;
  for (let i = 0; i <= cols; i++) {
    const x = i * pw;
    g.fillStyle = '#030408';
    g.fillRect(x - seam / 2, 0, seam, S);
    g.fillStyle = 'rgba(140,160,210,0.16)';
    g.fillRect(x + seam / 2, 0, 1.5 * k, S);
    gr.fillStyle = '#d8d8d8';
    gr.fillRect(x - seam / 2, 0, seam, S);
    gh.fillStyle = '#101010';
    gh.fillRect(x - seam / 2, 0, seam, S);
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * ph;
    g.fillStyle = '#030408';
    g.fillRect(0, y - seam / 2, S, seam);
    g.fillStyle = 'rgba(140,160,210,0.16)';
    g.fillRect(0, y + seam / 2, S, 1.5 * k);
    gr.fillStyle = '#d8d8d8';
    gr.fillRect(0, y - seam / 2, S, seam);
    gh.fillStyle = '#101010';
    gh.fillRect(0, y - seam / 2, S, seam);
  }
  // Rivets along the seams.
  for (let i = 0; i < cols; i++) for (let j = 0; j <= rows; j++) {
    for (let q = 1; q < 6; q++) {
      const x = i * pw + (q * pw) / 6;
      const y = j * ph + 7 * k;
      g.fillStyle = '#3a4252';
      g.fillRect(x - 1.5 * k, y - 1.5 * k, 3 * k, 3 * k);
      gh.fillStyle = '#e0e0e0';
      gh.beginPath();
      gh.arc(x, y, 2 * k, 0, Math.PI * 2);
      gh.fill();
    }
  }
  // Edge light bars (emissive) and lane dashes.
  const bar = (x: number, w: number, colr: string) => {
    ge.fillStyle = colr;
    ge.fillRect(x, 0, w, S);
    g.fillStyle = '#050608';
    g.fillRect(x, 0, w, S);
    gr.fillStyle = '#202020';
    gr.fillRect(x, 0, w, S);
  };
  bar(0, 14 * k, p.a1);
  bar(S - 14 * k, 14 * k, p.a2);
  ge.globalAlpha = 0.5;
  ge.fillStyle = p.a1;
  ge.fillRect(26 * k, 0, 4 * k, S);
  ge.fillStyle = p.a2;
  ge.fillRect(S - 30 * k, 0, 4 * k, S);
  ge.globalAlpha = 1;
  for (let q = 0; q < 4; q++) {
    ge.fillStyle = 'rgba(255,255,255,0.75)';
    ge.fillRect(S / 2 - 4 * k, q * (S / 4) + 20 * k, 8 * k, S / 8);
    g.fillStyle = '#d8dde6';
    g.fillRect(S / 2 - 4 * k, q * (S / 4) + 20 * k, 8 * k, S / 8);
  }
  // Stencilled lane numbers (DR-ish product codes).
  g.save();
  g.font = `900 ${Math.round(26 * k)}px ${FONTS.display}`;
  g.fillStyle = 'rgba(210,220,240,0.22)';
  g.translate(S * 0.2, S * 0.62);
  g.rotate(-Math.PI / 2);
  g.fillText('LANE 01 // HG', 0, 0);
  g.restore();
  // Data ticks.
  for (let i = 0; i < 40; i++) {
    ge.fillStyle = R() > 0.5 ? p.a1 : p.a2;
    ge.globalAlpha = 0.25 + R() * 0.35;
    ge.fillRect(40 * k + R() * (S - 80 * k), R() * S, (3 + R() * 10) * k, 3 * k);
  }
  ge.globalAlpha = 1;
  return {
    map: texOf(c, true),
    emissive: texOf(e, true),
    rough: texOf(r, false),
    normal: withNormal ? normalFromHeight(h, 2.2) : null,
  };
}

/** Hull plating for the slab, kerbs, pylons and gantries: panels, seams, rivets, hazard tags, grime runs. */
export function plateTextures(S: number, withNormal: boolean, seed = 9) {
  const c = cnv(S, S);
  const r = cnv(S, S);
  const h = cnv(S, S);
  const g = c.getContext('2d')!;
  const gr = r.getContext('2d')!;
  const gh = h.getContext('2d')!;
  const R = rng(seed);
  const k = S / 512;
  g.fillStyle = '#2a2f3a';
  g.fillRect(0, 0, S, S);
  gr.fillStyle = '#707070';
  gr.fillRect(0, 0, S, S);
  gh.fillStyle = '#808080';
  gh.fillRect(0, 0, S, S);
  // Irregular plate layout.
  const plates: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, hh: number, d: number) => {
    if (d > 3 || (d > 1 && R() < 0.3)) {
      plates.push([x, y, w, hh]);
      return;
    }
    if (w > hh) {
      const a = w * (0.3 + R() * 0.4);
      split(x, y, a, hh, d + 1);
      split(x + a, y, w - a, hh, d + 1);
    } else {
      const a = hh * (0.3 + R() * 0.4);
      split(x, y, w, a, d + 1);
      split(x, y + a, w, hh - a, d + 1);
    }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, hh] of plates) {
    const t = R();
    g.fillStyle = `rgb(${34 + t * 22},${38 + t * 24},${48 + t * 26})`;
    g.fillRect(x, y, w, hh);
    gr.fillStyle = `rgb(${90 + t * 70},${90 + t * 70},${90 + t * 70})`;
    gr.fillRect(x, y, w, hh);
    g.strokeStyle = '#0b0d12';
    g.lineWidth = 3 * k;
    g.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    g.strokeStyle = 'rgba(170,185,220,0.18)';
    g.lineWidth = 1 * k;
    g.strokeRect(x + 4 * k, y + 4 * k, w - 8 * k, hh - 8 * k);
    gh.strokeStyle = '#141414';
    gh.lineWidth = 4 * k;
    gh.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    // Corner rivets.
    for (const [cx, cy] of [[x + 8 * k, y + 8 * k], [x + w - 8 * k, y + 8 * k], [x + 8 * k, y + hh - 8 * k], [x + w - 8 * k, y + hh - 8 * k]]) {
      gh.fillStyle = '#f0f0f0';
      gh.beginPath();
      gh.arc(cx, cy, 2.5 * k, 0, Math.PI * 2);
      gh.fill();
      g.fillStyle = '#4a5262';
      g.fillRect(cx - 2 * k, cy - 2 * k, 4 * k, 4 * k);
    }
    // Hazard tag or stencil code on a few plates.
    if (R() < 0.18 && w > 60 * k && hh > 30 * k) {
      const tw = Math.min(w * 0.5, 90 * k);
      g.save();
      g.beginPath();
      g.rect(x + 10 * k, y + hh - 22 * k, tw, 12 * k);
      g.clip();
      g.fillStyle = '#e8c400';
      g.fillRect(x + 10 * k, y + hh - 22 * k, tw, 12 * k);
      g.fillStyle = '#111';
      for (let q = -2; q < tw / (10 * k) + 2; q++) {
        g.beginPath();
        g.moveTo(x + 10 * k + q * 10 * k, y + hh - 22 * k);
        g.lineTo(x + 15 * k + q * 10 * k, y + hh - 22 * k);
        g.lineTo(x + 10 * k + q * 10 * k, y + hh - 10 * k);
        g.lineTo(x + 5 * k + q * 10 * k, y + hh - 10 * k);
        g.fill();
      }
      g.restore();
    } else if (R() < 0.2 && w > 50 * k) {
      g.font = `900 ${Math.round(13 * k)}px ${FONTS.mono}`;
      g.fillStyle = 'rgba(220,226,240,0.45)';
      g.fillText(`HG-${Math.floor(R() * 900 + 100)}`, x + 10 * k, y + 20 * k);
    }
  }
  // Grime runs downward and edge wear.
  for (let q = 0; q < 70; q++) {
    const x = R() * S;
    const y = R() * S;
    const len = (20 + R() * 120) * k;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, 'rgba(5,6,8,0.35)');
    grd.addColorStop(1, 'rgba(5,6,8,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, (2 + R() * 6) * k, len);
    gr.fillStyle = 'rgba(220,220,220,0.2)';
    gr.fillRect(x, y, (2 + R() * 6) * k, len);
  }
  return { map: texOf(c, true), rough: texOf(r, false), normal: withNormal ? normalFromHeight(h, 2.6) : null };
}

/** Stadium crowd: a field of tiny lit dots (phone lights, flags) for the grandstand tiers. */
export function crowdTex(p: P) {
  const c = cnv(512, 128);
  const g = c.getContext('2d')!;
  const R = rng(31);
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 2600; i++) {
    const v = R();
    g.fillStyle = v < 0.08 ? p.a1 : v < 0.16 ? p.a2 : v < 0.2 ? '#ffffff' : `rgba(255,${180 + Math.floor(R() * 60)},${120 + Math.floor(R() * 80)},${0.15 + R() * 0.35})`;
    g.fillRect(R() * 512, R() * 128, 2, 2);
  }
  return texOf(c, true);
}

/** Pit garage bays: glowing rectangular doors with numbers. */
export function baysTex(a1: string) {
  const c = cnv(1024, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0c12';
  g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 8; i++) {
    const x = 12 + i * 126;
    const grd = g.createLinearGradient(0, 60, 0, 240);
    grd.addColorStop(0, '#fff6e0');
    grd.addColorStop(1, a1);
    g.fillStyle = grd;
    g.fillRect(x, 70, 104, 170);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 80; y < 240; y += 12) g.fillRect(x, y, 104, 3);
    g.fillStyle = '#ffd400';
    g.fillRect(x, 20, 104, 36);
    g.fillStyle = '#111';
    g.font = `900 30px ${FONTS.display}`;
    g.fillText(`P${i + 1}`, x + 8, 50);
  }
  return texOf(c, true, false);
}

/** Thin dashed light strip for tunnel ceilings and gantry undersides (repeats along v). */
export function stripTex() {
  const c = cnv(16, 128);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 16, 128);
  g.fillStyle = '#fff';
  g.fillRect(0, 8, 16, 96);
  return texOf(c, true);
}

const SPONSORS: [string, string][] = [
  ['SATOSHI DYNAMICS', 'PROPULSION'],
  ['MERKLE HEAVY IND.', 'MEGASTRUCTURE'],
  ['UTXO FUELS', 'HIGH OCTANE SATS'],
  ['OP_RETURN AERO', 'AIRFRAMES'],
  ['1SAT FOUNDRY', 'FORGED ON CHAIN'],
  ['BLOCKHEIGHT', 'TIMING PARTNER'],
];

/** DR-style sponsor board for gantry beams: block colour field, oversized type, chevrons and a product code. */
export function sponsorTex(i: number, p: P) {
  const c = cnv(1024, 192);
  const g = c.getContext('2d')!;
  const [name, sub] = SPONSORS[i % SPONSORS.length];
  const inv = i % 2 === 1;
  const bg = inv ? '#f2f2ee' : '#0b0b10';
  const fg = inv ? '#0b0b10' : '#f2f2ee';
  const acc = i % 3 === 0 ? p.a1 : i % 3 === 1 ? p.a2 : '#ffd400';
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 192);
  g.fillStyle = acc;
  g.fillRect(0, 0, 150, 192);
  g.fillStyle = bg;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    g.moveTo(20 + k * 40, 40);
    g.lineTo(50 + k * 40, 96);
    g.lineTo(20 + k * 40, 152);
    g.lineTo(38 + k * 40, 152);
    g.lineTo(68 + k * 40, 96);
    g.lineTo(38 + k * 40, 40);
    g.fill();
  }
  g.fillStyle = fg;
  g.font = `900 92px ${FONTS.display}`;
  g.textBaseline = 'alphabetic';
  g.fillText(name, 176, 112, 800);
  g.font = `700 26px ${FONTS.mono}`;
  g.fillStyle = acc;
  g.fillText(`${sub} // HG-${300 + i * 17}`, 180, 160);
  g.fillStyle = acc;
  g.fillRect(0, 182, 1024, 10);
  return texOf(c, true, false);
}
