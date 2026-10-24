/**
 * NEO-TOKYO 2048 texture assets for the Shooting Gallery set, all drawn procedurally on canvases (no
 * downloads): facade atlases with window variety, shopfronts, a vertical-sign atlas with katakana and
 * kanji lettering, a hologram-billboard atlas, vending machines, skyline silhouettes, lobby and curtain wall.
 *
 * Every brand here is invented, apart from our own (nSLAVE, TOKENBLASTER, bWalletX, NPG).
 * `S` is a scale for texture resolution: 1 on High, 0.5 on Low.
 */
import * as THREE from 'three';

export const JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP","Noto Sans CJK JP","Meiryo","MS Gothic",sans-serif';

export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  draw(c.getContext('2d')!);
  return c;
}

export function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export type FacadeKind = 'office' | 'resi' | 'glass' | 'old';
/** One facade tile covers BAYS x FLOORS; BAY_W / FLOOR_H are metres, so UVs can be derived from world size. */
export const FACADE = { bays: 6, floors: 8, bayW: 3.2, floorH: 3.6 };
export const FACADE_W = FACADE.bays * FACADE.bayW;
export const FACADE_H = FACADE.floors * FACADE.floorH;

/** A facade tile: albedo + emissive (lit offices, blinds, people silhouettes, TVs), ledges, AC units, mullions. */
export function facadeTile(kind: FacadeKind, seed: number, S = 1) {
  const W = Math.round(512 * S);
  const H = Math.round(512 * S);
  const cw = W / FACADE.bays;
  const ch = H / FACADE.floors;
  const cells: { x: number; y: number; state: number; r: number; r2: number }[] = [];
  const r = rng(seed);
  for (let f = 0; f < FACADE.floors; f++) for (let b = 0; b < FACADE.bays; b++) cells.push({ x: b * cw, y: f * ch, state: r(), r: r(), r2: r() });
  const litP = kind === 'office' ? 0.2 : kind === 'glass' ? 0.14 : kind === 'old' ? 0.1 : 0.12;

  const draw = (g: CanvasRenderingContext2D, em: boolean) => {
    const wall = { office: '#171d2b', resi: '#1b1a24', glass: '#0b1424', old: '#201c20' }[kind];
    g.fillStyle = em ? '#000' : wall;
    g.fillRect(0, 0, W, H);
    for (const c of cells) {
      const ix = c.x + cw * 0.1;
      const iy = c.y + ch * (kind === 'glass' ? 0.06 : 0.14);
      const iw = cw * (kind === 'glass' ? 0.84 : kind === 'office' ? 0.78 : 0.56);
      const ih = ch * (kind === 'glass' ? 0.8 : kind === 'office' ? 0.62 : 0.5);
      const lit = c.state < litP;
      const style = c.r; // what kind of lit window
      if (!em) {
        // glass pane: dark with a reflected sky gradient
        const gr = g.createLinearGradient(0, iy, 0, iy + ih);
        gr.addColorStop(0, kind === 'glass' ? '#243a5c' : '#1a2438');
        gr.addColorStop(1, '#070a12');
        g.fillStyle = lit ? '#1b2335' : gr;
        g.fillRect(ix, iy, iw, ih);
        // frame
        g.strokeStyle = '#0a0d14';
        g.lineWidth = Math.max(1, S * 2);
        g.strokeRect(ix, iy, iw, ih);
        if (kind === 'office' || kind === 'glass') {
          g.beginPath();
          g.moveTo(ix + iw / 2, iy);
          g.lineTo(ix + iw / 2, iy + ih);
          g.stroke();
        }
        // ledge / sill
        g.fillStyle = '#2b3345';
        g.fillRect(c.x, c.y + ch - 4 * S, cw, 4 * S);
        g.fillStyle = '#10131c';
        g.fillRect(c.x, c.y + ch - 1.5 * S, cw, 1.5 * S);
        if (kind === 'resi' || kind === 'old') {
          // balcony slab + rail, AC box, pipes
          if (c.r2 < 0.34) {
            g.fillStyle = '#394155';
            g.fillRect(ix - 4 * S, iy + ih + 2 * S, iw + 8 * S, 4 * S);
            g.fillStyle = '#0c0f16';
            g.fillRect(ix - 4 * S, iy + ih - 7 * S, iw + 8 * S, 2 * S);
          }
          if (c.r2 > 0.62 && c.r2 < 0.8) {
            g.fillStyle = '#58606f';
            g.fillRect(ix + iw * 0.15, iy + ih + 3 * S, iw * 0.7, 8 * S);
            g.fillStyle = '#272c37';
            g.fillRect(ix + iw * 0.2, iy + ih + 5 * S, iw * 0.5, 4 * S);
          }
        }
        if (kind === 'old' && c.r2 > 0.94) {
          g.fillStyle = '#3b2432';
          g.fillRect(ix, iy, iw, ih); // boarded
        }
      } else if (lit) {
        let col: string;
        let a = 0.3 + c.r2 * 0.4;
        if (style < 0.12) col = '#ffbf80'; // a few warm rooms
        else if (style < 0.9) { col = '#a8c8e0'; a *= 0.8; } // dim cold white
        else col = '#4a8cff'; // TV blue
        g.globalAlpha = a;
        g.fillStyle = col;
        g.fillRect(ix, iy, iw, ih);
        g.globalAlpha = 1;
        // ceiling light bar / desks / people silhouettes (dark = no emission)
        g.fillStyle = 'rgba(0,0,0,0.5)';
        if (style >= 0.12 && style < 0.5) {
          g.fillRect(ix, iy + ih * 0.62, iw * 0.4, ih * 0.38); // desk
          g.fillRect(ix + iw * 0.55, iy + ih * 0.7, iw * 0.45, ih * 0.3);
        }
        if (c.r2 > 0.55 && style < 0.84) {
          // a person at the window
          const px = ix + iw * (0.25 + (c.r2 - 0.55) * 1.2);
          g.fillStyle = 'rgba(0,0,0,0.82)';
          g.beginPath();
          g.arc(px, iy + ih * 0.42, ih * 0.11, 0, Math.PI * 2);
          g.fill();
          g.fillRect(px - ih * 0.14, iy + ih * 0.53, ih * 0.28, ih * 0.47);
        }
        if (c.r2 < 0.2 && kind !== 'glass') {
          // blinds half drawn
          g.fillStyle = 'rgba(0,0,0,0.65)';
          const n = Math.max(3, Math.round(ih / (3 * S)));
          for (let i = 0; i < n * 0.6; i++) g.fillRect(ix, iy + i * (ih / n), iw, ih / n * 0.55);
        }
        if (kind === 'office' || kind === 'glass') {
          g.fillStyle = 'rgba(0,0,0,0.9)';
          g.fillRect(ix + iw / 2 - S, iy, 2 * S, ih);
        }
      }
    }
    if (!em) {
      // vertical pilasters / panel seams, grime gradient toward the bottom of the tile
      g.fillStyle = 'rgba(255,255,255,0.025)';
      for (let b = 0; b <= FACADE.bays; b++) g.fillRect(b * cw - S, 0, 2 * S, H);
      if (kind === 'glass') {
        const gg = g.createLinearGradient(0, 0, W, H);
        gg.addColorStop(0, 'rgba(120,170,255,0.09)');
        gg.addColorStop(0.5, 'rgba(0,0,0,0)');
        gg.addColorStop(1, 'rgba(255,120,200,0.07)');
        g.fillStyle = gg;
        g.fillRect(0, 0, W, H);
      }
    }
  };
  const map = tex(canvas(W, H, (g) => draw(g, false)), { repeat: true });
  const em = tex(canvas(W, H, (g) => draw(g, true)), { repeat: true });
  return { map, em };
}

