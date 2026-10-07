/** Canvas-made textures for Block Hopper: platform tickers, block gate signs, token coins, enemy faces. */
import * as THREE from 'three';
import type { Loot } from '@/lib/loot';
import { tokenMeta } from '@/lib/tokenMeta';

let FONT = { display: 'Impact, "Arial Black", sans-serif', mono: 'ui-monospace, Menlo, monospace', logo: 'Impact, sans-serif' };
export const setFonts = (f: Partial<typeof FONT>) => {
  FONT = { ...FONT, ...f };
};

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const tex = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
};

/** Ticker plate on a platform's front face: kind tag block, tx id, size. */
export function labelTexture(tag: string, label: string, sub: string, color: string, wUnits: number) {
  const w = 512;
  const h = Math.round(w * (1.0 / Math.max(2.5, wUnits)));
  const c = canvas(w, Math.max(48, h));
  const g = c.getContext('2d')!;
  const H = c.height;
  g.fillStyle = 'rgba(6,6,9,0.78)';
  g.fillRect(0, 0, w, H);
  g.fillStyle = color;
  g.fillRect(0, 0, H * 1.7, H);
  g.fillStyle = '#0a0a0c';
  g.font = `900 italic ${Math.round(H * 0.62)}px ${FONT.display}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(tag, H * 0.85, H * 0.54, H * 1.55);
  g.textAlign = 'left';
  g.fillStyle = '#f2efe6';
  g.font = `700 ${Math.round(H * 0.4)}px ${FONT.mono}`;
  g.fillText(label.replace(/^[A-Z]+ · /, ''), H * 1.9, H * 0.34, w - H * 2);
  g.fillStyle = color;
  g.font = `400 ${Math.round(H * 0.3)}px ${FONT.mono}`;
  g.fillText(sub, H * 1.9, H * 0.74, w - H * 2);
  g.fillStyle = color;
  g.fillRect(0, H - 3, w, 3);
  void label;
  return tex(c);
}

/** Banner for a block checkpoint gate. */
export function gateTexture(height: string, line: string, color: string) {
  const c = canvas(1024, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,8,12,0.9)';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = color;
  for (let i = -2; i < 20; i++) {
    g.beginPath();
    g.moveTo(i * 60, 0);
    g.lineTo(i * 60 + 30, 0);
    g.lineTo(i * 60 + 10, 22);
    g.lineTo(i * 60 - 20, 22);
    g.fill();
    g.beginPath();
    g.moveTo(i * 60, 256);
    g.lineTo(i * 60 + 30, 256);
    g.lineTo(i * 60 + 10, 234);
    g.lineTo(i * 60 - 20, 234);
    g.fill();
  }
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#f2efe6';
  g.font = `900 italic 128px ${FONT.display}`;
  g.fillText(height, 512, 108, 960);
  g.fillStyle = color;
  g.font = `700 42px ${FONT.mono}`;
  g.fillText(line, 512, 196, 960);
  return tex(c);
}

/** A token as a glowing coin; the icon may arrive later, so callers can redraw. */
export function drawTokenCoin(c: HTMLCanvasElement, loot: Loot, ring = '#ffd36a') {
  const s = c.width;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, s, s);
  const r = s / 2 - 4;
  g.fillStyle = '#1a1204';
  g.beginPath();
  g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  g.fill();
  const img = tokenMeta(loot.id)?.icon;
  let ok = false;
  if (img?.complete && img.naturalWidth) {
    try {
      g.save();
      g.beginPath();
      g.arc(s / 2, s / 2, r - 6, 0, Math.PI * 2);
      g.clip();
      g.drawImage(img, 6, 6, s - 12, s - 12);
      g.restore();
      ok = true;
    } catch {
      /* broken icon */
    }
  }
  if (!ok) {
    g.fillStyle = ring;
    g.font = `900 ${Math.round(s * 0.34)}px ${FONT.display}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((tokenMeta(loot.id)?.sym ?? loot.sym).slice(0, 4), s / 2, s / 2 + 2, s * 0.8);
  }
  g.strokeStyle = ring;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  g.stroke();
  return ok;
}

export function tokenCoinTexture(loot: Loot, ring?: string) {
  const c = canvas(128, 128);
  const ok = drawTokenCoin(c, loot, ring);
  const t = tex(c);
  return { tex: t, canvas: c, ok };
}

/** A soft round glow sprite. */
export function glowTexture(color = '#ffffff') {
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(0.35, color + '88');
  gr.addColorStop(1, color + '00');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}
