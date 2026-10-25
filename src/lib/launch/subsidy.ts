/**
 * Server side of the ammo-coin discount (src/lib/launch/subsidyPlan.ts): the house discount key and its coins.
 * The key comes from AMMO_SUBSIDY_WIF (env only, never in code). Unset = no discount, whatever the config says.
 * Server only: never import from a client component.
 */
import 'server-only';
import { Beef, PrivateKey } from '@bsv/sdk';
import type { SubsidyCoin } from './subsidyPlan';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

function key(): PrivateKey | null {
  const wif = process.env.AMMO_SUBSIDY_WIF;
  if (!wif) return null;
  try {
    return PrivateKey.fromWif(wif);
  } catch {
    return null;
  }
}

export const subsidyConfigured = () => key() !== null;
export const subsidyAddress = () => key()?.toAddress() ?? null;
export function subsidyKey(): PrivateKey {
  const k = key();
  if (!k) throw new Error('The discount is not configured.');
  return k;
}

/**
 * A confirmed coin of the discount key with at least `need` sats, not one already held by
 * another open quote (`busy`). Smallest that fits, so big coins stay free for other coins' trades.
 */
export async function pickSubsidyCoin(need: number, busy: Set<string> = new Set()): Promise<SubsidyCoin | null> {
  const addr = subsidyAddress();
  if (!addr) return null;
  const r = await fetch(`${WOC}/address/${addr}/unspent`, { cache: 'no-store' });
  if (!r.ok) return null;
  const list = (await r.json()) as { tx_hash: string; tx_pos: number; value: number }[];
  // Smallest that fits, and only with a proven BEEF from WhatsOnChain (the wallet must be able to verify it).
  const fits = list.filter((u) => u.value >= need && !busy.has(`${u.tx_hash}_${u.tx_pos}`)).sort((a, b) => a.value - b.value);
  for (const u of fits.slice(0, 5)) {
    const beef = await fetch(`${WOC}/tx/${u.tx_hash}/beef`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : ''));
    if (!beef) continue;
    try {
      if (!Beef.fromString(beef.trim(), 'hex').findTxid(u.tx_hash)) continue;
    } catch {
      continue;
    }
    return { outpoint: `${u.tx_hash}_${u.tx_pos}`, sats: u.value, beef: beef.trim() };
  }
  return null;
}