/** Street-level shopfronts, 4 stalls per tile (tile = 16 m x 4.5 m). */
export const SHOP = { w: 16, h: 4.5 };
export function shopTile(seed: number, S = 1) {
  const W = Math.round(1024 * S);
  const H = Math.round(288 * S);
  const r = rng(seed);
  const names = ['ネオ麺', 'ゼロ薬局', 'コイン堂', '焼き鳥', '月影', '電脳堂', 'ミライ湯', 'カラオケ'];
  const hues = ['#5fc8e0', '#3fa8ff', '#5fc8e0', '#ff9a4a', '#ff3a4a', '#4a8cff'];
  const stalls = Array.from({ length: 4 }, () => ({ hue: hues[Math.floor(r() * hues.length)], shut: r() < 0.22, name: names[Math.floor(r() * names.length)], awn: r() < 0.6 }));
  const draw = (g: CanvasRenderingContext2D, em: boolean) => {
    g.fillStyle = em ? '#000' : '#14141c';
    g.fillRect(0, 0, W, H);
    const sw = W / 4;
    stalls.forEach((s, i) => {
      const x = i * sw;
      if (s.shut) {
        if (!em) {
          g.fillStyle = '#2a2d36';
          g.fillRect(x + sw * 0.08, H * 0.2, sw * 0.84, H * 0.72);
          g.fillStyle = '#1c1e26';
          for (let y = H * 0.22; y < H * 0.9; y += 5 * S) g.fillRect(x + sw * 0.08, y, sw * 0.84, 1.5 * S);
          g.fillStyle = '#6a2c7a';
          g.fillRect(x + sw * 0.2, H * 0.4, sw * 0.5, H * 0.18); // graffiti tag
        } else {
          g.fillStyle = 'rgba(255,60,190,0.35)';
          g.fillRect(x + sw * 0.2, H * 0.4, sw * 0.5, H * 0.18);
        }
      } else {
        const gx = x + sw * 0.08;
        const gy = H * 0.22;
        const gw = sw * 0.84;
        const gh = H * 0.7;
        if (!em) {
          g.fillStyle = '#0a0c12';
          g.fillRect(gx, gy, gw, gh);
        } else {
          const gr = g.createLinearGradient(0, gy, 0, gy + gh);
          gr.addColorStop(0, s.hue);
          gr.addColorStop(1, 'rgba(0,0,0,0.25)');
          g.globalAlpha = 0.85;
          g.fillStyle = gr;
          g.fillRect(gx, gy, gw, gh);
          g.globalAlpha = 1;
          // shelves and goods, counter, a silhouette of the owner
          g.fillStyle = 'rgba(0,0,0,0.55)';
          for (let k = 0; k < 3; k++) g.fillRect(gx + 4 * S, gy + gh * (0.18 + k * 0.22), gw - 8 * S, 2 * S);
          g.fillStyle = 'rgba(0,0,0,0.7)';
          g.fillRect(gx, gy + gh * 0.72, gw, gh * 0.28);
          g.beginPath();
          g.arc(gx + gw * 0.62, gy + gh * 0.42, gh * 0.08, 0, Math.PI * 2);
          g.fill();
          g.fillRect(gx + gw * 0.62 - gh * 0.1, gy + gh * 0.5, gh * 0.2, gh * 0.25);
        }
        g.strokeStyle = em ? '#000' : '#232734';
        g.lineWidth = 3 * S;
        g.strokeRect(gx, gy, gw, gh);
      }
      // awning
      if (s.awn && !em) {
        for (let k = 0; k < 8; k++) {
          g.fillStyle = k % 2 ? '#7a1f2c' : '#d9d2c4';
          g.fillRect(x + sw * 0.04 + (k * sw * 0.92) / 8, H * 0.12, (sw * 0.92) / 8, H * 0.1);
        }
      }
      // lintel sign
      g.font = `900 ${H * 0.14}px ${JP}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (em) {
        g.shadowColor = s.hue;
        g.shadowBlur = 8 * S;
        g.fillStyle = s.hue;
        g.fillText(s.name, x + sw / 2, H * 0.07);
        g.shadowBlur = 0;
      } else {
        g.fillStyle = '#05060a';
        g.fillRect(x + sw * 0.1, 0, sw * 0.8, H * 0.14);
      }
    });
  };
  return { map: tex(canvas(W, H, (g) => draw(g, false)), { repeat: true }), em: tex(canvas(W, H, (g) => draw(g, true)), { repeat: true }) };
}

/** The vertical blade signs: 8 cols x 4 rows of 128 x 512 cells. Returns UV rects by index. */
export const SIGN_COLS = 8;
export const SIGN_ROWS = 4;
type SignDef = { t: string; c: string; latin?: boolean; sub?: string; frame?: 'box' | 'none' };
export const SIGNS: SignDef[] = [
  { t: 'ネオン酒場', c: '#2ec8e0' },
  { t: '夜明け麺', c: '#ff9a3a' },
  { t: 'ミライ湯', c: '#3fa8ff' },
  { t: '電脳カフェ', c: '#2ec8e0' },
  { t: 'ゼロ薬局', c: '#3fb8d8' },
  { t: 'コイン堂', c: '#ff9a3a' },
  { t: '月影バー', c: '#3a7bff' },
  { t: 'トークン市場', c: '#ff2a46' },
  { t: 'ニンジャ堂', c: '#ff2a46', sub: 'NPG' },
  { t: 'エヌスレイブ', c: '#ff2a3a', sub: 'nSLAVE' },
  { t: 'bWalletX', c: '#4da3ff', latin: true },
  { t: 'TOKENBLASTER', c: '#ff9a3a', latin: true },
  { t: 'NPG', c: '#ff2a46', latin: true },
  { t: '焼き鳥', c: '#ff9a3a' },
  { t: 'カラオケ', c: '#3a7bff' },
  { t: '二十四時間', c: '#6fd8e8' },
  { t: 'ゲーム街', c: '#2ec8e0' },
  { t: 'スシ・ゼロ', c: '#ff2a46' },
  { t: 'ホテル月光', c: '#6fb0ff' },
  { t: '人工天使', c: '#2ec8e0' },
  { t: '電気街', c: '#3fa8ff' },
  { t: 'BLOCK 21', c: '#27d8f0', latin: true },
  { t: '夜勤', c: '#ff2a46' },
  { t: '麻雀', c: '#3fb8d8' },
  { t: 'ビットコイン', c: '#ff9a3a' },
  { t: '仮想通貨', c: '#2ec8e0' },
  { t: '光の庭', c: '#8fd8e8' },
  { t: '鉄骨酒場', c: '#3a7bff' },
  { t: 'サイバー整体', c: '#3a7bff' },
  { t: '雨宿り', c: '#3fa8ff' },
  { t: 'ドローン便', c: '#2ec8e0' },
  { t: '未来堂', c: '#3fa8ff' },
];

export function signAtlas(S = 1) {
  const cw = 128 * S;
  const chh = 512 * S;
  const W = cw * SIGN_COLS;
  const H = chh * SIGN_ROWS;
  const c = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    SIGNS.forEach((s, i) => {
      const col = i % SIGN_COLS;
      const row = Math.floor(i / SIGN_COLS);
      const x0 = col * cw;
      const y0 = row * chh;
      g.save();
      g.translate(x0, y0);
      // backing panel
      g.fillStyle = 'rgba(8,6,16,0.82)';
      g.fillRect(8 * S, 6 * S, cw - 16 * S, chh - 12 * S);
      // double neon frame
      g.shadowColor = s.c;
      g.shadowBlur = 14 * S;
      g.strokeStyle = s.c;
      g.lineWidth = 4 * S;
      g.strokeRect(12 * S, 10 * S, cw - 24 * S, chh - 20 * S);
      g.lineWidth = 1.5 * S;
      g.strokeRect(19 * S, 17 * S, cw - 38 * S, chh - 34 * S);
      g.fillStyle = s.c;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (s.latin) {
        g.save();
        g.translate(cw / 2, chh / 2);
        g.rotate(-Math.PI / 2);
        const fs = Math.min(76 * S, (chh - 70 * S) / (s.t.length * 0.62));
        g.font = `900 ${fs}px Impact, "Arial Black", sans-serif`;
        g.fillText(s.t, 0, 0);
        g.restore();
      } else {
        const chars = [...s.t];
        const subH = s.sub ? 80 * S : 0;
        const avail = chh - 70 * S - subH;
        const fs = Math.min(74 * S, avail / chars.length);
        g.font = `900 ${fs}px ${JP}`;
        chars.forEach((ch, k) => g.fillText(ch, cw / 2, 36 * S + fs * (k + 0.55)));
        if (s.sub) {
          g.save();
          g.translate(cw / 2, chh - 44 * S - subH / 2);
          g.rotate(-Math.PI / 2);
          g.font = `800 ${24 * S}px Arial, sans-serif`;
          g.fillText(s.sub, 0, 0);
          g.restore();
        }
      }
      // little bulbs on the frame
      g.shadowBlur = 8 * S;
      g.fillStyle = '#fff';
      for (let k = 0; k < 9; k++) g.fillRect(cw / 2 - 1.5 * S, 24 * S + k * ((chh - 60 * S) / 8), 3 * S, 3 * S);
      g.restore();
    });
  });
  return { texture: tex(c, { aniso: 4 }), rect: (i: number) => [(i % SIGN_COLS) / SIGN_COLS, 1 - (Math.floor(i / SIGN_COLS) + 1) / SIGN_ROWS, 1 / SIGN_COLS, 1 / SIGN_ROWS] as const };
}

/** Hologram billboard atlas: 4 x 2 panels of 512 x 512 (square). */
export const AD_COLS = 4;
export const AD_ROWS = 2;
export function adAtlas(S = 1) {
  const P = 512 * S;
  const c = canvas(P * AD_COLS, P * AD_ROWS, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, P * AD_COLS, P * AD_ROWS);
    const panel = (i: number, draw: (g: CanvasRenderingContext2D) => void) => {
      g.save();
      g.translate((i % AD_COLS) * P, Math.floor(i / AD_COLS) * P);
      g.beginPath();
      g.rect(0, 0, P, P);
      g.clip();
      g.scale(S, S);
      draw(g);
      g.restore();
    };
    const center = (g: CanvasRenderingContext2D, t: string, y: number, size: number, col: string, font = `900 ${size}px ${JP}`, blur = 20) => {
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = col;
      g.shadowBlur = blur;
      g.fillStyle = col;
      g.fillText(t, 256, y);
      g.shadowBlur = 0;
    };
    // 0: nSLAVE with the eye
    panel(0, (g) => {
      g.strokeStyle = '#ff3226';
      g.lineWidth = 8;
      g.shadowColor = '#ff2a1a';
      g.shadowBlur = 24;
      g.beginPath();
      g.ellipse(256, 190, 170, 86, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ff3a2a';
      g.beginPath();
      g.arc(256, 190, 48, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(250, 142, 12, 96);
      g.shadowBlur = 0;
      center(g, 'nSLAVE', 340, 74, '#f4f7ff', '900 74px "Arial Black", Impact, sans-serif', 14);
      center(g, 'S Y S T E M S', 400, 34, '#ff5646', '700 34px Arial, sans-serif', 10);
      center(g, 'エヌスレイブ・システムズ', 456, 30, '#ffb0a8', `700 30px ${JP}`, 8);
    });
    panel(1, (g) => {
      center(g, 'TOKEN', 190, 110, '#ffb800', '900 italic 110px Impact, "Arial Black", sans-serif');
      center(g, 'BLASTER', 300, 110, '#ffb800', '900 italic 110px Impact, "Arial Black", sans-serif');
      center(g, 'トークンブラスター', 400, 40, '#ffe27a', `900 40px ${JP}`, 12);
      center(g, '撃て。ブロックを。', 456, 30, '#ff8a3a', `700 30px ${JP}`, 8);
    });
    panel(2, (g) => {
      g.strokeStyle = '#4da3ff';
      g.lineWidth = 10;
      g.shadowColor = '#2f7bff';
      g.shadowBlur = 22;
      g.beginPath();
      g.roundRect(150, 70, 212, 168, 28);
      g.stroke();
      g.beginPath();
      g.moveTo(150, 120);
      g.lineTo(362, 120);
      g.stroke();
      g.shadowBlur = 0;
      center(g, 'bWalletX', 340, 94, '#8fc4ff', '900 94px "Arial Black", Impact, sans-serif', 18);
      center(g, 'ビー・ウォレット', 424, 38, '#cfe4ff', `700 38px ${JP}`, 10);
    });
    panel(3, (g) => {
      center(g, 'NPG', 200, 190, '#ff2a46', '900 italic 190px Impact, "Arial Black", sans-serif', 28);
      center(g, 'NINJA PUNK GIRLS', 340, 44, '#ffc0c8', '800 44px Arial, sans-serif', 10);
      center(g, 'ニンジャ・パンク・ガールズ', 410, 32, '#ff7a88', `700 32px ${JP}`, 8);
    });
    panel(4, (g) => {
      center(g, 'NEO TOKYO', 190, 86, '#2ec8e0', '900 86px "Arial Black", Impact, sans-serif', 24);
      center(g, '2048', 300, 150, '#ff2a46', '900 150px "Arial Black", Impact, sans-serif', 26);
      center(g, 'ネオ東京', 410, 66, '#cfeaf4', `900 66px ${JP}`, 14);
    });
    panel(5, (g) => {
      // nSLAVE corporate slogan: the patent (deadpan)
      center(g, 'nSLAVE', 110, 80, '#f4f7ff', '900 80px "Arial Black", Impact, sans-serif', 16);
      center(g, 'NOW PATENTED:', 214, 40, '#ff5646', '800 40px Arial, sans-serif', 10);
      center(g, 'YOUR SOUL.', 290, 84, '#ff2a3a', '900 84px "Arial Black", Impact, sans-serif', 24);
      center(g, 'あなたの魂に特許を', 400, 44, '#ffb0a8', `800 44px ${JP}`, 10);
      center(g, 'terms apply · see you in court', 462, 22, '#8a98a8', '600 22px Arial, sans-serif', 0);
    });
    panel(6, (g) => {
      // nSLAVE's product: the chain your patented soul is stored on
      center(g, 'nSLAVE', 84, 54, '#f4f7ff', '900 54px "Arial Black", Impact, sans-serif', 12);
      center(g, 'SOUL', 190, 118, '#ff2a3a', '900 118px "Arial Black", Impact, sans-serif', 24);
      center(g, 'CHAIN™', 300, 96, '#2ec8e0', '900 96px "Arial Black", Impact, sans-serif', 22);
      center(g, '(chain of tools)', 380, 30, '#ffc0b8', 'italic 700 30px Arial, sans-serif', 8);
      center(g, 'ソウルチェーン', 450, 42, '#80d8e8', `800 42px ${JP}`, 10);
    });
    panel(7, (g) => {
      // nSLAVE corporate slogan: open source, one chain only
      center(g, 'nSLAVE', 96, 66, '#f4f7ff', '900 66px "Arial Black", Impact, sans-serif', 14);
      center(g, '100% OPEN SOURCE', 190, 46, '#2ec8e0', '800 46px Arial, sans-serif', 12);
      center(g, 'BUILD ON ANY CHAIN', 262, 38, '#c0e8f0', '700 38px Arial, sans-serif', 8);
      center(g, 'AS LONG AS IT’S BSV', 330, 40, '#ff9a3a', '800 40px Arial, sans-serif', 12);
      center(g, 'どのチェーンでも。BSVなら。', 420, 34, '#80d8e8', `700 34px ${JP}`, 8);
    });
  });
  return { texture: tex(c, { aniso: 4 }), rect: (i: number) => [(i % AD_COLS) / AD_COLS, 1 - (Math.floor(i / AD_COLS) + 1) / AD_ROWS, 1 / AD_COLS, 1 / AD_ROWS] as const };
}

/** Vending machines: three designs in a 3-cell strip (each 128 x 256). */
export function vendingTex(S = 1) {
  const W = 384 * S;
  const H = 256 * S;
  const defs = [
    { c: '#2ec8e0', name: 'ネオ茶', cans: ['#ff4a4a', '#e8b040', '#5fc8e0', '#4a7cd8'] },
    { c: '#3a8cff', name: 'ゼロ水', cans: ['#8fd8e8', '#d8e8f0', '#4a7cd8', '#ff9a3a'] },
    { c: '#ff9a3a', name: '電池・麺', cans: ['#ff8a3a', '#ff3b3b', '#5fc8e0', '#e6e6e6'] },
  ];
  const draw = (g: CanvasRenderingContext2D, em: boolean) => {
    g.fillStyle = em ? '#000' : '#1b1e27';
    g.fillRect(0, 0, W, H);
    defs.forEach((d, i) => {
      const x = i * 128 * S;
      // header
      g.fillStyle = em ? d.c : '#222633';
      g.fillRect(x + 8 * S, 8 * S, 112 * S, 30 * S);
      g.fillStyle = em ? '#000' : d.c;
      g.font = `900 ${20 * S}px ${JP}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(d.name, x + 64 * S, 24 * S);
      // glass front with rows of cans
      g.fillStyle = em ? 'rgba(255,255,255,0.4)' : '#0b0d13';
      g.fillRect(x + 8 * S, 44 * S, 112 * S, 140 * S);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 5; col++) {
          g.fillStyle = d.cans[(row + col) % 4];
          g.globalAlpha = em ? 0.9 : 0.55;
          g.fillRect(x + (14 + col * 21) * S, (50 + row * 33) * S, 14 * S, 26 * S);
          g.globalAlpha = 1;
        }
      // buttons, coin slot, pickup flap
      for (let b = 0; b < 5; b++) {
        g.fillStyle = em ? d.c : '#3a3f4e';
        g.fillRect(x + (14 + b * 21) * S, 192 * S, 14 * S, 8 * S);
      }
      g.fillStyle = em ? '#000' : '#07080c';
      g.fillRect(x + 20 * S, 214 * S, 88 * S, 28 * S);
    });
  };
  return { map: tex(canvas(W, H, (g) => draw(g, false))), em: tex(canvas(W, H, (g) => draw(g, true))) };
}

