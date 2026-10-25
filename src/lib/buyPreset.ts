/**
 * `/launch/<id>?buy=<usd>`: a link (bChatX's "BUY $TOKEN to join" card, a tweet) can open a coin's
 * Buy panel with a dollar amount already filled in. The amount is converted to BSV at the live rate
 * and clamped to one buy's limits; the user still checks the quote and confirms in their wallet.
 * Pure, so the browser and the tests share it.
 */
import { MAX_BUY, MIN_BUY } from './launch/curve';

/** Biggest preset a link may ask for, in USD. Anything above is ignored, not clamped. */
export const MAX_PRESET_USD = 10_000;

/** The `buy` query value as dollars, or null when it is missing or not a sane amount. */
export function parseBuyUsd(raw: string | string[] | null | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return null;
  const t = s.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_PRESET_USD ? n : null;
}

/** Dollars → the Buy input's BSV string (8 dp, trailing zeros trimmed), inside one buy's limits. Null with no rate. */
export function presetBsv(usd: number, rate: number): string | null {
  if (!(usd > 0) || !(rate > 0)) return null;
  const sats = Math.min(MAX_BUY, Math.max(MIN_BUY, Math.round((usd / rate) * 1e8)));
  return (sats / 1e8).toFixed(8).replace(/\.?0+$/, '');
}
