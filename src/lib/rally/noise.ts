/** Small deterministic helpers: seeded RNG + smooth value noise for terrain and scenery. */

/** mulberry32: tiny, fast, seedable. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash2 = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise in [0,1]. */
export function vnoise(x: number, y: number, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise, roughly in [-1,1]. */
export function fbm(x: number, y: number, seed = 0, oct = 4) {
  let amp = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += (vnoise(x * f, y * f, seed + i * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** 1D smooth noise in [-1,1]. */
export const noise1 = (x: number, seed = 0) => vnoise(x, seed * 7.31 + 0.5, seed) * 2 - 1;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