/** Far skyline silhouettes (alpha cards) with scattered lit windows, neon and aircraft lights. */
export function skylineTex(seed: number, tone: string, haze: string, density: number, S = 1) {
  const W = 2048 * S;
  const H = 512 * S;
  const r = rng(seed);
  const c = canvas(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    let x = 0;
    while (x < W) {
      const bw = (30 + r() * 90) * S;
      const bh = (60 + Math.pow(r(), 1.6) * 380) * S;
      g.fillStyle = tone;
      g.fillRect(x, H - bh, bw, bh);
      if (r() < 0.35) g.fillRect(x + bw * 0.2, H - bh - 40 * S * r(), bw * 0.6, 40 * S);
      if (r() < 0.18) g.fillRect(x + bw * 0.48, H - bh - 70 * S, 3 * S, 70 * S); // mast
      // lit windows
      for (let wy = H - bh + 6 * S; wy < H - 4 * S; wy += 9 * S)
        for (let wx = x + 4 * S; wx < x + bw - 4 * S; wx += 7 * S)
          if (r() < density) {
            const v = r();
            g.fillStyle = v > 0.93 ? '#ff6a6a' : v > 0.82 ? '#ffc890' : v > 0.3 ? '#8fb8e0' : '#5fd0e0';
            g.globalAlpha = 0.35 + r() * 0.5;
            g.fillRect(wx, wy, 3 * S, 4 * S);
            g.globalAlpha = 1;
          }
      // vertical neon sign on some
      if (r() < 0.22) {
        const col = ['#ff2a46', '#2ec8e0', '#3a8cff', '#2ec8e0'][Math.floor(r() * 4)];
        g.fillStyle = col;
        g.globalAlpha = 0.9;
        g.fillRect(x + bw - 6 * S, H - bh + 18 * S, 4 * S, (50 + r() * 100) * S);
        g.globalAlpha = 1;
      }
      // aircraft light on tall ones
      if (bh > 300 * S && r() < 0.7) {
        g.fillStyle = '#ff3030';
        g.fillRect(x + bw * 0.5 - 2 * S, H - bh - 3 * S, 4 * S, 4 * S);
      }
      x += bw + r() * 6 * S;
    }
    // haze: the bottom and the whole layer drift toward the sky colour
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, haze);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  });
  const t = tex(c, { repeat: false });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** nSLAVE curtain wall: fine grid, spandrel bands, reflective gradient, lit floors (map + emissive). */
