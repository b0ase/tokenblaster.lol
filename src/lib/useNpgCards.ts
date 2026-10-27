'use client';

/**
 * Which NPG cards (parts / stacks from ninja-punk-girls.com) a player owns. READ ONLY: no payment, signing or spending.
 *  1. GorillaPool 1Sat index: unspent txos at the wallet's address (+ any ordinals addresses the player saved for
 *     Ordnance), filtered to MAP `app: npg`; each card's JSON body (ORDFS /content/<origin>) names its elementIds.
 *  2. On the player's explicit tap only: the wallet's ordinal baskets (BRC-100 listOutputs), each outpoint looked
 *     up on the same index. Basket reads can open a permission sheet, so never in the background or during play.
 * Flag: NEXT_PUBLIC_TB_NPG_CARDS=0 turns all of it off (default roster only).
 */
import { useCallback, useEffect, useState } from 'react';
import type { WalletInterface } from '@bsv/sdk';
import { readBasket } from './basketSession';
import { walletHeld } from './wallet';
import { savedOrdinalAddresses } from './useOrdnance';
import { elementsOfCard, isNpgMap, ownedFrom, type NpgOwned } from './npgLoadout';

export const NPG_CARDS_ON = process.env.NEXT_PUBLIC_TB_NPG_CARDS !== '0';
const API = 'https://ordinals.gorillapool.io';
type Txo = { outpoint: string; spend?: string; origin?: { outpoint?: string; data?: { map?: Record<string, unknown> } } | null };

const bodies = new Map<string, Promise<string[]>>();
const cardElements = (origin: string) => {
  let p = bodies.get(origin);
  if (!p) {
    p = fetch(`${API}/content/${origin}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(elementsOfCard)
      .catch(() => []);
    bodies.set(origin, p);
  }
  return p;
};

async function fromTxos(txos: Txo[]): Promise<{ lists: string[][]; stacks: number }> {
  const npg = txos.filter((t) => !t.spend && t.origin?.outpoint && isNpgMap(t.origin.data?.map));
  const lists = await Promise.all(npg.map((t) => cardElements(t.origin!.outpoint!.replace('.', '_'))));
  return { lists, stacks: npg.filter((t) => isNpgMap(t.origin?.data?.map) === 'stack').length };
}

export async function npgAtAddresses(addresses: string[]): Promise<NpgOwned> {
  const all: string[][] = [];
  let stacks = 0;
  for (const a of [...new Set(addresses.filter(Boolean))]) {
    for (let offset = 0; offset < 5000; offset += 500) {
      const r = await fetch(`${API}/api/txos/address/${a}/unspent?limit=500&offset=${offset}&bsv20=false`);
      if (!r.ok) throw new Error(`GorillaPool ${r.status}`);
      const txos = (await r.json()) as Txo[];
      const f = await fromTxos(txos);
      all.push(...f.lists);
      stacks += f.stacks;
      if (txos.length < 500) break;
    }
  }
  return ownedFrom(all, stacks);
}

export async function npgInWallet(wallet: WalletInterface): Promise<NpgOwned> {
  const ops = new Set<string>();
  for (const basket of ['1sat', 'ordinals', 'npg']) {
    const r = await readBasket(wallet, { basket, limit: 1000 });
    for (const o of r?.outputs ?? []) if (o.spendable !== false) ops.add(o.outpoint.replace('.', '_'));
  }
  const txos = (
    await Promise.all(
      [...ops].slice(0, 200).map((op) =>
        fetch(`${API}/api/txos/${op}`)
          .then((r) => (r.ok ? (r.json() as Promise<Txo>) : null))
          .catch(() => null),
      ),
    )
  ).filter((t): t is Txo => !!t);
  const f = await fromTxos(txos);
  return ownedFrom(f.lists, f.stacks);
}

const EMPTY: NpgOwned = { elements: new Set(), girls: new Set(), stacks: 0 };
const merge = (a: NpgOwned, b: NpgOwned): NpgOwned => ({ elements: new Set([...a.elements, ...b.elements]), girls: new Set([...a.girls, ...b.girls]), stacks: a.stacks + b.stacks });

export function useNpgCards(wallet: { client: WalletInterface; address: string } | null) {
  const [chain, setChain] = useState<NpgOwned>(EMPTY);
  const [inWallet, setInWallet] = useState<NpgOwned>(EMPTY);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!NPG_CARDS_ON || !wallet) return;
    let cancelled = false;
    npgAtAddresses([wallet.address, ...savedOrdinalAddresses()])
      .then((o) => !cancelled && setChain(o))
      .catch(() => !cancelled && setError('Could not check your NPG cards right now.'));
    return () => {
      cancelled = true;
    };
  }, [wallet]);
  const checkWallet = useCallback(async () => {
    if (!NPG_CARDS_ON || !wallet || walletHeld()) return;
    setChecking(true);
    try {
      setInWallet(await npgInWallet(wallet.client));
      setChecked(true);
    } catch {
      setError('Your wallet did not answer. Try again outside play.');
    } finally {
      setChecking(false);
    }
  }, [wallet]);
  return { owned: merge(chain, inWallet), checking, checked, error, checkWallet, enabled: NPG_CARDS_ON && !!wallet };
}
