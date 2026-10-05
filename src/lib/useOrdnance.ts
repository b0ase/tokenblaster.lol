'use client';

/**
 * Which 1Sat Ordnance weapons a wallet owns. Two sources, either is enough:
 *  1. the wallet itself (BRC-100 listOutputs on its ordinal baskets, matched by origin tag), and
 *  2. the GorillaPool 1Sat index: unspent txos for the wallet's ordinals address(es)
 *     (GET /api/txos/address/{addr}/unspent), matched by origin outpoint or collection + weapon.
 * Unminted weapons (empty origin) can't be owned. Dev builds (or NEXT_PUBLIC_TB_ADMIN=1) can
 * simulate ownership with `?ordnance=all` or `?ordnance=pnee-shotgun,safu-blaster`.
 */
import { useEffect, useState } from 'react';
import type { WalletInterface } from '@bsv/sdk';
import { ORDNANCE, ORDNANCE_COLLECTION, type Ordnance } from './ordnance';

const API = 'https://ordinals.gorillapool.io/api';
const norm = (op: string) => op.replace('.', '_');

type Txo = { outpoint: string; spend?: string; origin?: { outpoint?: string; data?: { map?: Record<string, unknown> } } | null };

/** Verified store issues (origin outpoint → weapon id), from /api/ordnance/issued. */
let issuedP: Promise<Map<string, string>> | null = null;
export function storeIssued(): Promise<Map<string, string>> {
  issuedP ??= fetch('/api/ordnance/issued')
    .then((r) => (r.ok ? r.json() : { issued: {} }))
    .then((j: { issued?: Record<string, string[]> }) => new Map(Object.entries(j.issued ?? {}).flatMap(([id, os]) => os.map((o) => [norm(o), id] as const))))
    .catch(() => {
      issuedP = null;
      return new Map<string, string>();
    });
  return issuedP;
}

/** Forget the cached store issues (after a purchase). */
export const resetStoreIssued = () => {
  issuedP = null;
};

/** Weapon a txo is an edition of, if any. */
function weaponFor(t: Txo, issued: Map<string, string>): Ordnance | undefined {
  const origin = t.origin?.outpoint ? norm(t.origin.outpoint) : '';
  const map = t.origin?.data?.map ?? {};
  let collectionId = '';
  const std = map.subTypeData;
  try {
    const sd = typeof std === 'string' ? JSON.parse(std) : std;
    if (sd && typeof sd === 'object' && typeof (sd as { collectionId?: unknown }).collectionId === 'string') collectionId = norm((sd as { collectionId: string }).collectionId);
  } catch {
    /* not JSON */
  }
  const bought = origin ? issued.get(origin) : undefined;
  if (bought) return ORDNANCE.find((o) => o.id === bought);
  return ORDNANCE.find(
    (o) =>
      (o.origin && norm(o.origin) === origin) ||
      (ORDNANCE_COLLECTION && collectionId === norm(ORDNANCE_COLLECTION) && (map.weapon === o.id || (typeof map.name === 'string' && map.name.startsWith(`${o.name} #`)))),
  );
}

/** Weapons held at these addresses, per the GorillaPool index. */
export async function ordnanceAtAddresses(addresses: string[]): Promise<Set<string>> {
  const owned = new Set<string>();
  const issued = await storeIssued();
  for (const a of addresses.filter(Boolean)) {
    for (let offset = 0; offset < 5000; offset += 500) {
      const r = await fetch(`${API}/txos/address/${a}/unspent?limit=500&offset=${offset}&bsv20=false`);
      if (!r.ok) throw new Error(`GorillaPool ${r.status}`);
      const txos = (await r.json()) as Txo[];
      for (const t of txos) if (!t.spend) { const w = weaponFor(t, issued); if (w) owned.add(w.id); }
      if (txos.length < 500) break;
    }
  }
  return owned;
}

/** Weapons whose inscription sits in the wallet's own ordinal baskets (tags carry the origin). */
export async function ordnanceInWallet(wallet: WalletInterface): Promise<Set<string>> {
  const owned = new Set<string>();
  const minted = ORDNANCE.filter((o) => o.origin);
  const issued = await storeIssued();
  if (!minted.length && !ORDNANCE_COLLECTION && !issued.size) return owned;
  for (const basket of ['1sat', 'ordinals', 'ordnance']) {
    const r = await wallet.listOutputs({ basket, includeTags: true, includeCustomInstructions: true, limit: 1000 }).catch(() => null);
    if (!r) continue;
    for (const o of r.outputs) {
      if (o.spendable === false) continue;
      const text = `${(o.tags ?? []).join(' ')} ${o.customInstructions ?? ''} ${o.outpoint}`.replace(/\./g, '_');
      for (const w of minted) if (text.includes(norm(w.origin))) owned.add(w.id);
      for (const [origin, id] of issued) if (text.includes(origin)) owned.add(id);
      for (const w of ORDNANCE) if (ORDNANCE_COLLECTION && text.includes(norm(ORDNANCE_COLLECTION)) && text.includes(`weapon:${w.id}`)) owned.add(w.id);
    }
  }
  return owned;
}

/** Dev-only simulated ownership from `?ordnance=`. */
export function simulatedOrdnance(): Set<string> | null {
  if (typeof window === 'undefined') return null;
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_TB_ADMIN !== '1') return null;
  const q = new URLSearchParams(window.location.search).get('ordnance');
  if (!q) return null;
  return new Set(q === 'all' ? ORDNANCE.map((o) => o.id) : q.split(','));
}

const EXTRA_KEY = 'tb:ordnance-addresses';
export const savedOrdinalAddresses = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(EXTRA_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
export const saveOrdinalAddresses = (a: string[]) => {
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(a));
  } catch {
    /* private mode */
  }
};

/** Owned weapon ids for a connected wallet (plus any ordinals addresses the player added). */
export function useOrdnance(wallet: { client: WalletInterface; address: string } | null, extraAddresses: string[] = [], nonce = 0) {
  const [owned, setOwned] = useState<Set<string>>(() => new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraKey = extraAddresses.join(',');
  useEffect(() => {
    let cancelled = false;
    const sim = simulatedOrdnance();
    const anyMinted = true; // store issues can exist with nothing owner-minted
    if (sim || (!wallet && !extraKey) || !anyMinted) {
      void Promise.resolve().then(() => !cancelled && setOwned(sim ?? new Set()));
      return () => {
        cancelled = true;
      };
    }
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setChecking(true);
      setError(null);
      const all = new Set<string>();
      const results = await Promise.allSettled([
        wallet ? ordnanceInWallet(wallet.client) : Promise.resolve(new Set<string>()),
        ordnanceAtAddresses([wallet?.address ?? '', ...extraKey.split(',')]),
      ]);
      for (const r of results) if (r.status === 'fulfilled') r.value.forEach((id) => all.add(id));
      if (cancelled) return;
      if (results.every((r) => r.status === 'rejected')) setError('Could not check your ordinals right now.');
      setOwned(all);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, extraKey, nonce]);
  return { owned, checking, error };
}