export function curtainWall(S = 1) {
  const W = 1024 * S;
  const H = 1024 * S;
  const cols = 16;
  const rows = 20;
  const r = rng(77);
  const lit: number[] = [];
  for (let i = 0; i < cols * rows; i++) lit.push(r());
  const draw = (g: CanvasRenderingContext2D, em: boolean) => {
    g.fillStyle = em ? '#000' : '#08101e';
    g.fillRect(0, 0, W, H);
    const cw = W / cols;
    const rh = H / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const l = lit[y * cols + x];
        if (!em) {
          const gr = g.createLinearGradient(x * cw, y * rh, x * cw + cw, y * rh + rh);
          gr.addColorStop(0, '#16294a');
          gr.addColorStop(1, '#070d1a');
          g.fillStyle = gr;
          g.fillRect(x * cw + 1, y * rh + 1, cw - 2, rh * 0.82);
          g.fillStyle = '#0e1626'; // spandrel
          g.fillRect(x * cw, y * rh + rh * 0.84, cw, rh * 0.16);
        } else if (l > 0.88) {
          g.globalAlpha = 0.25 + (l - 0.88) * 2.2;
          g.fillStyle = l > 0.97 ? '#ffc890' : '#9fc4e8';
          g.fillRect(x * cw + 2, y * rh + 2, cw - 4, rh * 0.78);
          g.globalAlpha = 1;
        }
      }
    g.strokeStyle = em ? '#000' : '#1b2740';
    g.lineWidth = Math.max(1, 2 * S);
    for (let x = 0; x <= cols; x++) {
      g.beginPath();
      g.moveTo(x * (W / cols), 0);
      g.lineTo(x * (W / cols), H);
      g.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      g.beginPath();
      g.moveTo(0, y * (H / rows));
      g.lineTo(W, y * (H / rows));
      g.stroke();
    }
  };
  return { map: tex(canvas(W, H, (g) => draw(g, false)), { repeat: true, aniso: 8 }), em: tex(canvas(W, H, (g) => draw(g, true)), { repeat: true, aniso: 8 }) };
}

