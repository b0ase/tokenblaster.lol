/**
 * Coin-op arcade credit (owner, 24 Oct 2026). Pure: the cabinet, the gate, the gallery and the tests share it.
 *
 * How credit works:
 *  1. The coin buttons ($0.01 … $1) only add to a running total on screen. Nothing is paid per press.
 *  2. PAY sends ONE wallet request for the whole total (dollars first, turned into sats at the live
 *     /api/price BSV/USD rate). That one approval funds the player's own in-browser gun (src/lib/gun.ts).
 *  3. The CREDIT counter is the gun's balance in dollars. It lives on chain, at the player's own gun key in
 *     this browser: non-custodial, no server ledger, nothing for the server to trust. No refunds (owner, 24 Oct 2026):
 *     unused credit stays in the gun for later plays.
 *  4. Each play then pays its price from the gun to the HOUSE address in one transaction with an OP_RETURN
 *     tag ("tokenblaster.lol" … "coinop" <game> <name>), so every play is verifiable on chain.
 */
export const COINS_USD = [0.01, 0.1, 0.2, 0.5, 1] as const;
/** The minimum credit before NAME and START unlock (owner may change). */
export const MIN_CREDIT_USD = 0.1;
/** Never ask the wallet for more than this in one PAY (a typo guard, not a limit on play). */
export const MAX_PAY_USD = 100;

/** The price of one play, per game, in US dollars. The owner changes these. Not listed: DEFAULT_PLAY_USD. */
export const DEFAULT_PLAY_USD = 0.1;
export const PLAY_PRICE_USD: Record<string, number> = {
  '2048': 0.1,
  bracer: 0.1,
  bsvgun: 0.1,
  'bubbo-bubbo': 0.1,
  city: 0.1,
  doubleosatoshi: 0.1,
  frogger: 0.1,
  highway21: 0.1,
  hopper: 0.1,
  invaders: 0.1,
  kweg: 0.1,
  'npg-arena': 0.1,
  'npg-cards': 0.1,
  'npg-runner': 0.1,
  'puzzling-potions': 0.1,
  rally: 0.1,
  snake: 0.1,
  arena: 0.1,
  // The Shooting Gallery has no play price: the credit is the ammunition (network cost per shot + platform fee).
  gallery: 0,
};
/** The wallet sheet's description for a coin-op payment: the game's own name, never another game's. */
export const payLabel = (game: string, usd: number) => `${game}: ${usd.toFixed(2)} USD credit`;
export const playPriceUsd = (game: string) => PLAY_PRICE_USD[game] ?? DEFAULT_PLAY_USD;

/** Add a coin to the pending total, in whole cents so 0.1 + 0.2 is 0.30, not 0.30000000000000004. */
export const addCoin = (totalUsd: number, coinUsd: number) => Math.round(totalUsd * 100 + coinUsd * 100) / 100;

/** Dollars → sats at `bsvUsd`, rounded UP to a whole sat. null without a usable rate. */
export function usdToSats(usd: number, bsvUsd: number | null | undefined): number | null {
  if (!bsvUsd || !Number.isFinite(bsvUsd) || bsvUsd <= 0 || !Number.isFinite(usd) || usd <= 0) return null;
  return Math.ceil(Number(((usd * 1e8) / bsvUsd).toPrecision(12)));
}
/** Sats → dollars at `bsvUsd`. */
export const satsToUsd = (sats: number, bsvUsd: number | null | undefined) => (bsvUsd && bsvUsd > 0 ? (sats / 1e8) * bsvUsd : 0);

/** The CREDIT counter: always two decimals, floored so it never shows more than is there. */
export const fmtCredit = (usd: number) => `$${(Math.floor(Math.max(0, usd) * 100 + 1e-6) / 100).toFixed(2)}`;

/** Credit is enough to type a NAME and play once at `priceUsd` (the gallery: any $0.10). */
export const hasCredit = (creditUsd: number, priceUsd = MIN_CREDIT_USD) => creditUsd + 1e-9 >= Math.max(MIN_CREDIT_USD, priceUsd);

/** The player's NAME: same rules as the on-chain handle (src/lib/gallery.ts chainHandle): [a-z0-9_], 1..20. */
export function cleanName(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().replace(/^@/, '').toLowerCase();
  // A plain handle, or the player's full paymail (owner, 24 Oct: "full paymail"), up to 40 characters.
  if (/^[a-z0-9_]{1,20}$/.test(t)) return t;
  return /^[a-z0-9._-]{1,30}@[a-z0-9.-]{3,30}\.[a-z]{2,}$/.test(t) && t.length <= 40 ? t : null;
}
/** The wallet's name for the round tag (owner, 25 Oct): its paymail, else the identity key's short form (key_ + 10 hex). */
export function playerNameFrom(w: { paymail?: string | null; alias?: string | null; publicKey?: string | null } | null | undefined): { name: string; hasPaymail: boolean } {
  if (!w) return { name: '', hasPaymail: false };
  const pm = cleanName(w.paymail ?? '') ?? cleanName(w.alias ?? '');
  if (pm) return { name: pm, hasPaymail: true };
  const k = (w.publicKey ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return { name: k ? `key_${k.slice(0, 10)}` : '', hasPaymail: false };
}
export const typingName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

/** START works with credit for this play. No name gate (owner, 25 Oct): the name is the wallet's, LOCK & LOAD connects it. */
export const canStart = (creditUsd: number, priceUsd: number) => hasCredit(creditUsd, priceUsd);

/** The OP_RETURN pushes after <chain:n> on a play payment. */
export const playPushes = (game: string, name: string) => ['coinop', game, name];
