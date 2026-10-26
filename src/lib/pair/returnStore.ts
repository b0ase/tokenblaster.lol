/**
 * v2 return (bwallet docs/PAIRING-ORIGIN-PROOF.md): the pairing in progress is saved in localStorage keyed by its
 * one-time `rid` before the player leaves for bWallet, and picked up again when bWallet sends them back to
 * `<ret>#bwx=ok&rid=<rid>`. localStorage, not sessionStorage: the web wallet returns in a new tab.
 * Entries live 10 minutes and are taken once.
 */
import { RID_RE } from './protocol';

export const PENDING_PREFIX = 'tokenblaster.pair.pending.';
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** What a returning tab needs to finish the pairing: the channel, relay, our ephemeral key and the link's expiry. */
export type PendingPair = { c: string; r: string; s: string; e: number; rid: string; ret: string; at: number };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const ls = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Drop every entry older than the TTL (and anything unreadable). */
export function prunePending(store: Store | null = ls(), now = Date.now()) {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(PENDING_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    try {
      const p = JSON.parse(store.getItem(k) ?? 'null') as PendingPair | null;
      if (!p || typeof p.at !== 'number' || now - p.at > PENDING_TTL_MS || now < p.at - 60_000) store.removeItem(k);
    } catch {
      store.removeItem(k);
    }
  }
}

export function savePending(p: PendingPair, store: Store | null = ls(), now = Date.now()) {
  if (!store || !RID_RE.test(p.rid)) return;
  try {
    prunePending(store, now);
    store.setItem(PENDING_PREFIX + p.rid, JSON.stringify(p));
  } catch {
    /* storage full or blocked: the return just shows the wallet's "switch back" screen */
  }
}

/** The saved pairing for this rid, once (it is removed), or null when missing or older than 10 minutes. */
export function takePending(rid: string, store: Store | null = ls(), now = Date.now()): PendingPair | null {
  if (!store || !RID_RE.test(rid)) return null;
  const k = PENDING_PREFIX + rid;
  let p: PendingPair | null = null;
  try {
    p = JSON.parse(store.getItem(k) ?? 'null') as PendingPair | null;
  } catch {
    p = null;
  }
  try {
    store.removeItem(k);
  } catch {
    /* ignore */
  }
  prunePending(store, now);
  if (!p || p.rid !== rid || typeof p.at !== 'number' || now - p.at > PENDING_TTL_MS) return null;
  return p;
}

/** `#bwx=ok&rid=<rid>` → rid; anything else → null. */
export function parseReturnHash(hash: string): string | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (q.get('bwx') !== 'ok') return null;
  const rid = q.get('rid') ?? '';
  return RID_RE.test(rid) ? rid : null;
}

/** The current URL without its fragment (the default `ret`, and what we put back after a return). */
export const withoutHash = (href: string) => href.split('#')[0];
