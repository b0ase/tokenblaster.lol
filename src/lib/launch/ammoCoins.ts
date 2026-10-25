/**
 * BlastPad coins the cabinets sell as ammunition (owner, 25 Oct 2026: "swap on load, burn on fire").
 *
 * At LOCK & LOAD the player picks one of these coins: ONE wallet approval buys it on its BlastPad curve
 * with the tokens delivered straight to the gun's address (so they are loaded), plus the BSV gunpowder
 * that pays the rounds, in the same transaction (src/lib/launch/swapLoad.ts).
 *
 * OPTION A (owner, 25 Oct 2026): each shot is a plain sats storm round tagged with the coin's token id
 * ("tokenblaster.lol <token id> <n> gallery <paymail>", so bsv.lol labels it TokenBlaster · <SYM>), and the tokens
 * are burned in bulk: ONE tx per session sends rounds-fired × burnPer to the burn address (Gun.burnOwed). The owed
 * count is saved with the gun, so a closed tab burns on the next load or unload. Index-fund cost: ≤ 2 token
 * outputs per session instead of 2 per shot.
 *
 * Any BlastPad coin works: add an entry with its token id. A coin with an empty `tokenId` is hidden.
 * Branded ammo sells at the plain curve price: no discount (owner, 25 Oct), so nothing can be bought cheap and sold back.
 */
import { INDEX_FEE, MAX_BUY, MIN_BUY, quoteBuy, type Quote } from './curve';

export type AmmoCoin = {
  /** Key for the UI / logs. */
  key: string;
  sym: string;
  /** BSV-21 token id (`<txid>_<vout>` of the deploy+mint). Empty = not launched yet: the option is hidden. */
  tokenId: string;
  /** Tokens burned per shot (whole tokens; BlastPad coins have 0 decimals). */
  burnPer: bigint;
};

export const AMMO_COINS: AmmoCoin[] = [
  // TERRORNODE: launched on BlastPad 25 Oct 2026 (owner).
  { key: 'terrornode', sym: 'TERRORNODE', tokenId: 'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1', burnPer: BigInt(1) },
];

const isTokenId = (id: string) => /^[0-9a-f]{64}_\d+$/.test(id);

/** The coins the cabinet can offer (token id set). */
export const activeAmmoCoins = (list: AmmoCoin[] = AMMO_COINS) => list.filter((c) => isTokenId(c.tokenId));

/** The ammo coin config for a token id, if it is one. */
export const ammoCoinById = (tokenId: string, list: AmmoCoin[] = AMMO_COINS) => activeAmmoCoins(list).find((c) => c.tokenId === tokenId) ?? null;

/** Network fee budget per burn (sats): two inputs, two BSV-21 outputs, the tag, change (~750 B at 100 sat/kB). */
export const BURN_FEE = 90;
/** Per-shot token burns in lanes (the earlier design: ~2,000 sats of index fund per shot). Off: option A. */
export const PER_SHOT_BURN = false;
/** Sats for the session's bulk burn tx (a few token inputs, 2 token outputs, tag, change). */
export const BULK_BURN_FEE = 600;
/** Worst-case fixed overhead of the load: the token index-fund fee (at most 5 × INDEX_FEE) and the buy tx's own fee. */
export const LOAD_OVERHEAD = 5 * INDEX_FEE + 400;
/** Most burns chained on one lane (unconfirmed chain depth, see #50). */
export const MAX_LANE_DEPTH = 1_000;
/** Most lanes per load (as the sats storm, src/lib/gallery.ts MAX_LANES). */
export const MAX_COIN_LANES = 100;
/** Most rounds one load can carry: every lane at full depth. */
export const MAX_COIN_ROUNDS = MAX_COIN_LANES * MAX_LANE_DEPTH;
/** Fan-out fee per lane (one token output + one fee output in the gun's split tx). */
export const LANE_SPLIT_FEE = 30;

/** Lanes for `rounds` burns: enough for full speed (like lanesFor), and never deeper than MAX_LANE_DEPTH. */
export const coinLanesFor = (rounds: number) => Math.max(1, Math.min(MAX_COIN_LANES, Math.max(Math.ceil(rounds / 100), Math.ceil(rounds / MAX_LANE_DEPTH))));

