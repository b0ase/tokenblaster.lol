/**
 * The shape of launch and trade transactions, shared by the browser and the server so both check
 * exactly the same thing before signing. The server proposes a trade as a list of pool inputs and
 * fixed outputs; the wallet adds its own inputs and its change after them.
 *
 * Buy:  in  [pool tokens, pool BSV?, …wallet]  out [tokens → buyer, tokens → pool?, BSV → pool,
 *                                                  house fee, route fee?, index fund?, …wallet change]
 * Sell: in  [pool tokens, pool BSV, …seller's tokens, …wallet]
 *       out [tokens → pool, BSV → pool, house fee, route fee?, index fund?, …seller's token change,
 *            …wallet change (this is where the seller's BSV lands)]
 */
import { P2PKH, Transaction, Utils } from '@bsv/sdk';
import { bsv21 } from '../gun';

export type OutSpec = { script: string; sats: number; what: string };
export type TradePlan = {
  lease: string;
  side: 'buy' | 'sell';
  tokenId: string;
  sym: string;
  inputs: { outpoint: string; sats: number; what: string }[]; // pool inputs, in order, first
  outputs: OutSpec[]; // fixed outputs, in order, first
  beef: string; // hex BEEF with the pool inputs' history
  quote: { tokens: string; curveSats: string; houseFee: string; routeFee: string; userSats: string; soldAfter: string; indexFee: number };
  expires: number; // ms epoch
};

export const p2pkh = (address: string) => new P2PKH().lock(address).toHex();
export const tokenOut = (id: string, amt: bigint, address: string) => bsv21(id, amt, address).toHex();

/** The `{"p":"bsv-20",…}` JSON of an inscription script (hex), if any. */
export function bsv20Json(hex: string): { op?: string; id?: string; amt?: string; sym?: string } | null {
  if (!hex || !hex.includes(Utils.toHex(Utils.toArray('bsv-20', 'utf8')))) return null;
  const text = Utils.toUTF8(Utils.toArray(hex, 'hex').map((b) => (b < 32 || b > 126 ? 32 : b)));
  const m = text.match(/\{"p":"bsv-20"[^}]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Check that `tx` starts with the plan's inputs and outputs, exactly. Returns the extra outputs
 * (the wallet's) so callers can inspect them.
 */
export function matchesPlan(tx: Transaction, plan: Pick<TradePlan, 'inputs' | 'outputs'>): { ok: true } | { ok: false; why: string } {
  for (let i = 0; i < plan.inputs.length; i++) {
    const inp = tx.inputs[i];
    if (!inp) return { ok: false, why: `input ${i} missing` };
    const op = `${inp.sourceTXID ?? inp.sourceTransaction?.id('hex')}_${inp.sourceOutputIndex}`;
    if (op !== plan.inputs[i].outpoint) return { ok: false, why: `input ${i} is ${op}, expected ${plan.inputs[i].outpoint}` };
  }
  for (let i = 0; i < plan.outputs.length; i++) {
    const o = tx.outputs[i];
    if (!o) return { ok: false, why: `output ${i} missing` };
    if (o.lockingScript.toHex() !== plan.outputs[i].script || (o.satoshis ?? 0) !== plan.outputs[i].sats) {
      return { ok: false, why: `output ${i} (${plan.outputs[i].what}) was changed` };
    }
  }
  return { ok: true };
}

/** The launch message the creator signs: everything that can never change about the coin. */
export function launchMessage(c: {
  slot: string;
  sym: string;
  name: string;
  description: string;
  imageSha256: string;
  route: unknown;
  creator: string;
  tokenAddress: string;
  reserveAddress: string;
  vaultAddress: string;
}) {
  return [
    'TokenBlaster launch',
    `slot: ${c.slot}`,
    `ticker: ${c.sym}`,
    `name: ${c.name}`,
    `about: ${c.description}`,
    `image sha256: ${c.imageSha256}`,
    `creator: ${c.creator}`,
    `creator fee (0.30%): ${JSON.stringify(c.route)}`,
    `supply: 1000000000, all into the curve`,
    `token pool: ${c.tokenAddress}`,
    `BSV reserve: ${c.reserveAddress}`,
    `fee vault: ${c.vaultAddress}`,
  ].join('\n');
}

export type Route =
  | { kind: 'creator'; address: string }
  | { kind: 'split'; to: { address: string; bps: number }[] }
  | { kind: 'holders' }
  | { kind: 'buyback' };

export const ROUTES: { kind: Route['kind']; title: string; short: string; about: string }[] = [
  { kind: 'creator', title: 'To the creator', short: 'Creator', about: 'Each trade pays the 0.30% straight to the creator’s payout address, inside the trade itself.' },
  { kind: 'split', title: 'Fee sharing', short: 'Split', about: 'Split between 2 to 10 wallets, each at least 1%. Collected in the coin’s vault and paid out once a share is worth 600 sats.' },
  { kind: 'holders', title: 'Holder rewards', short: 'Holders', about: 'Shared in BSV among the wallets holding at least 100,000 tokens, in proportion to what they hold, counted when the vault pays out (about every 10 minutes). Claim it into your wallet from Rewards.' },
  { kind: 'buyback', title: 'Buyback & burn', short: 'Burn', about: 'The vault buys the coin back on its own curve and burns it, so the supply only goes down. It buys once it holds 100,000 sats and never moves the price more than 2% in one go.' },
];

export function validRoute(r: unknown): Route | null {
  const x = r as Route;
  if (!x || typeof x !== 'object') return null;
  const addr = (a: unknown) => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
  if (x.kind === 'creator') return addr(x.address) ? { kind: 'creator', address: x.address } : null;
  if (x.kind === 'holders' || x.kind === 'buyback') return { kind: x.kind };
  if (x.kind === 'split' && Array.isArray(x.to) && x.to.length >= 2 && x.to.length <= 10) {
    const to = x.to.map((t) => ({ address: String(t.address), bps: Math.floor(Number(t.bps)) }));
    if (to.some((t) => !addr(t.address) || !(t.bps >= 100))) return null;
    if (to.reduce((n, t) => n + t.bps, 0) !== 10_000) return null;
    return { kind: 'split', to };
  }
  return null;
}
