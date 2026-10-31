/**
 * Gun key safety and credit visibility (owner, 31 Oct 2026: "it stole my money" — LOCK & LOAD paid, the game failed to
 * load, a reload showed no credit).
 *
 * 1. Every gun key this browser has ever used is kept in a list (`tokenblaster.gun.keys`), never trimmed while it may
 *    hold funds, so no code path that replaces the current gun (a wallet-backup restore, a corrupt record) can orphan
 *    coins. The list is written BEFORE the key can be paid (the Gun constructor), and a payment is refused when the
 *    key is not readable back from storage (private mode / storage blocked: a reload would lose it).
 * 2. The CREDIT needs no wallet: the stored gun's ADDRESS is derived here and its balance read from the public chain
 *    (/api/coins, WhatsOnChain server-side). Used by the crash fallback, which runs without the game or the wallet.
 *
 * Never log a WIF. Pure apart from the injected storage and fetch, so the tests run in node.
 */
import { PrivateKey } from '@bsv/sdk';
import { bestCredit } from './creditRead';

export const GUN_STORE = 'tokenblaster.gun';
export const GUN_KEYS = 'tokenblaster.gun.keys';

export type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;
export type ArchivedKey = { wif: string; address: string; at: number };

const browserStore = (): KeyStore | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/** Every gun key this browser has used, oldest first. Unreadable entries are skipped, never deleted. */
export function archivedKeys(st: KeyStore | null = browserStore()): ArchivedKey[] {
  if (!st) return [];
  try {
    const v = JSON.parse(st.getItem(GUN_KEYS) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is ArchivedKey => Boolean(k) && typeof k.wif === 'string' && typeof k.address === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Add `key` to the list (once). Returns true when the key is in the stored list afterwards (read back), false when
 * storage is blocked or full. The list is append-only: nothing here ever removes a key.
 */
export function archiveKey(key: PrivateKey, st: KeyStore | null = browserStore(), now = Date.now()): boolean {
  if (!st) return false;
  const wif = key.toWif();
  try {
    const raw = st.getItem(GUN_KEYS);
    let list: unknown[] = [];
    try {
      const v = JSON.parse(raw ?? '[]');
      list = Array.isArray(v) ? v : [];
    } catch {
      // An unreadable list is kept aside (never overwritten) and a new one started.
      if (raw) st.setItem(`${GUN_KEYS}.unreadable-${now}`, raw);
    }
    if (!list.some((k) => (k as ArchivedKey)?.wif === wif)) {
      list.push({ wif, address: key.toAddress(), at: now });
      st.setItem(GUN_KEYS, JSON.stringify(list));
    }
    return archivedKeys(st).some((k) => k.wif === wif);
  } catch {
    return false;
  }
}

/** Is `wif` the gun record stored right now (so a reload gets this same key back)? */
export function keyPersisted(wif: string, st: KeyStore | null = browserStore()): boolean {
  if (!st) return false;
  try {
    return (JSON.parse(st.getItem(GUN_STORE) ?? 'null') as { wif?: unknown } | null)?.wif === wif;
  } catch {
    return false;
  }
}

/** The address of the gun stored in this browser, without making a Gun (no new key, nothing written). */
export function storedGunAddress(st: KeyStore | null = browserStore()): string | null {
  if (!st) return null;
  try {
    const s = JSON.parse(st.getItem(GUN_STORE) ?? 'null') as { wif?: unknown } | null;
    return typeof s?.wif === 'string' ? PrivateKey.fromWif(s.wif).toAddress() : null;
  } catch {
    return null;
  }
}

/** Every address this browser's guns used: the current one first, then the archived ones (no duplicates). */
export function gunAddresses(st: KeyStore | null = browserStore()): string[] {
  const cur = storedGunAddress(st);
  return [...new Set([...(cur ? [cur] : []), ...archivedKeys(st).map((k) => k.address)])];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Spendable sats at `address` from the public chain (our /api/coins, which asks WhatsOnChain). Null when the chain
 * could not be read: "unknown", never shown as $0.00.
 */
export async function chainSats(address: string, f: Fetch = fetch): Promise<number | null> {
  const r = await f(`/api/coins?address=${address}&amounts=1`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r?.ok || r.headers.get('x-coins-upstream') === 'failed') return null;
  const list = (await r.json().catch(() => null)) as { sats?: number }[] | null;
  if (!Array.isArray(list)) return null;
  // The list is the top 200 coins; the header is every page's total (src/lib/creditRead.ts). Show the higher.
  const head = Number(r.headers.get('x-coins-total'));
  return bestCredit([list.reduce((n, c) => n + (typeof c.sats === 'number' && c.sats > 0 ? c.sats : 0), 0), r.headers.has('x-coins-total') ? head : null]);
}

/** The credit the crash fallback shows: the stored gun's chain balance, no wallet involved. */
export async function peekCredit(st: KeyStore | null = browserStore(), f: Fetch = fetch): Promise<{ address: string | null; sats: number | null }> {
  const address = storedGunAddress(st);
  if (!address) return { address: null, sats: null };
  return { address, sats: await chainSats(address, f) };
}

/** Every key this browser's guns used, with its address (current first): for "Send back to my wallet". Never logged. */
export function gunKeysForSweep(st: KeyStore | null = browserStore()): { address: string; wif: string }[] {
  if (!st) return [];
  const out: { address: string; wif: string }[] = [];
  try {
    const s = JSON.parse(st.getItem(GUN_STORE) ?? 'null') as { wif?: unknown } | null;
    if (typeof s?.wif === 'string') out.push({ address: PrivateKey.fromWif(s.wif).toAddress(), wif: s.wif });
  } catch {
    /* unreadable current gun: the archived keys still count */
  }
  for (const k of archivedKeys(st)) {
    try {
      // The address is derived from the key itself: a stored address that does not match its key is skipped.
      if (PrivateKey.fromWif(k.wif).toAddress() === k.address && !out.some((o) => o.address === k.address)) out.push({ address: k.address, wif: k.wif });
    } catch {
      /* not a key */
    }
  }
  return out;
}

/** The coins (with parent tx hex) at `address` from /api/coins: every page of the chain read, largest first. */
export async function chainCoins(address: string, f: Fetch = fetch): Promise<{ txid: string; vout: number; sats: number; hex?: string }[]> {
  const r = await f(`/api/coins?address=${address}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!r.ok || r.headers.get('x-coins-upstream') === 'failed') throw new Error("Couldn't read this key's coins right now. Try again in a moment.");
  return (await r.json()) as { txid: string; vout: number; sats: number; hex?: string }[];
}