/** Split `total` into `k` near-equal whole parts (the first ones get the remainder). */
export function splitEven(total: bigint, k: number): bigint[] {
  const n = BigInt(Math.max(1, k));
  const base = total / n;
  const rem = Number(total % n);
  return Array.from({ length: Number(n) }, (_, i) => base + (i < rem ? BigInt(1) : BigInt(0)));
}

export type SwapLoadQuote = {
  /** Sats into the curve trade (fees included): what the player pays for the tokens. */
  gross: bigint;
  tokenSats: bigint;
  /** Gunpowder: sats to the gun for the burn fees and the lane fan-out. */
  fuelSats: number;
  /** Rounds (shots) this load gives. */
  rounds: number;
  /** Lanes the gun splits the load into for the burn storm. */
  lanes: number;
  /** Tokens bought (all go to the gun; rounds × burnPer of them get burned, the rest can be unloaded). */
  tokens: bigint;
  /** Lowest token count accepted after slippage. */
  minTokens: bigint;
  /** Player's total: tokenSats + fuelSats + overhead. */
  totalSats: number;
  quote: Quote;
};

const fuelFor = (rounds: number, roundSats: number) => rounds * roundSats + (PER_SHOT_BURN ? coinLanesFor(rounds) * LANE_SPLIT_FEE : BULK_BURN_FEE) + 300;

/**
 * Split a payment of `paySats` into a curve buy and gunpowder so it buys the most rounds. The burn fee
 * dominates (a token costs well under a sat, a burn ~90 sats), so the buy is usually the curve's minimum.
 * `gunSats` already in the gun count toward the gunpowder. Per-shot burns (off) cap at MAX_COIN_ROUNDS per load.
 */
export function planSwapLoad(o: {
  paySats: number;
  sold: bigint;
  coin: Pick<AmmoCoin, 'burnPer'>;
  slippageBps: number;
  gunSats?: number;
  /** Sats per round (option A: the gallery's shot cost; default BURN_FEE for per-shot burns). */
  roundSats?: number;
}): SwapLoadQuote | null {
  const rs = Math.max(1, Math.ceil(o.roundSats ?? BURN_FEE));
  const per = o.coin.burnPer > BigInt(0) ? o.coin.burnPer : BigInt(1);
  const gunSats = Math.max(0, Math.floor(o.gunSats ?? 0));
  const build = (gross: bigint, rounds: number): SwapLoadQuote => {
    const quote = quoteBuy(o.sold, gross);
    const fuelSats = rounds ? Math.max(0, fuelFor(rounds, rs) - gunSats) : 0;
    const minTokens = (quote.tokens * BigInt(10_000 - Math.max(0, Math.min(10_000, o.slippageBps)))) / BigInt(10_000);
    return { gross, tokenSats: gross, fuelSats, rounds, lanes: coinLanesFor(rounds), tokens: quote.tokens, minTokens, totalSats: Number(gross) + fuelSats + LOAD_OVERHEAD, quote };
  };
  const affordable = (gross: bigint) => {
    const q = build(gross, 0);
    const left = o.paySats - Number(gross) - LOAD_OVERHEAD + gunSats - 300;
    let byFuel = Math.max(0, Math.floor(left / rs));
    while (byFuel > 0 && fuelFor(byFuel, rs) - gunSats > o.paySats - Number(gross) - LOAD_OVERHEAD) byFuel--;
    const byTokens = Number(q.minTokens / per); // only count tokens we are sure to get
    return Math.max(0, Math.min(byFuel, byTokens, PER_SHOT_BURN ? MAX_COIN_ROUNDS : Number.MAX_SAFE_INTEGER));
  };
  // Start at the curve minimum; grow the buy only while it is the limit (more tokens than fuel can burn is waste).
  let gross = BigInt(MIN_BUY);
  if (o.paySats < Number(gross) + LOAD_OVERHEAD) return null;
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
