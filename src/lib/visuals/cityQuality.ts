/**
 * Satoshi City quality tier: 'high' (GTAO, full-res, 2k shadows, glow, puddles, ticker billboards)
 * or 'low' (no AO, 1x pixels, 1k shadows, no glow sprites). Auto-picked from the device, saved when
 * the player toggles it, and dropped to 'low' by the frame-time watchdog on slow machines.
 */
export type CityQuality = 'low' | 'high';

export const CITY_QUALITY_KEY = 'tokenblaster:city-quality';

export const QUALITY_PRESETS: Record<CityQuality, { pixelRatio: number; shadowMap: number; ao: boolean; glow: boolean; puddles: boolean; bloomScale: number }> = {
  high: { pixelRatio: 1.75, shadowMap: 2048, ao: true, glow: true, puddles: true, bloomScale: 1 },
  low: { pixelRatio: 1, shadowMap: 1024, ao: false, glow: false, puddles: false, bloomScale: 0.7 },
};

export function autoCityQuality(): CityQuality {
  try {
    const forced = new URLSearchParams(location.search).get('gfx');
    if (forced === 'low' || forced === 'high') return forced;
    const saved = localStorage.getItem(CITY_QUALITY_KEY);
    if (saved === 'low' || saved === 'high') return saved;
  } catch {
    /* storage blocked */
  }
  if (typeof navigator === 'undefined') return 'high';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return coarse || small || weak ? 'low' : 'high';
}

export function saveCityQuality(q: CityQuality) {
  try {
    localStorage.setItem(CITY_QUALITY_KEY, q);
  } catch {
    /* storage blocked */
  }
}
