/**
 * Proof that a score / tx report really comes from an X handle, for the hall of fame's identity tick.
 *
 * Same trust model as in-game identity (src/lib/identity.ts, docs/identity-verification.md): bWalletX registers the paymail
 * `<handle>.x@bwallet.space` only after a real X sign-in, and its public PKI returns that paymail's identity key. The player's
 * wallet signs a session string with that key; the server checks the signature against the PKI key. The session binds the
 * proof to one submission (kind, game, what was submitted) and a minute, so it cannot be replayed for another score.
 * No secrets, no stored keys. Identity stays cosmetic: it never decides who gets paid.
 */
import type { WalletInterface } from '@bsv/sdk';
import { cleanHandle, proveHandle, verifyWire } from './identity';

export type XProof = { k: string; s: number[]; m: number };
export type ProofKind = 'score' | 'tx';

/** A proof older (or newer) than this many minutes is refused. */
export const PROOF_WINDOW_MIN = 15;

export const proofMinute = (now = Date.now()) => Math.floor(now / 60_000);
export const proofSession = (kind: ProofKind, game: string, what: string, minute: number) => `tb:${kind}:${game}:${what}:${minute}`;

// ── Client: the wallet that can sign (registered by useBlaster when a wallet connects) ──

let wallet: WalletInterface | null = null;
export const setProofWallet = (w: WalletInterface | null) => {
  wallet = w;
};

/** Ask the connected wallet to sign for `handle`. Null: no wallet, wallet not linked to that X account, or no answer in 8 s. */
export async function makeProof(handle: string, kind: ProofKind, game: string, what: string): Promise<XProof | null> {
  const w = wallet;
  const h = cleanHandle(handle);
  if (!w || !h) return null;
  const m = proofMinute();
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), 8000));
  const wire = await Promise.race([proveHandle(w, h, proofSession(kind, game, what, m)), timeout]);
  return wire?.xk && wire.xs ? { k: wire.xk, s: wire.xs, m } : null;
}

// ── Server: check it ──

export const readProof = (p: unknown): XProof | null => {
  const o = (p ?? {}) as Record<string, unknown>;
  const k = typeof o.k === 'string' && /^0[23][0-9a-f]{64}$/i.test(o.k) ? o.k : null;
  const s = Array.isArray(o.s) && o.s.length <= 80 && o.s.every((n) => Number.isInteger(n) && n >= 0 && n < 256) ? (o.s as number[]) : null;
  const m = typeof o.m === 'number' && Number.isInteger(o.m) ? o.m : null;
  return k && s && m !== null ? { k, s, m } : null;
};

/** Is `proof` a fresh signature by the identity key bWalletX holds for `handle`, bound to exactly this submission? */
export async function checkProof(handle: string, proof: unknown, kind: ProofKind, game: string, what: string, now = Date.now()): Promise<boolean> {
  const x = cleanHandle(handle);
  const p = readProof(proof);
  if (!x || !p || Math.abs(p.m - proofMinute(now)) > PROOF_WINDOW_MIN) return false;
  return verifyWire({ x, xk: p.k, xs: p.s }, proofSession(kind, game, what, p.m));
}