/** The lit lobby seen through the glass: ceiling light panels, reception desk, people, a wall display. */
export function lobbyTex(S = 1) {
  const W = 1024 * S;
  const H = 256 * S;
  const c = canvas(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#fff2d6');
    gr.addColorStop(0.55, '#ffd9a0');
    gr.addColorStop(1, '#a8764a');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 8; i++) g.fillRect(i * (W / 8) + W / 32, 8 * S, W / 16, 6 * S); // ceiling panels
    g.fillStyle = 'rgba(40,24,14,0.55)';
    for (let i = 0; i <= 16; i++) g.fillRect(i * (W / 16) - S, 0, 2 * S, H); // columns / glazing
    g.fillStyle = 'rgba(60,30,20,0.75)';
    g.fillRect(W * 0.3, H * 0.62, W * 0.4, H * 0.14); // reception desk
    // people silhouettes
    g.fillStyle = 'rgba(20,10,6,0.85)';
    for (const px of [0.12, 0.22, 0.4, 0.58, 0.77, 0.9]) {
      g.beginPath();
      g.arc(W * px, H * 0.46, H * 0.04, 0, Math.PI * 2);
      g.fill();
      g.fillRect(W * px - H * 0.05, H * 0.5, H * 0.1, H * 0.34);
    }
    // wall display with the eye
    g.fillStyle = '#240406';
    g.fillRect(W * 0.38, H * 0.1, W * 0.24, H * 0.36);
    g.fillStyle = '#ff3226';
    g.beginPath();
    g.ellipse(W * 0.5, H * 0.28, W * 0.07, H * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.fillRect(W * 0.498, H * 0.19, W * 0.004, H * 0.18);
  });
  return tex(c);
}

/** Soft radial glow used for light pools, rain-streaked lights and lantern glows. */
let _glow: THREE.Texture | null = null;
export function softGlow() {
  if (_glow) return _glow;
  _glow = tex(
    canvas(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }),
    { srgb: false },
  );
  return _glow;
}

/** A thin ring for rain ripples. */
let _ring: THREE.Texture | null = null;
export function ringTex() {
  if (_ring) return _ring;
  _ring = tex(
    canvas(128, 128, (g) => {
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
    }),
    { srgb: false },
  );
  return _ring;
}
