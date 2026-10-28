/**
 * Server-side outflow totals for the daily caps (guard.ts), read from the ledger rows that already record each
 * outflow: no new tables. payouts_for / trades_for are capped at 500 / 1,000 rows, far above a day's traffic today.
 */
import 'server-only';
import { rpc } from './server';
import { sumLastDay } from './guard';

type Payout = { txid: string; kind: string; sats: number; detail: Record<string, unknown> | null; created_at: string };
type TradeRow = { side: string; curve_sats: number; created_at: string };

const payouts = () => rpc<Payout[]>('tokenblaster_launch_payouts_for', { p_token: null, p_limit: 500 }, false);

/** Sats that left the fee vaults to the outside in the last 24 h (claims + splits; buybacks stay in the curve). */
export async function vaultOutflowToday(now = Date.now()): Promise<number> {
  return sumLastDay((await payouts()).filter((p) => p.kind === 'claim' || p.kind === 'split'), (p) => Number(p.sats), now);
}

/** Sats the curve reserves paid out to sellers in the last 24 h. */
export async function reserveOutflowToday(now = Date.now()): Promise<number> {
  const rows = await rpc<TradeRow[]>('tokenblaster_launch_trades_for', { p_token: null, p_trader: null, p_limit: 1000 }, false);
  return sumLastDay(rows.filter((t) => t.side === 'sell'), (t) => Number(t.curve_sats), now);
}

/** Was a claim signed at `ts` by `address` already paid? (claim payouts record { to, ts }: single-use signatures) */
export async function claimSignatureUsed(address: string, ts: string): Promise<boolean> {
  return (await payouts()).some((p) => p.kind === 'claim' && p.detail?.to === address && String(p.detail?.ts ?? '') === ts);
}
