/**
 * $TERRORNODE receipts (owner-approved, 25 Oct 2026). Pure: shared by the browser, the server and the tests.
 *
 * Every LIVE bullet fired in ESCAPE FROM TERRORNODE buys 1 TERRORNODE receipt. Receipt #n has its own price,
 * linear from 1 sat (#1) to 1 US penny (#1,000,000,000), the penny at the live BSV/USD rate at sale time:
 *   price(n) = 1 + (pennySats − 1) × (n − 1) / (N − 1),   N = 1e9
 * At session end the gun pays the receipt money for the rounds fired to the creator address in ONE settlement tx
 * that carries the session's tag; the server checks it and sends that many TERRORNODE from the pool in ONE transfer.
 *
 * Settlement tx outputs (any order, the gun's change last):
 *   OP_FALSE OP_RETURN "tokenblaster.lol" "terrornode" "receipts" <count> <recipient address> <session id> <handle>
 *   P2PKH → RECEIPT_CREATOR  ≥ rangeSats(issued+1, count, pennySats)
 *   P2PKH → the pool's gas address ≥ RECEIPT_GAS (pays the network fee of the server's token transfer)
 * The recipient is inside the paid tx, so a txid can never be claimed for another address.
 */
import { P2PKH, Transaction, Utils } from '@bsv/sdk';

export const TERRORNODE_ID = 'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1';
export const TERRORNODE_SYM = 'TERRORNODE';
export const RECEIPT_CREATOR = '1F4J9KkMoqtznXPJuCgb98LRymssc8MFfd';
export const RECEIPT_SUPPLY = BigInt(1_000_000_000);
export const RECEIPT_GAS = 300; // sats per settlement for the server's one token transfer
export const EARN_URL = 'https://www.tokenblaster.lol/arcade/terrornode';
export const RECEIPT_TAG = ['tokenblaster.lol', 'terrornode', 'receipts'] as const;
/** Coins that cannot be bought or sold on BlastPad: they are earned by playing. */
export const NO_TRADE = new Set([TERRORNODE_ID]);
export const tradingOf = (tokenId: string | null | undefined) => !NO_TRADE.has(tokenId ?? '');

const N1 = RECEIPT_SUPPLY - BigInt(1);
const big = (x: bigint | number) => (typeof x === 'bigint' ? x : BigInt(Math.floor(x)));

/** 1 US penny in sats at `bsvUsd` (rounded, never below 1). */
export function pennySatsAt(bsvUsd: number): bigint {
  if (!(bsvUsd > 0)) throw new Error('No BSV/USD rate.');
  return BigInt(Math.max(1, Math.round(0.01 / bsvUsd * 1e8)));
}

/** Exact price of receipt #n in sats, as a fraction {num, den} (den = N − 1). */
function priceFrac(n: bigint, penny: bigint) {
  return { num: N1 + (penny - BigInt(1)) * (n - BigInt(1)), den: N1 };
}

/** Price of receipt #n, rounded up to whole sats. */
export function priceSats(n: bigint | number, pennySats: bigint | number): bigint {
  const nn = big(n);
  if (nn < BigInt(1) || nn > RECEIPT_SUPPLY) throw new Error('Receipt number out of range.');
  const f = priceFrac(nn, big(pennySats));
  return (f.num + f.den - BigInt(1)) / f.den;
}

/**
 * Total for receipts #first … #first+count−1, in closed form, rounded up once (not per receipt):
 *   Σ = count + (penny − 1) × Σ_{k=first−1}^{first+count−2} k / (N − 1)
 */
export function rangeSats(first: bigint | number, count: bigint | number, pennySats: bigint | number): bigint {
  const a = big(first);
  const c = big(count);
  const penny = big(pennySats);
  if (c <= BigInt(0)) return BigInt(0);
  if (a < BigInt(1) || a + c - BigInt(1) > RECEIPT_SUPPLY) throw new Error('Receipt range out of supply.');
  const lo = a - BigInt(1);
  const hi = a + c - BigInt(2);
  const sumK2 = (lo + hi) * c; // twice Σk
  const num = c * N1 * BigInt(2) + (penny - BigInt(1)) * sumK2;
  const den = N1 * BigInt(2);
  return (num + den - BigInt(1)) / den;
}

