/**
 * Per-coin extras for the bWalletX Exchange (agreed 25 Oct 2026), checked in so they need no migration.
 * Keyed by token_id. Every field is optional. Rules (tested in src/lib/coinMeta.test.ts):
 *  - theme: the bWalletX theme v2 schema (public/.well-known/bwalletx-theme.json, docs/wallet-theme.md): v, name, mode,
 *    accent, accentHi, bg, surface, text, logo, cardArt. Images are same-origin paths on tokenblaster.lol (under public/),
 *    logo ≤ 64 KB, cardArt ≤ 256 KB; text on bg/surface ≥ 4.5:1, accent on bg ≥ 3:1.
 *  - room: a bChatX room ticker, ^[A-Z0-9]{1,20}$.
 *  - merch_url: an https URL.
 * Every coin also gets `trading` (false for play-to-earn coins such as $TERRORNODE until they graduate at
 * GRADUATE_AT receipts issued: then true, curve buy/sell). A play-to-earn coin also gets `earn_url` (earning carries
 * on after graduation), `receipts_issued` and `graduate_at`, and while not trading `category: 'reward'` (bWalletX Rewards).
 */
import { price } from './curve';
import { EARN_URL, GRADUATE_AT, NO_TRADE, tradingOf } from './receipts';

export type CoinTheme = {
  v: 2;
  name: string;
  mode: 'dark' | 'light';
  accent: string;
  accentHi: string;
  bg: string;
  surface: string;
  text: string;
  logo: string;
  cardArt: string;
};
export type CoinMeta = { theme?: CoinTheme; room?: string; merch_url?: string };

export const SITE = 'https://www.tokenblaster.lol'; // the apex 308s here; the wallet wants same-origin images

const TOKENBLASTER: CoinTheme = {
  v: 2,
  name: 'TokenBlaster',
  mode: 'dark',
  accent: '#FF3B30',
  accentHi: '#FFB800',
  bg: '#0A0A0C',
  surface: '#121317',
  text: '#F2EFE6',
  logo: '/brand/wallet-logo.png',
  cardArt: '/brand/wallet-card.jpg',
};

export const COIN_META: Record<string, CoinMeta> = {
  // $ARENA, the Arena's house coin
  '79d84d2f194ef324837b6dc69e39afc404d1a1dc3cbadb0215d5fa06c2269a0f_1': { theme: { ...TOKENBLASTER, name: 'Arena' }, room: 'ARENA' },
};

/**
 * The API fields for one coin: price_sats from the curve, plus any checked-in extras (images as absolute URLs).
 * `issued` = $TERRORNODE receipts issued (src/lib/launch/receiptsIssued.ts); null: unknown (not graduated).
 */
export function coinExtras(row: { token_id?: string; sold?: number | string | null }, issued: number | null = null) {
  const sold = BigInt(row.sold ?? 0);
  const m = COIN_META[row.token_id ?? ''] ?? {};
  const theme = m.theme ? { ...m.theme, logo: SITE + m.theme.logo, cardArt: SITE + m.theme.cardArt } : undefined;
  const earned = NO_TRADE.has(row.token_id ?? '');
  const trading = tradingOf(row.token_id, issued);
  // A play-to-earn coin has no curve price (receipts are priced per token at /api/terrornode/receipts): no stale number.
  return {
    price_sats: trading ? price(sold) : null,
    trading,
    ...(earned && { earn_url: EARN_URL, earn_label: 'Play Welcome to TERRORNODE', receipts_url: `${SITE}/api/terrornode/receipts`, receipts_issued: issued, graduate_at: GRADUATE_AT }),
    ...(!trading && { category: 'reward' as const }), ...(theme && { theme }), ...(m.room && { room: m.room }), ...(m.merch_url && { merch_url: m.merch_url }),
  };
}

export const withExtras = <T extends { token_id?: string; sold?: number | string | null }>(row: T, issued: number | null = null) => ({ ...row, ...coinExtras(row, issued) });
