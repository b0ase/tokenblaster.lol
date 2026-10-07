/**
 * Coin-op arcade: 10p buys one credit, one credit is one game (3 lives, until game over).
 * The house keeps the coin; there are no payouts. PRACTICE stays free.
 *
 * The price is 10p turned into sats at the live BSV/GBP rate (/api/price/gbp), rounded UP to a
 * whole sat and kept inside a sanity floor/ceiling so a bad rate can never ask for silly money.
 * Paying is ONE wallet createAction: the coin to the house address plus an
 * OP_FALSE OP_RETURN "tokenblaster.lol" "coinop" <n> <game> tag, so the run's txid verifies on
 * the high-score board (src/lib/scores.ts verifyRunTx). The player's wallet signs and broadcasts.
 */
import { P2PKH, Script, Transaction, Utils, type WalletInterface } from '@bsv/sdk';

export const COIN_PENCE = 10;
export const LIVES_PER_CREDIT = 3;
/** Never ask for less than this (a rate glitch that makes BSV look absurdly expensive). */
export const MIN_COIN_SATS = 1_000;
/** Never ask for more than this, 0.05 BSV (a rate glitch that makes BSV look absurdly cheap; 10p ≈ 0.007 BSV at £14). */
export const MAX_COIN_SATS = 5_000_000;

/** Empty when unset: then the coin slot is disabled (no fallback address for coin-op). */
export const COINOP_HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS ?? '';

/**
 * `pence` in sats at `bsvGbp` (£ per BSV), rounded up to a whole sat, clamped to
 * [MIN_COIN_SATS, MAX_COIN_SATS]. null when there is no usable rate (the slot then waits).
 */
export function penceToSats(pence: number, bsvGbp: number | null | undefined): number | null {
  if (!bsvGbp || !Number.isFinite(bsvGbp) || bsvGbp <= 0) return null;
  if (!Number.isFinite(pence) || pence <= 0) return null;
  // Work in integer-ish units to dodge float fuzz: sats = pence × 1e6 / rate.
  const raw = (pence * 1e6) / bsvGbp;
  const sats = Math.ceil(Number(raw.toPrecision(12)));
  return Math.min(MAX_COIN_SATS, Math.max(MIN_COIN_SATS, sats));
}

export const coinSats = (bsvGbp: number | null | undefined) => penceToSats(COIN_PENCE, bsvGbp);

/** The coin's description, in plain English with the exact amount (shown in the wallet prompt). */
export const coinDescription = (game: string, sats: number) => `Insert coin: 1 credit for ${game} (10p = ${sats.toLocaleString('en-GB')} sats to TokenBlaster)`;

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

/** Pay one coin. Returns the txid. Throws plain errors (cancelled, no house address, wallet failure). */
export async function insertCoin(client: WalletInterface, o: { game: string; tag: string; sats: number; n: number; house?: string }): Promise<string> {
  const house = o.house ?? COINOP_HOUSE;
  if (!house) throw new Error('The coin slot is closed: no house address is set.');
  if (!Number.isInteger(o.sats) || o.sats < MIN_COIN_SATS || o.sats > MAX_COIN_SATS) throw new Error('Bad coin price.');
  const description = coinDescription(o.game, o.sats);
  const r = await client.createAction({
    description: description.slice(0, 2000),
    outputs: [
      { lockingScript: new P2PKH().lock(house).toHex(), satoshis: o.sats, outputDescription: `Coin: 10p (${o.sats} sats)` },
      {
        lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${['tokenblaster.lol', 'coinop', String(o.n), o.tag].map(hex).join(' ')}`).toHex(),
        satoshis: 0,
        outputDescription: `TokenBlaster coin-op tag: ${o.tag}`,
      },
    ],
    labels: ['tokenblaster', 'coinop'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  const txid = r.txid ?? (r.tx ? Transaction.fromAtomicBEEF(r.tx).id('hex') : '');
  if (!txid) throw new Error('The wallet returned no transaction.');
  return txid;
}

/** A wallet's cancel/deny reads as a cancel, not a failure. */
export const isCancel = (e: unknown) => /cancel|denied|reject|abort|user/i.test(e instanceof Error ? e.message : String(e));

/**
 * Win streaks (NPG Card Battle): a streak is paid only when every match in it was a credit match.
 * `streakSoFar` is the win streak when the next match starts (0 = a new streak begins).
 */
export const streakAllPaid = (prevAllPaid: boolean, streakSoFar: number, paidMatch: boolean): boolean => (streakSoFar === 0 ? paidMatch : prevAllPaid && paidMatch);
