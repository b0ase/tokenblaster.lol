/**
 * Server side of the bWalletX pairing origin proof (bwallet PR #162, docs/PAIRING-ORIGIN-PROOF.md).
 *
 * The signing key comes ONLY from the environment (never committed):
 *   BWALLETX_PAIR_SIGNING_KEY   secp256k1 private key, WIF or 64 hex chars
 *   BWALLETX_PAIR_PUBLIC_KEYS   optional, comma-separated extra compressed pubkeys to keep publishing
 *                               (e.g. the previous key while rotating)
 * Unset key → no proof: the QR stays unsigned exactly as before and the well-known file lists no keys.
 */
import { PrivateKey } from '@bsv/sdk';
import { BROWSER_HINTS, QR_LIFETIME_S, RID_RE, isValidReturnUrl, signPairProof, signPairProofV2, type PairLink } from './protocol';

const PUBKEY = /^0[23][0-9a-f]{64}$/i;
let cached: { raw: string; key: PrivateKey | null } | null = null;

export function pairSigningKey(env: Record<string, string | undefined> = process.env): PrivateKey | null {
  const raw = (env.BWALLETX_PAIR_SIGNING_KEY || '').trim();
  if (cached && cached.raw === raw) return cached.key;
  let key: PrivateKey | null = null;
  try {
    if (/^[0-9a-f]{64}$/i.test(raw)) key = new PrivateKey(raw, 'hex');
    else if (raw) key = PrivateKey.fromWif(raw);
  } catch {
    key = null; // a malformed key must not take the site down; pairing falls back to unsigned
  }
  cached = { raw, key };
  return key;
}

/** Body of /.well-known/bwalletx-pair.json: the signing key's pubkey first, then any extras. Max 8. */
export function publishedPairKeys(env: Record<string, string | undefined> = process.env): string[] {
  const keys: string[] = [];
  const k = pairSigningKey(env);
  if (k) keys.push(k.toPublicKey().toString());
  for (const x of (env.BWALLETX_PAIR_PUBLIC_KEYS || '').split(',')) {
    const p = x.trim().toLowerCase();
    if (PUBKEY.test(p) && !keys.includes(p)) keys.push(p);
  }
  return keys.slice(0, 8);
}

/**
 * Sign a pairing link for this site only. `o` must be https://<the host the request arrived on>, and a browser
 * Origin header (when sent) must match it, so another web page can't get our name on its own QR.
 * Returns null when there is no key or the request doesn't fit.
 */
export function signPairRequest(
  body: unknown,
  host: string | null,
  originHeader: string | null,
  env: Record<string, string | undefined> = process.env,
  nowS = Math.floor(Date.now() / 1000),
): string | null {
  const key = pairSigningKey(env);
  if (!key || !body || typeof body !== 'object') return null;
  const { c, k, o, e } = body as Partial<Pick<PairLink, 'c' | 'k' | 'o' | 'e'>>;
  if (typeof c !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(c)) return null;
  if (typeof k !== 'string' || !PUBKEY.test(k)) return null;
  if (typeof e !== 'number' || !Number.isInteger(e) || e < nowS || e > nowS + QR_LIFETIME_S + 60) return null;
  if (typeof o !== 'string' || !host) return null;
  if (o !== `https://${host.toLowerCase()}`) return null;
  if (originHeader && originHeader !== o) return null;
  return signPairProof({ c, k, o, e }, key);
}

/**
 * v1 and v2 proofs for one link. `s2` is signed only when `ret` (on this host or a subdomain, see isValidReturnUrl),
 * `rid` and an optional known `b` all fit; otherwise it is null and the link pairs as v1, without a return.
 */
export function signPairRequestV2(
  body: unknown,
  host: string | null,
  originHeader: string | null,
  env: Record<string, string | undefined> = process.env,
  nowS = Math.floor(Date.now() / 1000),
): { s: string | null; s2: string | null } {
  const s = signPairRequest(body, host, originHeader, env, nowS);
  if (!s) return { s: null, s2: null };
  const { c, k, o, e, ret, rid } = body as Partial<PairLink>;
  const b = (body as { b?: unknown }).b;
  if (typeof ret !== 'string' || typeof rid !== 'string' || !RID_RE.test(rid)) return { s, s2: null };
  if (b !== undefined && b !== null && b !== '' && !(typeof b === 'string' && (BROWSER_HINTS as readonly string[]).includes(b))) return { s, s2: null };
  if (!isValidReturnUrl(ret, o as string)) return { s, s2: null };
  const s2 = signPairProofV2({ c: c!, k: k!, o: o!, e: e!, ret, rid, b: typeof b === 'string' && b ? b : undefined }, pairSigningKey(env)!);
  return { s, s2 };
}
