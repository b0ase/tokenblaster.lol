/**
 * Mobile-lite render tier (owner, 26 Oct: "TERRORNODE crashes my phone"). iOS Safari kills a tab that holds too
 * much GPU memory, so phones get a lighter build of the same game: no HDR environment, no post-processing,
 * no shadows, a capped pixel ratio, textures at most 1024px, the heaviest models skipped and one WebGL context.
 * `?q=lite` forces it on, `?q=high` / `?q=low` force it off (screenshot scripts, testing on a laptop).
 */
export const LITE_DPR = 1.25;
export const LITE_TEX = 1024;
/** Models the lite tier never downloads (helldemon.glb alone is 4.4 MB). */
export const LITE_SKIP_MONSTERS: readonly string[] = ['helldemon'];

function mobileOS(ua: string) {
  return /iPhone|iPod|iPad|Android/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** A phone-sized touch screen (shorter side <= 600 CSS px). */
export function isPhone(): boolean {
  if (typeof window === 'undefined') return false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
  const short = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return touch && short <= 600 && mobileOS(navigator.userAgent);
}

export function isMobileLite(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'lite') return true;
  if (q === 'high' || q === 'low') return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isPhone() || (typeof mem === 'number' && mem <= 2);
}
