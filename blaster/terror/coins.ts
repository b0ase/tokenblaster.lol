/**
 * TERRORNODE coin selection: which funding (prep) coins are still spendable.
 *
 * A coin is skipped when ANY of these says it is spent:
 *  - the wallet-wide spent journal: the union of every ~/.tokenblaster/terror/spent-*.jsonl ("S <outpoint> <txid>",
 *    minus "R <outpoint>" releases). The per-bot journals are shared by every run, but a coin's owner bot depends on
 *    --total-bots, so a coin spent by bot01 in one run could land on bot05's slice in the next: the union closes that.
 *  - GorillaPool's spends index (POST /api/spends, one call for all coins), which sees mempool spends fast;
 *  - WhatsOnChain GET /tx/<txid>/<vout>/spent (200 = spent, 404 = unspent). WoC can lag minutes behind a spend.
 *
 * Never trust WoC's /address/<a>/balance for this wallet: on 31 Oct it reported 618,488,871 sats for 1NbrP33… while
 * the real figure was ~5 BSV. Coin values come from the prep tx's own outputs; spent status from the checks above.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Coin = { txid: string; vout: number; value: number };
export const outpoint = (c: { txid: string; vout: number }) => `${c.txid}:${c.vout}`;

/** Every outpoint any bot's journal in `dir` has spent and not released. */
export function journalSpent(dir: string): Map<string, string> {
  const spent = new Map<string, string>();
  if (!existsSync(dir)) return spent;
  for (const f of readdirSync(dir).filter((x) => /^spent-.*\.jsonl$/.test(x)).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const [k, a, b] = line.split(' ');
      if (k === 'S' && a) spent.set(a, b ?? '?');
      if (k === 'R' && a) spent.delete(a);
    }
  }
  return spent;
}

type F = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GorillaPool spends index: outpoint → spending txid ('' = unspent). Throws if the index can't be read. */
export async function gorillaSpends(coins: Coin[], o: { fetch?: F; url?: string } = {}): Promise<Map<string, string>> {
  const f = o.fetch ?? fetch;
  const url = o.url ?? 'https://ordinals.gorillapool.io/api/spends';
  const out = new Map<string, string>();
  for (let i = 0; i < coins.length; i += 1000) {
    const part = coins.slice(i, i + 1000);
    const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(part.map((c) => `${c.txid}_${c.vout}`)), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`GorillaPool /api/spends ${r.status}`);
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j) || j.length !== part.length) throw new Error('GorillaPool /api/spends: unexpected answer');
    part.forEach((c, k) => out.set(outpoint(c), typeof j[k] === 'string' ? (j[k] as string) : ''));
  }
  return out;
}

/** WhatsOnChain per-coin spent check (rate-limited: ~3 req/s). outpoint → spending txid ('' = unspent). */
export async function wocSpends(coins: Coin[], o: { fetch?: F; base?: string; perSec?: number; log?: (s: string) => void } = {}): Promise<Map<string, string>> {
  const f = o.fetch ?? fetch;
  const base = o.base ?? 'https://api.whatsonchain.com/v1/bsv/main';
  const gap = 1000 / (o.perSec ?? 3);
  const out = new Map<string, string>();
  for (const [i, c] of coins.entries()) {
    for (let tries = 0; ; tries++) {
      const r = await f(`${base}/tx/${c.txid}/${c.vout}/spent`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) { out.set(outpoint(c), ''); break; }
      if (r.ok) { const j = (await r.json()) as { txid?: string }; out.set(outpoint(c), j.txid ?? '?'); break; }
      if (tries >= 5) throw new Error(`WhatsOnChain spent check ${r.status} for ${outpoint(c)}`);
      await sleep(1000 * (tries + 1)); // 429: back off
    }
    if (o.log && (i + 1) % 100 === 0) o.log(`  WoC spent check ${i + 1}/${coins.length}`);
    await sleep(gap);
  }
  return out;
}

export type CoinCheck = { usable: Coin[]; skipped: { coin: Coin; by: string[] }[] };

/** Keep only the coins nobody says are spent. `checks` maps a source name to its outpoint → spender answers. */
export function usableCoins(coins: Coin[], checks: Record<string, Map<string, string>>): CoinCheck {
  const usable: Coin[] = [];
  const skipped: CoinCheck['skipped'] = [];
  for (const c of coins) {
    const k = outpoint(c);
    const by = Object.entries(checks).filter(([, m]) => !!m.get(k)).map(([name]) => name);
    if (by.length) skipped.push({ coin: c, by }); else usable.push(c);
  }
  return { usable, skipped };
}
