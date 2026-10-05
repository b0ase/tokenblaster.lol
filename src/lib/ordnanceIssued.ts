/**
 * Server side of the 1Sat Ordnance store. A store issue is ONE transaction the buyer's wallet made:
 * the inscription (MAP app=tokenblaster.lol, weapon=<id>) plus a payment of at least the weapon's
 * price to the house address. Anyone can inscribe look-alikes, so an issue only counts once its
 * origin tx is checked on chain to carry that payment. Verified origins are cached in memory.
 */
import { ORDNANCE, ORDNANCE_APP, priceOf } from './ordnance';

const GP = 'https://ordinals.gorillapool.io/api';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
export const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU' // bCorp's receiving address (public, not a key);

type Txo = { outpoint: string; origin?: { outpoint?: string } | null };
const verdict = new Map<string, boolean>(); // origin txid → paid the house enough

async function paidHouse(txid: string, minSats: number): Promise<boolean> {
  const hit = verdict.get(txid);
  if (hit !== undefined) return hit;
  const r = await fetch(`${WOC}/tx/hash/${txid}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`WoC ${r.status}`);
  const tx = (await r.json()) as { vout: { value: number; scriptPubKey: { addresses?: string[] } }[] };
  const paid = tx.vout.reduce((n, v) => n + (v.scriptPubKey.addresses?.includes(HOUSE) ? Math.round(v.value * 1e8) : 0), 0);
  const ok = paid >= minSats;
  verdict.set(txid, ok);
  return ok;
}

/** Verified store issues per weapon: origin outpoints, oldest first. */
export async function issuedOrdnance(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!HOUSE) return out;
  await Promise.all(
    ORDNANCE.map(async (o) => {
      const r = await fetch(`${GP}/txos/search?limit=1000`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ map: { app: ORDNANCE_APP, weapon: o.id } }),
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`GorillaPool ${r.status}`);
      const origins = [...new Set(((await r.json()) as Txo[]).map((t) => t.origin?.outpoint).filter((x): x is string => Boolean(x)))];
      const ok: string[] = [];
      for (const origin of origins) if (await paidHouse(origin.split('_')[0], priceOf(o)).catch(() => false)) ok.push(origin);
      out[o.id] = ok;
    }),
  );
  return out;
}
