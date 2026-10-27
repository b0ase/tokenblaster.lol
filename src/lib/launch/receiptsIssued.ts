/**
 * $TERRORNODE receipts issued so far, from the ledger (db/022 tokenblaster_receipts_issued), cached for 30 s per
 * server instance. Drives graduation (src/lib/launch/receipts.ts tradingOf): the coin trades once it reaches GRADUATE_AT.
 * null when the ledger can't be read (then the coin is treated as not graduated).
 */
import { TERRORNODE_ID } from './receipts';
import { rpc } from './server';

const TTL_MS = 30_000;
let cached: { n: number; at: number } | null = null;

export async function receiptsIssued(): Promise<number | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.n;
  try {
    const n = Number((await rpc<number>('tokenblaster_receipts_issued', { p_token: TERRORNODE_ID }, false)) ?? 0);
    if (!Number.isFinite(n)) return cached?.n ?? null;
    cached = { n, at: Date.now() };
    return n;
  } catch {
    return cached?.n ?? null;
  }
}
