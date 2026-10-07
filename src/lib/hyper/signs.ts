/**
 * Track-side signage in the house graphic system: flat colour blocks, chevrons, pictograms, oversized
 * condensed type, faux product codes, katakana flourishes and sticker slogans. An homage to the style of
 * 90s electronic-label graphic design; every layout here is original.
 */
import { GAME_B, GAME_KANA, GAME_REST } from './brand';
import { TEAMS } from './teams';

export const FONTS = { display: 'Impact, "Arial Black", sans-serif', mono: 'ui-monospace, Menlo, monospace', jp: '"Hiragino Sans", "Noto Sans JP", sans-serif', logo: 'Audiowide, "Arial Black", Impact, sans-serif' };
export const setFonts = (f: Partial<typeof FONTS>) => Object.assign(FONTS, f);

type G = CanvasRenderingContext2D;
const W = 1024;
const H = 512;

function chevrons(g: G, x: number, y: number, w: number, h: number, n: number, col: string, dir = 1) {
  g.fillStyle = col;
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const x0 = x + i * step;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + step * 0.5 * dir, y + h / 2);
    g.lineTo(x0, y + h);
    g.lineTo(x0 + step * 0.4, y + h);
    g.lineTo(x0 + step * 0.4 + step * 0.5 * dir, y + h / 2);
    g.lineTo(x0 + step * 0.4, y);
    g.closePath();
    g.fill();
  }
}
function barcode(g: G, x: number, y: number, w: number, h: number, col: string, seed: number) {
  g.fillStyle = col;
  let px = x;
  let r = seed;
  while (px < x + w) {
    r = (r * 9301 + 49297) % 233280;
    const bw = 1 + Math.floor((r / 233280) * 5);
    g.fillRect(px, y, bw, h);
    px += bw + 1 + ((r >> 3) % 4);
  }
}
function text(g: G, s: string, x: number, y: number, size: number, col: string, font = FONTS.display, align: CanvasTextAlign = 'left', rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = col;
  g.font = `900 ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, 0, 0);
  g.restore();
}
function sticker(g: G, s: string, x: number, y: number, size: number, bg: string, fg: string, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `900 ${size}px ${FONTS.display}`;
  const w = g.measureText(s).width + size * 0.7;
  g.fillStyle = bg;
  g.fillRect(-w / 2, -size * 0.85, w, size * 1.15);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.fillText(s, 0, 0);
  g.restore();
}
const circle = (g: G, x: number, y: number, r: number, col: string) => {
  g.fillStyle = col;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};
function tri(g: G, x: number, y: number, s: number, col: string, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s * 0.9, s * 0.7);
  g.lineTo(-s * 0.9, s * 0.7);
  g.closePath();
  g.fill();
  g.restore();
}
function grid(g: G, col: string, step: number, alpha = 0.25) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = col;
  g.lineWidth = 2;
  for (let x = 0; x <= W; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.restore();
}

/** The bRacer logotype (Audiowide): a red lowercase b plus RACER. Returns the drawn width. */
export function drawLogo(g: CanvasRenderingContext2D, x: number, y: number, size: number, bCol: string, restCol: string, shadow?: string) {
  g.save();
  g.font = `400 ${size}px ${FONTS.logo}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const bw = g.measureText(GAME_B).width;
  const rw = g.measureText(GAME_REST).width;
  if (shadow) {
    g.fillStyle = shadow;
    g.fillText(GAME_B, x + size * 0.03, y + size * 0.03);
    g.fillText(GAME_REST, x + bw + size * 0.03, y + size * 0.03);
  }
  g.fillStyle = bCol;
  g.fillText(GAME_B, x, y);
  g.fillStyle = restCol;
  g.fillText(GAME_REST, x + bw, y);
  g.restore();
  return bw + rw;
}

export const SIGN_COUNT = 8;