/** How many shots `sats` buys now: each shot = `feeSats` (the BSV round incl. network fee) + its receipt. */
export function shotsFor(sats: number, feeSats: number, issued: bigint | number, pennySats: bigint | number, max = 1_000_000): number {
  if (sats <= 0) return 0;
  const first = big(issued) + BigInt(1);
  const cost = (k: number) => BigInt(Math.ceil(feeSats * k)) + rangeSats(first, k, pennySats);
  let lo = 0;
  let hi = Math.min(max, Math.floor(sats / Math.max(1, feeSats)) + 1, Number(RECEIPT_SUPPLY - big(issued)));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cost(mid) <= BigInt(Math.floor(sats))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── The settlement tx ──────────────────────────────────────────

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));
export const isAddress = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);

export type Settlement = { count: number; recipient: string; session: string; handle: string };

/** The OP_RETURN script (ASM) for a settlement. */
export function settlementAsm(s: Settlement) {
  return `OP_FALSE OP_RETURN ${[...RECEIPT_TAG, String(s.count), s.recipient, s.session, s.handle.slice(0, 64)].map(hex).join(' ')}`;
}

/** The data pushes of a script body (after OP_FALSE OP_RETURN), read straight from the bytes. */
function pushes(b: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < b.length; ) {
    const op = b[i++];
    let len = 0;
    if (op >= 1 && op <= 75) len = op;
    else if (op === 76) len = b[i++];
    else if (op === 77) {
      len = b[i] | (b[i + 1] << 8);
      i += 2;
    }
    else if (op === 78) {
      len = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 2 ** 24;
      i += 4;
    }
    else if (op === 0) len = 0;
    else break;
    if (i + len > b.length) break;
    out.push(b.slice(i, i + len));
    i += len;
  }
  return out;
}

/** Read a settlement tx: its tag, and what it paid to the creator and to the gas address. */
export function readSettlement(tx: Transaction, gasAddress: string): (Settlement & { paid: bigint; gas: bigint }) | null {
  let s: Settlement | null = null;
  let paid = BigInt(0);
  let gas = BigInt(0);
  const creator = new P2PKH().lock(RECEIPT_CREATOR).toHex();
  const gasLock = new P2PKH().lock(gasAddress).toHex();
  for (const o of tx.outputs) {
    const h = o.lockingScript.toHex();
    if (h === creator) paid += BigInt(o.satoshis ?? 0);
    else if (h === gasLock) gas += BigInt(o.satoshis ?? 0);
    else if (!s && h.startsWith('006a')) {
      const chunks = pushes(Utils.toArray(h.slice(4), 'hex')).map((d) => Utils.toUTF8(d));
      if (chunks.length >= 6 && RECEIPT_TAG.every((t, i) => chunks[i] === t)) {
        const count = Number(chunks[3]);
        if (Number.isSafeInteger(count) && count > 0 && /^\d+$/.test(chunks[3]) && isAddress(chunks[4]))
          s = { count, recipient: chunks[4], session: chunks[5], handle: chunks[6] ?? '' };
      }
    }
  }
  return s ? { ...s, paid, gas } : null;
}

/**
 * Is this settlement paid in full? `issued` = receipts the ledger has issued before this one (the server's own
 * number), `pennySats` = the server's live penny. `toleranceBps` covers the BSV/USD rate moving between the
 * player's quote and the server's check (the range itself moves by ~2e-6 sat per receipt, nothing).
 */
export function checkPayment(
  st: { count: number; paid: bigint; gas: bigint },
  issued: bigint | number,
  pennySats: bigint | number,
  toleranceBps = 300,
): { ok: true; owed: bigint } | { ok: false; why: string; owed: bigint } {
  const owed = rangeSats(big(issued) + BigInt(1), st.count, pennySats);
  const floor = (owed * BigInt(10_000 - toleranceBps)) / BigInt(10_000);
  if (st.gas < BigInt(RECEIPT_GAS)) return { ok: false, why: `The transfer gas is short (${st.gas} < ${RECEIPT_GAS} sats).`, owed };
  if (st.paid < floor) return { ok: false, why: `Paid ${st.paid} sats for ${st.count} receipts; they cost ${owed} sats.`, owed };
  return { ok: true, owed };
}
