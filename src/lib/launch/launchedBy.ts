/**
 * "Launched by": which paymail funded a coin's launch (owner, 25 Oct 2026: "You SHOULD be able to see which paymail
 * funded the creation of a token"). The launch is signed by the creator's identity key (creator_key); the paymail
 * is looked up from that key on the bWalletX paymail service, the same lookup the wallet bar uses
 * (src/lib/walletBar.ts lookupPaymail). A paymail the client says it has is only kept when the lookup for the
 * signing key lists it, so nobody can put someone else's name on their coin. Pure: fetch is injected for tests.
 */
import { PublicKey } from '@bsv/sdk';

export const PAYMAIL_LOOKUP = 'https://pay.bwallet.space/api/paymail/lookup';
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type LaunchedBy = { paymail: string | null; key: string; address: string };

const KEY = /^0[23][0-9a-f]{64}$/;
const PAYMAIL = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;
export const isPaymail = (p: unknown): p is string => typeof p === 'string' && p.length <= 320 && PAYMAIL.test(p);

/**
 * Every paymail the service lists for a key, main ('plain') name first.
 * [] = the key has no name yet (404 or an empty answer); null = the lookup failed (try again later).
 */
export async function paymailsForKey(key: string, f: Fetch = fetch): Promise<string[] | null> {
  if (!KEY.test(key)) return [];
  let r: Response;
  try {
    r = await f(`${PAYMAIL_LOOKUP}?key=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  } catch {
    return null;
  }
  if (r.status === 404) return [];
  if (!r.ok) return null;
  const b = (await r.json().catch(() => null)) as { paymail?: unknown; names?: { paymail?: unknown; kind?: unknown }[] } | null;
  if (!b || typeof b !== 'object') return null;
  const names = Array.isArray(b.names) ? b.names.filter((n) => n && isPaymail(n.paymail)) : [];
  const ordered = [...names.filter((n) => n.kind === 'plain'), ...names.filter((n) => n.kind !== 'plain')].map((n) => String(n.paymail));
  const all = isPaymail(b.paymail) ? [b.paymail, ...ordered] : ordered;
  return [...new Set(all.map((p) => p.toLowerCase()))];
}

/**
 * The paymail to store for a launch signed by `key`. `claimed` (the connected wallet's paymail, if the client
 * knows it) wins only when the key's lookup lists it; otherwise the key's main name. null = no paymail yet, or
 * the lookup failed (then the backfill retries it).
 */
export async function launchPaymail(key: string, claimed?: unknown, f: Fetch = fetch): Promise<string | null> {
  const names = await paymailsForKey(key, f);
  if (!names?.length) return null;
  if (isPaymail(claimed) && names.includes(claimed.toLowerCase())) return claimed.toLowerCase();
  return names[0];
}

/** The P2PKH address of an identity key ('' if the key is malformed). */
export function addressOf(key: string): string {
  try {
    return KEY.test(key) ? PublicKey.fromString(key).toAddress() : '';
  } catch {
    return '';
  }
}

/** The public `launched_by` field for a coin row. */
export function launchedBy(row: { creator_key?: string | null; launch_paymail?: string | null; creator?: string | null }): LaunchedBy {
  const key = row.creator_key ?? '';
  return { paymail: isPaymail(row.launch_paymail) ? row.launch_paymail : null, key, address: addressOf(key) || (row.creator ?? '') };
}

/** Add `launched_by` to a row (launch_paymail moves into it). */
export function withLaunchedBy<T extends { creator_key?: string | null; launch_paymail?: string | null; creator?: string | null }>(row: T) {
  const { launch_paymail: _p, ...rest } = row;
  void _p;
  return { ...rest, launched_by: launchedBy(row) };
}
