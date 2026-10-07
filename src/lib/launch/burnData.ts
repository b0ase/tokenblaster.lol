/** One vault burn, read from the public ledger (server only, no secret). */
import 'server-only';
import { burnStats } from './burn';
import { rpc } from './server';

export type BurnView = { sym: string; name: string; token_id: string; txid: string; tokens: number; sats: number; at: string; burned: number; pct: number; supplyNow: number };

export const validIds = (id: string, txid: string) => /^[0-9a-f]{64}_\d+$/.test(id) && /^[0-9a-f]{64}$/.test(txid);

export async function burnOf(id: string, txid: string): Promise<BurnView | null> {
  if (!validIds(id, txid)) return null;
  const [coins, trades] = await Promise.all([
    rpc<{ sym: string; name: string; token_id: string; burned: number }[]>('tokenblaster_launch_coin', { p_token: id }, false).catch(() => []),
    rpc<{ txid: string; side: string; tokens: number; curve_sats: number; created_at: string }[]>('tokenblaster_launch_trades_for', { p_token: id, p_trader: null, p_limit: 1000 }, false).catch(() => []),
  ]);
  const c = coins[0];
  const t = trades.find((x) => x.txid === txid && x.side === 'burn');
  if (!c || !t) return null;
  const s = burnStats(Number(c.burned) || 0);
  return { sym: c.sym, name: c.name, token_id: c.token_id, txid, tokens: Number(t.tokens), sats: Number(t.curve_sats), at: t.created_at, burned: s.burned, pct: s.pct, supplyNow: s.supplyNow };
}
