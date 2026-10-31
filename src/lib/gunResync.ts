/**
 * Gun re-sync (owner approved 31 Oct 2026). The browser gun keeps a local journal of outpoints its own transactions
 * spent (src/lib/gun.ts `spent`). Earlier bugs marked coins spent whose spenders never reached the network (fan-out
 * roots/leaves POSTed only to a stalled ARC, or never propagated): those coins are still unspent on chain but the gun
 * ignored them, so the CREDIT showed too little.
 *
 * For each journal outpoint that the chain still lists as unspent:
 *   1. WhatsOnChain GET /tx/<txid>/<vout>/spent: 404 = unspent; anything else = spent (stays spent).
 *      AND GorillaPool's spend index (/api/spends/<txid>_<vout>) must also say unspent: WOC's spent index lags
 *      (31 Oct 2026, owner's gun: WOC said 404 for 182ec682…:33 although f33ca5a0… spending it was in the tip block,
 *      and for 3d5ca11c…:0 whose spender was in mempool; GorillaPool had both). Either source's spender keeps it spent.
 *   2. Every spender txid we know for it (recorded in the journal, or found in this browser's tx cache) is asked of
 *      Arcade (GET /tx/<txid>) and ARC (GET /v1/tx/<txid>). If either still holds a spender (it could still
 *      propagate) the coin stays marked: "pending on network".
 *   3. Only when WOC says unspent AND neither broadcaster knows any spender is the local mark cleared.
 * Any answer we could not read (timeout, 5xx, repeated 429) keeps the coin spent. Never a double spend.
 *
 * Pure apart from the injected fetch and sleep, so the tests run in node with mocks. Runs server side
 * (/api/gun/resync): WhatsOnChain has no CORS header on its errors.
 */
export const WOC_MAIN = 'https://api.whatsonchain.com/v1/bsv/main';
export const ARCADE_URL = 'https://arcade.gorillapool.io';
export const ARC_URL_GP = 'https://arc.gorillapool.io';
/** GorillaPool's spend index: `"<spender txid>"` when spent (mempool included), `""` when not. */
export const GP_SPENDS = 'https://ordinals.gorillapool.io/api/spends';
/** Most outpoints one re-sync checks (largest first): each costs a WOC call, paced. */
export const RESYNC_MAX = 60;
/** Coins this small are not worth a WOC call (a 6-sat lane end costs more than it holds to spend). */
export const RESYNC_MIN_SATS = 100;

export type ResyncCandidate = { txid: string; vout: number; sats: number; spenders?: string[] };
export type ResyncVerdict = 'freed' | 'pending' | 'spent' | 'unknown';
export type ResyncResult = { op: string; sats: number; verdict: ResyncVerdict; why: string };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Deps = { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; paceMs?: number; tries?: number };

const op = (c: { txid: string; vout: number }) => `${c.txid}_${c.vout}`;
const TXID = /^[0-9a-f]{64}$/i;

