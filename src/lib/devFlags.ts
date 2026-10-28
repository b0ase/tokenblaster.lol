/**
 * Dev-only switches. Each is inlined at build time and is FALSE in every production build (NODE_ENV=production),
 * so neither can reach tokenblaster.lol. next.config.ts also refuses to build on Vercel with either set.
 *  - GALLERY_FREE_PLAY: NEXT_PUBLIC_GALLERY_PAID=0 on `next dev` runs TERRORNODE unpaid (simulated network).
 *  - CAPTURE_BUILD: NEXT_PUBLIC_TB_CAPTURE=1 on `next dev` opens games with no coin-op gate, for local headless
 *    gameplay captures (bGamesX cards / bAds).
 */
const DEV = process.env.NODE_ENV !== 'production';
export const GALLERY_FREE_PLAY = DEV && process.env.NEXT_PUBLIC_GALLERY_PAID === '0';
export const CAPTURE_BUILD = DEV && process.env.NEXT_PUBLIC_TB_CAPTURE === '1';
/** Paid play: always true in production. */
export const GALLERY_PAID = !GALLERY_FREE_PLAY;
