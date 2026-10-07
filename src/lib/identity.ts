/**
 * Player identity for multiplayer: an X (Twitter) handle + avatar, shown over everyone's head in-game.
 *
 * Phase 1 (unverified): the player types their @handle once (kept in localStorage). Avatar = /api/avatar/<handle>
 * (a same-origin proxy of unavatar.io with an identicon fallback, so it is always CORS-safe as a WebGL texture).
 *
 * Phase 2 (verified tick): bWalletX only registers the paymail `<handle>.x@bwallet.space` after a real X OAuth
 * sign-in (bwalletX-launchpad site/lib/social.js), and its public PKI (CORS *) returns that paymail's identity key.
 * A player proves the handle by signing this room session with their wallet's identity key (BRC-100
 * createSignature, counterparty 'anyone'); every peer checks the signature against the PKI key. No secrets, no
 * server of ours. Spec + limits: docs/identity-verification.md.
 *
 * Identity is cosmetic. NEVER use it for payments: money still goes to each player's gun/wallet address.
 */
import { PrivateKey, ProtoWallet, Utils, type WalletInterface } from '@bsv/sdk';

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const STORE = 'tb.xhandle';

/** "@Alice_1 " → "Alice_1"; anything that is not a valid X username → null. */
export function cleanHandle(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const h = s.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
  return HANDLE_RE.test(h) ? h : null;
}

export const avatarUrl = (handle: string) => `/api/avatar/${encodeURIComponent(handle.toLowerCase())}`;

/** Deterministic 5x5 identicon (SVG) for a handle: the fallback when there is no avatar. */
export function identiconSvg(handle: string): string {
  let h = 2166136261;
  for (const ch of handle.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = h % 360;
  let cells = '';
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if (((h >>> ((y * 3 + x) % 31)) & 1) === 0) continue;
      cells += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>`;
      if (x < 2) cells += `<rect x="${5 - x}" y="${y + 1}" width="1" height="1"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" width="128" height="128" shape-rendering="crispEdges"><rect width="7" height="7" fill="hsl(${hue},30%,14%)"/><g fill="hsl(${hue},85%,60%)">${cells}</g></svg>`;
}
export const identiconUrl = (handle: string) => `data:image/svg+xml;utf8,${encodeURIComponent(identiconSvg(handle))}`;

// ── My handle (this browser) ──

export function loadMyHandle(): string | null {
  try {
    return cleanHandle(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}
const subs = new Set<() => void>();
export function saveMyHandle(h: string | null) {
  try {
    if (h) localStorage.setItem(STORE, h);
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: kept for this page only */
  }
  mem = h;
  for (const f of subs) f();
}
let mem: string | null | undefined;
export const myHandle = () => (mem === undefined ? (mem = loadMyHandle()) : mem);
export function onMyHandle(f: () => void) {
  subs.add(f);
  return () => void subs.delete(f);
}

// ── Wire format (presence / pose payloads) ──

/** What travels in realtime: x = handle, xk = identity key, xs = signature over the session (both optional). */
export type IdWire = { x?: string; xk?: string; xs?: number[] };
export type PlayerIdentity = { handle: string; avatar: string; verified: boolean };

/** Sanitise an untrusted payload's identity fields. */
export function readWire(m: unknown): IdWire {
  const o = (m ?? {}) as Record<string, unknown>;
  const x = cleanHandle(o.x);
  if (!x) return {};
  const xk = typeof o.xk === 'string' && /^0[23][0-9a-f]{64}$/i.test(o.xk) ? o.xk : undefined;
  const xs = Array.isArray(o.xs) && o.xs.length <= 80 && o.xs.every((n) => Number.isInteger(n) && n >= 0 && n < 256) ? (o.xs as number[]) : undefined;
  return xk && xs ? { x, xk, xs } : { x };
}

// ── Verified handles via bWalletX's X paymail ──

const PKI = process.env.NEXT_PUBLIC_BWALLETX_PKI ?? 'https://pay.bwallet.space/api/paymail/id/{alias}@bwallet.space';
/** bWalletX's alias for an X account: @B0ase_X → b0ase-x.x */
export const xAlias = (handle: string) => `${handle.toLowerCase().replace(/_/g, '-')}.x`;
const SIG_PROTO: [1, string] = [1, 'tokenblaster x handle'];
const sigData = (handle: string, session: string) => Utils.toArray(`${handle.toLowerCase()} ${session}`, 'utf8');

const pkiCache = new Map<string, Promise<string | null>>();
/** The identity key bWalletX holds for this X handle (null = not linked / offline). */
export function xIdentityKey(handle: string): Promise<string | null> {
  const a = xAlias(handle);
  let p = pkiCache.get(a);
  if (!p) {
    p = fetch(PKI.replace('{alias}', encodeURIComponent(a)), { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ pubkey?: string }>) : {}))
      .then((j: { pubkey?: string }) => (typeof j.pubkey === 'string' && /^0[23][0-9a-f]{64}$/i.test(j.pubkey) ? j.pubkey.toLowerCase() : null))
      .catch(() => null);
    pkiCache.set(a, p);
  }
  return p;
}

/** Ask the connected wallet to prove `handle` for this session. Null when the wallet isn't the one bWalletX linked. */
export async function proveHandle(wallet: WalletInterface, handle: string, session: string): Promise<IdWire | null> {
  try {
    const want = await xIdentityKey(handle);
    if (!want) return null;
    const { publicKey } = await wallet.getPublicKey({ identityKey: true });
    if (publicKey.toLowerCase() !== want) return null;
    const { signature } = await wallet.createSignature({ data: sigData(handle, session), protocolID: SIG_PROTO, keyID: '1', counterparty: 'anyone' });
    return { x: handle, xk: want, xs: signature };
  } catch {
    return null;
  }
}

const ANYONE = new ProtoWallet(new PrivateKey(1));
const checked = new Map<string, Promise<boolean>>();
/** Does this wire prove its handle for `session` (the player's room id)? Cached. */
export function verifyWire(w: IdWire, session: string): Promise<boolean> {
  if (!w.x || !w.xk || !w.xs) return Promise.resolve(false);
  const key = `${w.x.toLowerCase()}|${w.xk}|${session}|${w.xs.join(',')}`;
  let r = checked.get(key);
  if (!r) {
    const { x, xk, xs } = w;
    r = (async () => {
      try {
        if ((await xIdentityKey(x)) !== xk.toLowerCase()) return false;
        const { valid } = await ANYONE.verifySignature({ data: sigData(x, session), signature: xs, protocolID: SIG_PROTO, keyID: '1', counterparty: xk });
        return valid;
      } catch {
        return false;
      }
    })();
    checked.set(key, r);
  }
  return r;
}

/** Display identity for a wire (verified is filled in later by verifyWire). */
export const identityOf = (w: IdWire, verified = false): PlayerIdentity | null => (w.x ? { handle: w.x, avatar: avatarUrl(w.x), verified } : null);

/** "@alice" or a fallback name. */
export const displayName = (w: IdWire | null | undefined, fallback: string) => (w?.x ? `@${w.x}` : fallback);

/** X post intent that invites a group chat into a room. */
export function inviteIntent(link: string, game: string) {
  const text = `Come get blasted in ${game}: ${link}`;
  return { text, url: `https://x.com/intent/post?text=${encodeURIComponent(text)}` };
}