/** GET with 429 back-off (Retry-After or doubling). Null = could not read (keep spent). */
export async function pacedGet(url: string, d: Deps = {}): Promise<Response | null> {
  const f = d.fetch ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const tries = d.tries ?? 4;
  let wait = d.paceMs ?? 350;
  for (let i = 0; i < tries; i++) {
    const r = await f(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (r && r.status !== 429 && r.status < 500) return r;
    if (i === tries - 1) return null;
    const ra = Number(r?.headers.get('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait);
    wait *= 2;
  }
  return null;
}

/** WhatsOnChain: is the outpoint spent? `spender` when it is. Null = unknown. */
export async function wocSpent(txid: string, vout: number, d: Deps = {}): Promise<{ spent: boolean; spender?: string } | null> {
  const r = await pacedGet(`${WOC_MAIN}/tx/${txid}/${vout}/spent`, d);
  if (!r) return null;
  if (r.status === 404) return { spent: false };
  if (!r.ok) return null;
  const j = (await r.json().catch(() => null)) as { txid?: string } | null;
  return { spent: true, spender: j?.txid };
}

/** GorillaPool's spend index. Null = could not read. */
export async function gpSpent(txid: string, vout: number, d: Deps = {}): Promise<{ spent: boolean; spender?: string } | null> {
  const r = await pacedGet(`${GP_SPENDS}/${txid}_${vout}`, d);
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => undefined)) as unknown;
  if (j === '' || j === null) return { spent: false };
  if (typeof j === 'string' && TXID.test(j)) return { spent: true, spender: j };
  return null;
}

/** Does a broadcaster still hold `txid`? true / false (404) / null (could not tell). */
export async function brokerKnows(url: string, d: Deps = {}): Promise<boolean | null> {
  const r = await pacedGet(url, d);
  if (!r) return null;
  if (r.status === 404) return false;
  if (!r.ok) return null;
  const j = (await r.json().catch(() => null)) as { txStatus?: string; status?: string | number } | null;
  // ARC answers 200 with txStatus; a rejected / unknown status means it does not hold it for propagation.
  const s = String(j?.txStatus ?? '').toUpperCase();
  if (s === 'REJECTED' || s === 'UNKNOWN' || s === 'DOUBLE_SPEND_ATTEMPTED') return false;
  return true;
}

/** Decide one outpoint. Sequential WOC/Arcade/ARC calls, each paced. */
export async function checkOutpoint(c: ResyncCandidate, d: Deps = {}): Promise<ResyncResult> {
  const base = { op: op(c), sats: c.sats };
  const w = await wocSpent(c.txid, c.vout, d);
  if (!w) return { ...base, verdict: 'unknown', why: 'WhatsOnChain could not be read: kept spent' };
  if (w.spent) return { ...base, verdict: 'spent', why: `spent on chain${w.spender ? ` by ${w.spender.slice(0, 8)}…` : ''}` };
  const g = await gpSpent(c.txid, c.vout, d);
  if (!g) return { ...base, verdict: 'unknown', why: 'GorillaPool spend index could not be read: kept spent' };
  if (g.spent) return { ...base, verdict: 'spent', why: `spent by ${g.spender!.slice(0, 8)}… (GorillaPool; WhatsOnChain lags)` };
  for (const s of new Set((c.spenders ?? []).filter((t) => TXID.test(t)))) {
    const arcade = await brokerKnows(`${ARCADE_URL}/tx/${s}`, d);
    if (arcade !== false) return { ...base, verdict: arcade ? 'pending' : 'unknown', why: arcade ? `Arcade still holds ${s.slice(0, 8)}…` : 'Arcade could not be read: kept spent' };
    const arc = await brokerKnows(`${ARC_URL_GP}/v1/tx/${s}`, d);
    if (arc !== false) return { ...base, verdict: arc ? 'pending' : 'unknown', why: arc ? `ARC still holds ${s.slice(0, 8)}…` : 'ARC could not be read: kept spent' };
  }
  return { ...base, verdict: 'freed', why: 'unspent on chain and no broadcaster holds a spender' };
}

/** Check up to RESYNC_MAX candidates (largest first), one at a time. */
export async function resyncCheck(cands: ResyncCandidate[], d: Deps = {}): Promise<ResyncResult[]> {
  const list = cands
    .filter((c) => TXID.test(c.txid) && Number.isInteger(c.vout) && c.vout >= 0 && c.sats >= RESYNC_MIN_SATS)
    .sort((a, b) => b.sats - a.sats)
    .slice(0, RESYNC_MAX);
  const out: ResyncResult[] = [];
  for (const c of list) out.push(await checkOutpoint(c, d));
  return out;
}

/**
 * The journal outpoints worth checking: marked spent locally, yet still listed unspent by the chain read.
 * `spenderOf` gives the spender txids we know (journal record or cached tx hex).
 */
export function resyncCandidates(
  spent: Set<string>,
  chain: { txid: string; vout: number; sats: number }[],
  spenderOf: (op: string) => string[] = () => [],
): ResyncCandidate[] {
  const seen = new Set<string>();
  const out: ResyncCandidate[] = [];
  for (const c of chain) {
    const k = op(c);
    if (!spent.has(k) || seen.has(k) || c.sats < RESYNC_MIN_SATS) continue;
    seen.add(k);
    out.push({ ...c, spenders: spenderOf(k) });
  }
  return out.sort((a, b) => b.sats - a.sats).slice(0, RESYNC_MAX);
}

/** "Found $X.XX that was stuck — it's back in your credit" (or what is still pending). */
export function resyncMessage(r: ResyncResult[], bsvUsd: number): string {
  const sum = (v: ResyncVerdict) => r.filter((x) => x.verdict === v).reduce((n, x) => n + x.sats, 0);
  const usd = (s: number) => `$${((s / 1e8) * bsvUsd).toFixed(2)}`;
  const freed = sum('freed');
  const pending = sum('pending');
  const parts: string[] = [];
  if (freed) parts.push(`Found ${usd(freed)} that was stuck — it's back in your credit`);
  if (pending) parts.push(`${usd(pending)} pending on network`);
  return parts.length ? parts.join(' · ') : 'Nothing stuck: your credit matches the chain';
}

/** Clear the local spent mark of every outpoint answered `freed` (and only those). Returns the cleared outpoints. */
export function applyResync(spent: Set<string>, results: ResyncResult[]): string[] {
  const out: string[] = [];
  for (const r of results) if (r.verdict === 'freed' && spent.delete(r.op)) out.push(r.op);
  return out;
}
