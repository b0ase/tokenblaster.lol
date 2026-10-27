/**
 * Server-side resolution of the TERRORNODE revenue destinations (src/lib/launch/split.ts), and the paymail
 * notification that credits each company's wallet. Fetch is injected so the tests run without the network.
 *
 *   bsvalias (bwalletx.com/.well-known/bsvalias, cached 5 min) → pki + p2p-destination + receive-tx templates
 *   pki     → the paymail's pubkey MUST equal the pinned identity key (cached 5 min), else refuse
 *   p2p-destination {satoshis: 1} → a one-time BRC-29 output + reference; the script MUST re-derive from the
 *             pinned key, else refuse. (Asked for 1 sat: the paymail server accepts any amount ≥ the quote.)
 *   receive-tx {hex, reference} → the company's wallet inbox picks the payment up. The server answers 200 only for
 *             its own reference whose outputs are in the tx, and 200 again for the same txid ("already received"),
 *             so a successful notify is also the proof the destination was genuinely issued.
 */
import { P2PKH } from '@bsv/sdk';
import { PAYEES, derivedAddress, payeeOf, pinned, splitSats, type PayeeId, type SplitDest, type SplitQuote } from './split';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const DOMAIN = 'bwalletx.com';
const TTL = 5 * 60_000;
const ANYONE_PUB = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

type Caps = { pki: string; p2p: string; receive: string };
let capsCache: { at: number; caps: Caps } | null = null;
const keyOk = new Map<PayeeId, number>();
export const _resetPayeeCache = () => {
  capsCache = null;
  keyOk.clear();
};

const fill = (t: string, alias: string) => t.replace('{alias}', alias).replace('{domain.tld}', DOMAIN);
const https = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\//i.test(u);

async function json(f: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const r = await f(url, { cache: 'no-store', ...init, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

async function caps(f: Fetch): Promise<Caps> {
  if (capsCache && Date.now() - capsCache.at < TTL) return capsCache.caps;
  const j = (await json(f, `https://${DOMAIN}/.well-known/bsvalias`)) as { capabilities?: Record<string, unknown> };
  const c = j?.capabilities ?? {};
  const out = { pki: c.pki, p2p: c['2a40af698840'], receive: c['5f1323cddf31'] };
  if (!https(out.pki) || !https(out.p2p) || !https(out.receive)) throw new Error('The paymail capabilities are incomplete.');
  capsCache = { at: Date.now(), caps: out as Caps };
  return capsCache.caps;
}

async function pinKey(id: PayeeId, c: Caps, f: Fetch) {
  const p = payeeOf(id);
  const seen = keyOk.get(id);
  if (!seen || Date.now() - seen > TTL) {
    const pki = (await json(f, fill(c.pki, p.alias))) as { pubkey?: unknown; handle?: unknown };
    if (pki?.pubkey !== p.identityKey) throw new Error(`${p.paymail} does not hold the pinned identity key.`);
    keyOk.set(id, Date.now());
  }
}

/** Both paymails answer with their pinned identity keys (no destination used up). Throws otherwise. */
export async function checkPayees(f: Fetch = fetch): Promise<void> {
  const c = await caps(f);
  await Promise.all(PAYEES.map((p) => pinKey(p.id, c, f)));
}

/** One pinned destination for `id`. Throws on any mismatch. */
export async function resolveDest(id: PayeeId, f: Fetch = fetch): Promise<SplitDest> {
  const p = payeeOf(id);
  const c = await caps(f);
  await pinKey(id, c, f);
  const d = (await json(f, fill(c.p2p, p.alias), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ satoshis: 1 }),
  })) as { outputs?: { script?: string; derivationPrefix?: string; derivationSuffix?: string; senderIdentityKey?: string }[]; reference?: string };
  const o = d?.outputs?.[0];
  if (!o || d.outputs!.length !== 1 || typeof o.script !== 'string' || typeof o.derivationPrefix !== 'string' || typeof o.derivationSuffix !== 'string')
    throw new Error(`${p.paymail} returned no usable destination.`);
  if (o.senderIdentityKey && o.senderIdentityKey !== ANYONE_PUB) throw new Error(`${p.paymail} used an unexpected derivation.`);
  const address = derivedAddress(p.identityKey, o.derivationPrefix, o.derivationSuffix);
  if (new P2PKH().lock(address).toHex() !== o.script) throw new Error(`${p.paymail} returned a destination that is not its pinned key.`);
  const dest: SplitDest = { payee: id, address, prefix: o.derivationPrefix, suffix: o.derivationSuffix, reference: String(d.reference ?? '') };
  if (!pinned(dest, id)) throw new Error(`${p.paymail} returned a bad reference.`);
  return dest;
}

/** A fresh pinned quote for both companies, or throws (the caller refuses paid play). */
export async function resolveSplit(f: Fetch = fetch): Promise<SplitQuote> {
  const [npg, bcorp] = await Promise.all([resolveDest('npg', f), resolveDest('bcorp', f)]);
  return { npg, bcorp };
}

/**
 * Tell each company's paymail server about its half (`total` = what the tx paid to the split). True when every
 * non-zero half was accepted (or already was). A refused reference means the destination was not issued for it.
 */
export async function notifySplit(txHex: string, q: SplitQuote, total: number, f: Fetch = fetch): Promise<{ ok: true } | { ok: false; why: string; retry: boolean }> {
  const c = await caps(f).catch(() => null);
  if (!c) return { ok: false, why: 'The paymail server is unreachable.', retry: true };
  const s = splitSats(total);
  for (const p of PAYEES) {
    if (s[p.id] <= 0) continue;
    const d = q[p.id];
    const r = await f(fill(c.receive, p.alias), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hex: txHex, reference: d.reference, metadata: { note: 'Welcome to TERRORNODE revenue (50/50 NPG Ltd · bCorp)' } }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!r) return { ok: false, why: `${p.paymail} is unreachable.`, retry: true };
    if (!r.ok) return { ok: false, why: `${p.paymail} refused the payment (${r.status}).`, retry: r.status >= 500 || r.status === 429 };
  }
  return { ok: true };
}
