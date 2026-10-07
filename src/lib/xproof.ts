/**
 * Proof that a score / tx report really comes from an X handle, for the hall of fame's identity tick.
 *
 * Same trust model as in-game identity (src/lib/identity.ts, docs/identity-verification.md): bWalletX registers the paymail
 * `<handle>.x@bwallet.space` only after a real X sign-in, and its public PKI returns that paymail's identity key. The player's
 * wallet signs a session string with that key; the server checks the signature against the PKI key. The session binds the
 * proof to one submission (kind, game, what was submitted) and a minute, so it cannot be replayed for another score.
 *
 * No automatic prompts: submits never ask the wallet to sign. The player presses ✓ VERIFY once (verifyHandle), which
 * signs a handle-only session (`tb:id:<minute>`, marked `v: 1`), caches it in localStorage and attaches it to later
 * score / tx submits. That cached proof is valid for VERIFY_WINDOW_DAYS; a bound per-submission proof (no `v`) is
 * still accepted for older clients.
 * No secrets, no stored keys. Identity stays cosmetic: it never decides who gets paid.
 */
import type { WalletInterface } from '@bsv/sdk';
import { cleanHandle, proveHandle, verifyWire } from './identity';

export type XProof = { k: string; s: number[]; m: number; v?: 1 };
export type ProofKind = 'score' | 'tx';

/** A proof older (or newer) than this many minutes is refused. */
export const PROOF_WINDOW_MIN = 15;

export const proofMinute = (now = Date.now()) => Math.floor(now / 60_000);
export const proofSession = (kind: ProofKind, game: string, what: string, minute: number) => `tb:${kind}:${game}:${what}:${minute}`;
/** A one-time ✓ VERIFY proof is good for this many days, then the player presses VERIFY again. */
export const VERIFY_WINDOW_DAYS = 30;
const VERIFY_WINDOW_MIN = VERIFY_WINDOW_DAYS * 24 * 60;
export const verifySession = (minute: number) => `tb:id:${minute}`;

// ── Client: the wallet that can sign (registered by useBlaster when a wallet connects) ──

let wallet: WalletInterface | null = null;
export const setProofWallet = (w: WalletInterface | null) => {
  wallet = w;
};

export const hasProofWallet = () => wallet !== null;

const CACHE_KEY = 'tb.xproof';
const listeners = new Set<() => void>();
export const onCachedProof = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The cached ✓ VERIFY proof for `handle`, if still fresh. Never prompts. */
export function cachedProof(handle: string | null | undefined): XProof | null {
  const h = cleanHandle(handle ?? '');
  if (!h || typeof window === 'undefined') return null;
  try {
    const o = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { h?: string; p?: unknown } | null;
    const p = readProof(o?.p);
    if (!p || p.v !== 1 || o?.h?.toLowerCase() !== h.toLowerCase()) return null;
    return proofMinute() - p.m > VERIFY_WINDOW_MIN - 60 ? null : p;
  } catch {
    return null;
  }
}

/** The explicit ✓ VERIFY button: ask the connected wallet to sign once for `handle` and cache it. Null: no wallet, not linked, or no answer in 60 s. */
export async function verifyHandle(handle: string): Promise<XProof | null> {
  const w = wallet;
  const h = cleanHandle(handle);
  if (!w || !h) return null;
  const m = proofMinute();
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), 60_000));
  const wire = await Promise.race([proveHandle(w, h, verifySession(m)), timeout]);
  if (!wire?.xk || !wire.xs) return null;
  const p: XProof = { k: wire.xk, s: wire.xs, m, v: 1 };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ h, p }));
  } catch {
    /* storage blocked: still verified for this page */
  }
  listeners.forEach((fn) => fn());
  return p;
}

// ── Server: check it ──

export const readProof = (p: unknown): XProof | null => {
  const o = (p ?? {}) as Record<string, unknown>;
  const k = typeof o.k === 'string' && /^0[23][0-9a-f]{64}$/i.test(o.k) ? o.k : null;
  const s = Array.isArray(o.s) && o.s.length <= 80 && o.s.every((n) => Number.isInteger(n) && n >= 0 && n < 256) ? (o.s as number[]) : null;
  const m = typeof o.m === 'number' && Number.isInteger(o.m) ? o.m : null;
  if (!k || !s || m === null) return null;
  return o.v === 1 ? { k, s, m, v: 1 } : { k, s, m };
};

/** Is `proof` a fresh signature by the identity key bWalletX holds for `handle`: a ✓ VERIFY proof (v: 1) or one bound to exactly this submission? */
export async function checkProof(handle: string, proof: unknown, kind: ProofKind, game: string, what: string, now = Date.now()): Promise<boolean> {
  const x = cleanHandle(handle);
  const p = readProof(proof);
  if (!x || !p) return false;
  const age = proofMinute(now) - p.m;
  if (p.v === 1) return age >= -PROOF_WINDOW_MIN && age <= VERIFY_WINDOW_MIN && verifyWire({ x, xk: p.k, xs: p.s }, verifySession(p.m));
  if (Math.abs(age) > PROOF_WINDOW_MIN) return false;
  return verifyWire({ x, xk: p.k, xs: p.s }, proofSession(kind, game, what, p.m));
}
