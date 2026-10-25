/**
 * BlastPad coins the cabinets sell as ammunition (owner, 25 Oct 2026: "swap on load, burn on fire").
 *
 * At LOCK & LOAD the player picks one of these coins: ONE wallet approval buys it on its BlastPad curve
 * with the tokens delivered straight to the gun's address (so they are loaded), plus the BSV gunpowder
 * that pays each burn's network fee, in the same transaction (src/lib/launch/swapLoad.ts). Each shot then
 * burns `burnPer` tokens to the burn address, signed by the gun (Gun.fireTokens).
 *
 * Any BlastPad coin works: add an entry with its token id. A coin with an empty `tokenId` is hidden.
 * Shared by the browser (quotes, UI) and the server (/api/launch/trade reads `discountBps` from here, never
 * from the request).
 */
import { INDEX_FEE, MAX_BUY, MIN_BUY, quoteBuy, type Quote } from './curve';

export type AmmoCoin = {
  /** Key for the UI / logs. */
  key: string;
  sym: string;
  /** BSV-21 token id (`<txid>_<vout>` of the deploy+mint). Empty = not launched yet: the option is hidden. */
  tokenId: string;
  /**
   * In-game discount on the curve price, paid by the house (basis points, 0 = off). The house adds its own
   * BSV input to the trade covering this share of the buy, server signed, so the trade stays one atomic tx.
   */
  discountBps: number;
  /** Cap on the house subsidy per trade (sats), whatever discountBps says. */
  maxSubsidySats: number;
  /** Tokens burned per shot (whole tokens; BlastPad coins have 0 decimals). */
  burnPer: bigint;
};

export const AMMO_COINS: AmmoCoin[] = [
  // TERRORNODE: not launched yet. Set tokenId once its BlastPad launch confirms; keep discountBps 0 until the owner sets it.
  { key: 'terrornode', sym: 'TERRORNODE', tokenId: '', discountBps: 0, maxSubsidySats: 100_000, burnPer: BigInt(1) },
];

const isTokenId = (id: string) => /^[0-9a-f]{64}_\d+$/.test(id);

/** The coins the cabinet can offer (token id set). */
export const activeAmmoCoins = (list: AmmoCoin[] = AMMO_COINS) => list.filter((c) => isTokenId(c.tokenId));

/** The ammo coin config for a token id, if it is one. */
export const ammoCoinById = (tokenId: string, list: AmmoCoin[] = AMMO_COINS) => activeAmmoCoins(list).find((c) => c.tokenId === tokenId) ?? null;

/** House subsidy (sats) for a buy of `gross` sats at `bps` off, capped. */
export function subsidyFor(gross: bigint, bps: number, maxSats: number): bigint {
  const b = Math.max(0, Math.min(5_000, Math.floor(bps))); // never more than half off, whatever the config says
  if (!b || gross <= BigInt(0)) return BigInt(0);
  const s = (gross * BigInt(b)) / BigInt(10_000);
  const cap = BigInt(Math.max(0, Math.floor(maxSats)));
  return s > cap ? cap : s;
}

/** Network fee budget per burn (sats): one BSV-21 transfer + tag (see TOKEN_FEE in gun.ts). */
export const BURN_FEE = 90;
/** Worst-case fixed overhead of the load: the token index-fund fee (at most 5 × INDEX_FEE) and the buy tx's own fee. */
export const LOAD_OVERHEAD = 5 * INDEX_FEE + 400;

export type SwapLoadQuote = {
  /** Gross sats into the curve trade (fees included). */
  gross: bigint;
  /** Of that, what the house pays (discount). */
  subsidy: bigint;
  /** What the player pays for the tokens. */
  tokenSats: bigint;
  /** Gunpowder: sats to the gun for the burn fees. */
  fuelSats: number;
  /** Rounds (shots) this load gives. */
  rounds: number;
  /** Tokens bought (all go to the gun; rounds × burnPer of them get burned, the rest can be unloaded). */
  tokens: bigint;
  /** Lowest token count accepted after slippage. */
  minTokens: bigint;
  /** Player's total: tokenSats + fuelSats + overhead. */
  totalSats: number;
  quote: Quote;
};

/**
 * Split a payment of `paySats` into a curve buy and gunpowder so it buys the most rounds. The burn fee
 * dominates (a token costs well under a sat, a burn ~90 sats), so the buy is usually the curve's minimum.
 * `gunSats` already in the gun count toward the gunpowder.
 */
export function planSwapLoad(o: { paySats: number; sold: bigint; coin: Pick<AmmoCoin, 'discountBps' | 'maxSubsidySats' | 'burnPer'>; slippageBps: number; gunSats?: number }): SwapLoadQuote | null {
  const per = o.coin.burnPer > BigInt(0) ? o.coin.burnPer : BigInt(1);
  const gunSats = Math.max(0, Math.floor(o.gunSats ?? 0));
  const build = (gross: bigint, rounds: number): SwapLoadQuote => {
    const quote = quoteBuy(o.sold, gross);
    const subsidy = subsidyFor(gross, o.coin.discountBps, o.coin.maxSubsidySats);
    const tokenSats = gross - subsidy;
    const fuelSats = Math.max(0, rounds * BURN_FEE + 200 - gunSats);
    const minTokens = (quote.tokens * BigInt(10_000 - Math.max(0, Math.min(10_000, o.slippageBps)))) / BigInt(10_000);
    return { gross, subsidy, tokenSats, fuelSats, rounds, tokens: quote.tokens, minTokens, totalSats: Number(tokenSats) + fuelSats + LOAD_OVERHEAD, quote };
  };
  const affordable = (gross: bigint) => {
    const q = build(gross, 0);
    const left = o.paySats - Number(q.tokenSats) - LOAD_OVERHEAD + gunSats - 200;
    const byFuel = Math.floor(left / BURN_FEE);
    const byTokens = Number(q.minTokens / per); // only count tokens we are sure to get
    return Math.max(0, Math.min(byFuel, byTokens));
  };
  // Start at the curve minimum; grow the buy only while it is the limit (more tokens than fuel can burn is waste).
  let gross = BigInt(MIN_BUY);
  if (o.paySats < Number(gross - subsidyFor(gross, o.coin.discountBps, o.coin.maxSubsidySats)) + LOAD_OVERHEAD) return null;
  for (let i = 0; i < 40; i++) {
    const r = affordable(gross);
    const q = build(gross, 0);
    if (Number(q.minTokens / per) > r || gross >= BigInt(MAX_BUY)) break; // tokens are not the limit
    const next = gross * BigInt(2) > BigInt(MAX_BUY) ? BigInt(MAX_BUY) : gross * BigInt(2);
    if (affordable(next) <= r) break;
    gross = next;
  }
  const rounds = affordable(gross);
  if (rounds <= 0) return null;
  return build(gross, rounds);
}
