/**
 * The landing hero's footage deck: short, silent 720p practice-mode gameplay captures of the arcade
 * (public/landing/clips, made by scripts/landing-clips.mjs). The first entry is the lead clip: its poster is
 * the server-rendered first paint (the LCP image), so it stays fixed while the rest of the deck shuffles.
 */
export type Clip = { id: string; title: string; href: string; code: string; kana?: string };

const clip = (id: string, title: string, href: string, n: number, kana?: string): Clip => ({ id, title, href, code: `TB-F${String(n).padStart(2, '0')}`, kana });

export const LANDING_CLIPS: Clip[] = [
  clip('bracer', 'bRacer', '/arcade/bracer', 1, '反重力レース'),
  clip('arena', 'Arena', '/arena', 2, 'アリーナ'),
  clip('npg-arena', 'NPG Arena', '/arcade/npg-arena', 3, 'ニンジャ・パンク'),
  clip('frogger', 'Chain Frogger', '/arcade/frogger', 5, 'チェーン横断'),
  clip('bsvgun', 'BSVGun', '/arcade/bsvgun', 6, '射撃場'),
  clip('rally', 'Token Rally', '/arcade/rally', 7, 'ラリー'),
  clip('city', 'Satoshi City', '/arcade/city', 8, 'サトシ市'),
  clip('invaders', 'Mempool Invaders', '/arcade/invaders', 9, 'メムプール'),
  clip('snake', 'Token Snake', '/arcade/snake', 10, 'スネーク'),
  clip('hopper', 'Block Hopper', '/arcade/hopper', 11, 'ブロック'),
  clip('highway21', 'Highway 21M', '/arcade/highway21', 12, 'ハイウェイ'),
  // Captured by the script but out of the deck: Kweg's Expedition and NPG: Erobot Uprising (flat 2D frames read as a
  // different product next to the 3D cabinets) and Double-O Satoshi (the headless agent walks into a wall of bloom;
  // needs a hand-driven take). Add them back here once the footage is right.
];

export const clipSrc = (c: Clip) => `/landing/clips/${c.id}.mp4`;
export const clipPoster = (c: Clip) => `/landing/clips/${c.id}.jpg`;
