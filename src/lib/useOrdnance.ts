'use client';

/**
 * Which 1Sat Ordnance weapons a wallet owns. Two sources, either is enough:
 *  1. the wallet itself (BRC-100 listOutputs on its ordinal baskets, matched by origin tag), and
 *  2. the GorillaPool 1Sat index: unspent txos for the wallet's ordinals address(es)
 *     (GET /api/txos/address/{addr}/unspent), matched by origin outpoint or collection + weapon.
 * Unminted weapons (empty origin) can't be owned. Dev builds (or NEXT_PUBLIC_TB_ADMIN=1) can
 * simulate ownership with `?ordnance=all` or `?ordnance=pnee-shotgun,safu-blaster`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WalletInterface } from '@bsv/sdk';
import { readBasket } from './basketSession';
import { walletHeld } from './wallet';
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
    const r = await readBasket(wallet, { basket, includeTags: true, includeCustomInstructions: true, limit: 1000 });
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
/**
 * Owned weapon ids for a connected wallet (plus any ordinals addresses the player added).
 * The chain index (by address) is checked by itself. The wallet's own ordinal baskets are read ONLY when the player
 * taps "Check my wallet for ordnance" (`checkWallet`): each basket read can open a permission sheet in the wallet,
 * so it never happens in the background (owner, 25 Oct 2026), never during play, and at most once per session.
 */
export function useOrdnance(wallet: { client: WalletInterface; address: string } | null, extraAddresses: string[] = [], nonce = 0) {
  const [owned, setOwned] = useState<Set<string>>(() => new Set());
  const [inWallet, setInWallet] = useState<Set<string>>(() => new Set());
  const [walletChecked, setWalletChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraKey = extraAddresses.join(',');
  useEffect(() => {
    let cancelled = false;
    const sim = simulatedOrdnance();
    if (sim || (!wallet && !extraKey)) {
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
      try {
        (await ordnanceAtAddresses([wallet?.address ?? '', ...extraKey.split(',')])).forEach((id) => all.add(id));
      } catch {
        if (!cancelled) setError('Could not check your ordinals right now.');
      }
      if (cancelled) return;
      setOwned(all);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, extraKey, nonce]);
  /** The explicit tap: look in the wallet's ordinal baskets once. Refused while a round is live. */
  const checkWallet = useCallback(async () => {
    if (!wallet || walletHeld()) return;
    setChecking(true);
    try {
      setInWallet(await ordnanceInWallet(wallet.client));
      setWalletChecked(true);
    } catch {
      setError('Your wallet did not answer. Try again outside play.');
    } finally {
      setChecking(false);
    }
  }, [wallet]);
  const merged = useMemo(() => new Set([...owned, ...inWallet]), [owned, inWallet]);
  return { owned: merged, checking, error, checkWallet, walletChecked };
}