/** Draw design `i` onto a 1024x512 canvas. */
export function drawSign(c: HTMLCanvasElement, i: number, a1: string, a2: string) {
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const team = TEAMS[(i + 1) % TEAMS.length];
  switch (i % SIGN_COUNT) {
    case 0: {
      // Title board: lowercase b + RACER, kana, sticker.
      g.fillStyle = '#0b0b10';
      g.fillRect(0, 0, W, H);
      grid(g, a1, 64, 0.18);
      chevrons(g, 0, 0, W, 70, 18, a2);
      chevrons(g, 0, H - 70, W, 70, 18, a1, -1);
      drawLogo(g, 36, 360, 168, a2, '#ffffff', '#000');
      text(g, GAME_KANA, 560, 440, 54, a1, FONTS.jp);
      sticker(g, 'BUY NOW / BLAST MORE', 760, 150, 52, '#ffe600', '#111', -0.06);
      barcode(g, 40, 410, 220, 36, '#ffffff', 11);
      text(g, 'HG-3000 / TB', 280, 440, 26, '#fff', FONTS.mono);
      break;
    }
    case 1: {
      // Team poster.
      g.fillStyle = team.base;
      g.fillRect(0, 0, W, H);
      chevrons(g, 0, 40, W, 130, 9, team.accent);
      chevrons(g, 0, 190, W, 70, 18, team.trim);
      text(g, team.name, 40, 400, 150, team.accent);
      text(g, team.kana, 44, 462, 44, team.trim === '#111111' ? '#fff' : team.trim, FONTS.jp);
      circle(g, 900, 380, 90, team.trim);
      text(g, team.code, 900, 395, 48, team.accent, FONTS.mono, 'center');
      sticker(g, team.motto, 800, 300, 40, team.accent, '#111', 0.05);
      break;
    }
    case 2: {
      // Pictogram board: red disc, white arrow, big numerals.
      g.fillStyle = '#f2efe6';
      g.fillRect(0, 0, W, H);
      circle(g, 250, 256, 210, '#e8261d');
      g.save();
      g.translate(250, 256);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(-120, 30);
      g.lineTo(20, 30);
      g.lineTo(20, 90);
      g.lineTo(150, -10);
      g.lineTo(20, -110);
      g.lineTo(20, -50);
      g.lineTo(-120, -50);
      g.closePath();
      g.fill();
      g.restore();
      text(g, '700', 480, 330, 330, '#111');
      text(g, 'KM/H', 800, 330, 90, '#e8261d');
      text(g, 'ザ・スピード', 480, 440, 56, '#111', FONTS.jp);
      barcode(g, 480, 60, 460, 50, '#111', 5);
      text(g, 'NO BRAKES NO REFUNDS', 480, 150, 38, '#111', FONTS.mono);
      break;
    }
    case 3: {
      // Mono stripes + number.
      g.fillStyle = '#111';
      g.fillRect(0, 0, W, H);
      for (let k = 0; k < 20; k++) {
        g.fillStyle = k % 2 ? '#fff' : '#111';
        g.fillRect(k * 52, 0, 26, 90);
        g.fillRect(k * 52 + 26, H - 90, 26, 90);
      }
      text(g, '07', 40, 400, 360, '#fff');
      text(g, 'MEMPOOL', 400, 300, 150, a1);
      text(g, 'SECTOR', 410, 200, 90, '#fff');
      sticker(g, 'LIVE TXS INSIDE', 760, 410, 44, a2, '#111', -0.04);
      circle(g, 940, 150, 48, a2);
      tri(g, 940, 150, 26, '#111');
      break;
    }
    case 4: {
      // Hazard sponsor.
      g.fillStyle = '#ffe600';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#111';
      for (let k = -2; k < 24; k++) {
        g.beginPath();
        g.moveTo(k * 60, 0);
        g.lineTo(k * 60 + 30, 0);
        g.lineTo(k * 60 + 30 - 60, 70);
        g.lineTo(k * 60 - 60, 70);
        g.fill();
        g.beginPath();
        g.moveTo(k * 60, H);
        g.lineTo(k * 60 + 30, H);
        g.lineTo(k * 60 + 30 - 60, H - 70);
        g.lineTo(k * 60 - 60, H - 70);
        g.fill();
      }
      text(g, 'HASH·OIL', 50, 300, 230, '#111');
      text(g, 'ハッシュオイル', 60, 400, 60, '#111', FONTS.jp);
      text(g, 'FASTER SATS', 600, 410, 70, '#e8261d');
      break;
    }
    case 5: {
      // Kana column + dots.
      g.fillStyle = a1;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#0b0b10';
      for (let y = 20; y < H; y += 36) for (let x = 20; x < W; x += 36) circle(g, x, y, 5, '#0b0b10');
      g.fillRect(40, 60, 560, 390);
      text(g, '加速', 70, 330, 300, a1, FONTS.jp);
      text(g, 'ACCELERATE', 640, 250, 100, '#0b0b10');
      text(g, 'ONLY FORWARD', 640, 330, 58, '#0b0b10', FONTS.mono);
      tri(g, 780, 420, 40, '#0b0b10');
      tri(g, 870, 420, 40, '#0b0b10');
      tri(g, 960, 420, 40, '#0b0b10');
      break;
    }
    case 6: {
      // Orange grid with stacked type.
      g.fillStyle = a2;
      g.fillRect(0, 0, W, H);
      grid(g, '#000', 128, 0.35);
      text(g, 'BLOCK', 40, 210, 190, '#000');
      text(g, 'VELOCITY', 40, 400, 190, '#fff');
      text(g, 'ブロック', 700, 120, 70, '#000', FONTS.jp);
      barcode(g, 700, 380, 280, 60, '#000', 77);
      sticker(g, 'ZERO CONFIRMATIONS', 780, 300, 36, '#000', a2, 0.04);
      break;
    }
    default: {
      // Circle pattern + wordmark.
      g.fillStyle = '#0b0b10';
      g.fillRect(0, 0, W, H);
      for (let k = 0; k < 8; k++) {
        g.strokeStyle = k % 2 ? a1 : a2;
        g.lineWidth = 14;
        g.beginPath();
        g.arc(780, 256, 40 + k * 30, 0, Math.PI * 2);
        g.stroke();
      }
      text(g, 'TOKEN', 40, 230, 200, '#fff');
      text(g, 'BLASTER', 40, 420, 200, a1);
      text(g, '.LOL', 700, 480, 60, a2, FONTS.mono);
      chevrons(g, 40, 20, 400, 50, 12, a2);
      break;
    }
  }
  // Frame.
  g.strokeStyle = '#000';
  g.lineWidth = 8;
  g.strokeRect(4, 4, W - 8, H - 8);
}
