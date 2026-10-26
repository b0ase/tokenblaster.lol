// Copied from bitcoin-corp/bwallet src/pair/protocol.ts (keep in sync until it ships as @b0ase/wallet).
/**
 * Phone pairing protocol (tokenblaster.lol docs/wallet-connect.md §4), shared by the site side and
 * bWallet. Kept dependency-light (@bsv/sdk + WebCrypto) so the same file can be copied into sites
 * until it ships as @b0ase/wallet.
 *
 *   QR:     https://www.bwallet.space/pair?v=1&r=<relay host>&c=<channel>&k=<site pubkey>&o=<origin>&e=<expiry>
 *   key:    ECDH(secp256k1) → HKDF-SHA256(salt = channel bytes, info = "bwallet-pair-v1") → AES-256-GCM
 *   frame:  { s: seq, n: nonce b64, d: ciphertext b64 }, AAD = "<sender role>|<s>", s strictly increasing
 *   code:   first 2 bytes of SHA-256(key bits) → 4 digits, shown on both screens
 */
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';

export const PAIR_VERSION = '1';
export const PAIR_INFO = 'bwallet-pair-v1';
// www: the bare domain redirects there, and app-link checks (Apple's AASA) don't follow redirects.
export const PAIR_HOST = 'www.bwallet.space';
const PAIR_HOSTS = new Set([PAIR_HOST, 'bwallet.space']);
export const DEFAULT_RELAY = 'relay.bwallet.space';
export const QR_LIFETIME_S = 120;

export type Role = 'site' | 'wallet';
export type WalletInfo = { name: string; icon?: string; rdns: string };

/** `s` (optional): the site's origin proof, a DER signature (hex) over pairProofMessage by a key in its well-known file. */
export type PairLink = {
  v: string;
  r: string;
  c: string;
  k: string;
  o: string;
  e: number;
  s?: string;
  /** v2 return (bwallet docs/PAIRING-ORIGIN-PROOF.md): where the wallet sends the player back after Allow. */
  ret?: string;
  /** v2: one-time request id, 16 random bytes base64url. */
  rid?: string;
  /** v2: which browser opened the link. */
  b?: BrowserHint;
  /** v2 proof over c, k, o, e, ret, rid, b. */
  s2?: string;
};

/** Plaintext messages inside encrypted frames. */
export type PairMessage =
  | { t: 'req'; id: string; action: string; params: unknown }
  | { t: 'res'; id: string; result?: unknown; error?: { code: string; message: string } }
  | { t: 'ready' }
  | { t: 'ping' }
  | { t: 'close'; reason: string };

/** Unencrypted frames: from the relay, and the phone's hello (its key isn't shared yet). */
export type RelayFrame = { t: 'relay'; verifiedOrigin?: string; peer?: 'joined' | 'left'; role?: Role; error?: string };
export type HelloFrame = { t: 'hello'; k: string; info: WalletInfo };
export type SealedFrame = { s: number; n: string; d: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

// Chunked: String.fromCharCode(...bytes) overflows the call stack on large frames (signed transactions).
const binary = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};
export const b64url = (bytes: Uint8Array) =>
  btoa(binary(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const fromB64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};
const b64 = (bytes: Uint8Array) => btoa(binary(bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export const newChannel = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

export function pairUrl(link: PairLink): string {
  const q = new URLSearchParams({ v: link.v, r: link.r, c: link.c, k: link.k, o: link.o, e: String(link.e) });
  if (link.s) q.set('s', link.s);
  if (link.ret && link.rid) {
    q.set('ret', link.ret);
    q.set('rid', link.rid);
    if (link.b) q.set('b', link.b);
    if (link.s2) q.set('s2', link.s2);
  }
  return `https://${PAIR_HOST}/pair?${q}`;
}

/** Parse a scanned QR (https link or bwallet:// fallback). Throws on anything else. */
export function parsePairUrl(text: string, nowS = Math.floor(Date.now() / 1000)): PairLink {
  const u = new URL(text.trim());
  const ok =
    (u.protocol === 'https:' && PAIR_HOSTS.has(u.host) && u.pathname === '/pair') ||
    (u.protocol === 'bwallet:' && /pair/.test(u.href));
  if (!ok) throw new Error('Not a bWallet pairing code');
  const g = (k: string) => u.searchParams.get(k) ?? '';
  const link: PairLink = { v: g('v'), r: g('r'), c: g('c'), k: g('k'), o: g('o'), e: Number(g('e')) };
  if (link.v !== PAIR_VERSION) throw new Error('This pairing code needs a newer bWallet');
  if (!/^[A-Za-z0-9_-]{22}$/.test(link.c)) throw new Error('Bad pairing code');
  if (!/^0[23][0-9a-f]{64}$/i.test(link.k)) throw new Error('Bad pairing code');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(link.r)) throw new Error('Bad pairing code');
  const o = new URL(link.o);
  if (o.origin !== link.o) throw new Error('Bad pairing code');
  if (!Number.isFinite(link.e) || link.e < nowS) throw new Error('This code has expired. Ask the site for a new one.');
  const sig = g('s');
  if (sig && /^30[0-9a-f]{10,150}$/i.test(sig)) link.s = sig.toLowerCase();
  const ret = g('ret');
  if (ret && ret.length <= RET_MAX_BYTES) link.ret = ret;
  const rid = g('rid');
  if (RID_RE.test(rid)) link.rid = rid;
  const b = g('b').toLowerCase();
  if ((BROWSER_HINTS as readonly string[]).includes(b)) link.b = b as BrowserHint;
  const sig2 = g('s2');
  if (sig2 && /^30[0-9a-f]{10,150}$/i.test(sig2)) link.s2 = sig2.toLowerCase();
  return link;
}

// ---- Origin proof (bwallet docs/PAIRING-ORIGIN-PROOF.md, bwallet PR #162) ----
// Copied verbatim from bitcoin-corp/bwallet src/pair/protocol.ts. The site publishes its pairing public keys at
// https://<origin>/.well-known/bwalletx-pair.json ({"keys":["02…"]}) and puts `s` in the QR: a signature over the
// channel, its ephemeral key, the origin and the expiry. Without it the phone shows the host as "claims to be".
// A valid proof only changes that label; it grants nothing.

export const PAIR_PROOF_PATH = '/.well-known/bwalletx-pair.json';

/** What the site signs: binds the proof to this channel and ephemeral key, so it can't be replayed elsewhere. */
export const pairProofMessage = (l: Pick<PairLink, 'c' | 'k' | 'o' | 'e'>) =>
  Utils.toArray(`${PAIR_INFO}|proof|${l.c}|${l.k.toLowerCase()}|${l.o}|${l.e}`, 'utf8');

/** Site side (server only): sign a link with the origin's pairing key. */
export const signPairProof = (l: Pick<PairLink, 'c' | 'k' | 'o' | 'e'>, originKey: PrivateKey) =>
  Utils.toHex(originKey.sign(pairProofMessage(l)).toDER() as number[]);

// ---- v2: return to the site (bwallet branch phone-signin-return, docs/PAIRING-ORIGIN-PROOF.md) ----
// Ported verbatim from bitcoin-corp/bwallet src/pair/protocol.ts (signPairProofV2 / pairProofMessageV2).

export const PAIR_INFO_V2 = 'bwallet-pair-v2';
/** The return URL is at most 512 bytes; the request id is 16–64 base64url characters (16 random bytes = 22). */
export const RET_MAX_BYTES = 512;
export const RID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const BROWSER_HINTS = ['safari', 'chrome', 'firefox', 'samsung', 'edge', 'brave', 'other'] as const;
export type BrowserHint = (typeof BROWSER_HINTS)[number];

type V2Fields = Pick<PairLink, 'c' | 'k' | 'o' | 'e'> & { ret: string; rid: string; b?: string };
export const pairProofMessageV2String = (l: V2Fields) =>
  `${PAIR_INFO_V2}|proof|${l.c}|${l.k.toLowerCase()}|${l.o}|${l.e}|${l.ret}|${l.rid}|${l.b ?? ''}`;
export const pairProofMessageV2 = (l: V2Fields) => Utils.toArray(pairProofMessageV2String(l), 'utf8');
/** Site side (server only): the v2 proof (`s2`), sent next to `s` so older wallets still see the v1 proof. */
export const signPairProofV2 = (l: V2Fields, originKey: PrivateKey) =>
  Utils.toHex(originKey.sign(pairProofMessageV2(l)).toDER() as number[]);

export const newRequestId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

/**
 * A return URL the wallet will accept: https, on the host of `o` or a subdomain of it (never a parent or a
 * look-alike), no userinfo, no port, no fragment, at most 512 bytes (UTF-8).
 */
export function isValidReturnUrl(ret: string, o: string): boolean {
  if (typeof ret !== 'string' || !ret || new TextEncoder().encode(ret).length > RET_MAX_BYTES) return false;
  let u: URL, origin: URL;
  try {
    u = new URL(ret);
    origin = new URL(o);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || origin.protocol !== 'https:') return false;
  if (u.username || u.password || u.port || u.hash || ret.includes('#') || ret.includes('@')) return false;
  if (u.href !== ret) return false; // what we sign is what the wallet parses
  const h = u.hostname.toLowerCase();
  const oh = origin.hostname.toLowerCase();
  return h === oh || h.endsWith(`.${oh}`);
}

/** The browser that opened the link, from its UA (the wallet can't tell from the app). Brave hides in its UA. */
export function browserHint(ua: string, isBrave = false): BrowserHint {
  if (isBrave) return 'brave';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg(e|A|iOS)?\//i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/CriOS|Chrome\//i.test(ua)) return 'chrome';
  if (/Safari\//i.test(ua) && /AppleWebKit/i.test(ua)) return 'safari';
  return 'other';
}

export const relaySocketUrl = (relay: string, channel: string, role: Role, expiry?: number) => {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(relay);
  const q = new URLSearchParams({ role });
  if (expiry) q.set('e', String(expiry));
  return `${local ? 'ws' : 'wss'}://${relay}/v1/c/${channel}?${q}`;
};

/** Shared AES key + 4-digit comparison code from my private key and their public key. */
export async function deriveSession(mine: PrivateKey, theirs: string, channel: string) {
  const point = mine.deriveSharedSecret(PublicKey.fromString(theirs));
  const ikm = new Uint8Array(point.encode(true) as number[]);
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: fromB64url(channel), info: enc.encode(PAIR_INFO) },
      base,
      256,
    ),
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
  const code = String(((h[0] << 8) | h[1]) % 10000).padStart(4, '0');
  return { key, code };
}

/** One direction-aware encrypted pipe. `me` is the sender role used in the AAD. */
export class Sealer {
  private sent = 0;
  private lastSeen = 0;
  constructor(
    private key: CryptoKey,
    private me: Role,
  ) {}

  async seal(msg: PairMessage): Promise<SealedFrame> {
    const s = ++this.sent;
    const n = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: n, additionalData: enc.encode(`${this.me}|${s}`) },
        this.key,
        enc.encode(JSON.stringify(msg)),
      ),
    );
    return { s, n: b64(n), d: b64(ct) };
  }

  /** Decrypts a frame from the other side; null for replays, reflections or tampering. */
  async open(f: SealedFrame): Promise<PairMessage | null> {
    if (!Number.isInteger(f.s) || f.s <= this.lastSeen) return null;
    const from: Role = this.me === 'site' ? 'wallet' : 'site';
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(f.n), additionalData: enc.encode(`${from}|${f.s}`) },
        this.key,
        fromB64(f.d),
      );
      this.lastSeen = f.s;
      return JSON.parse(dec.decode(pt)) as PairMessage;
    } catch {
      return null;
    }
  }

  /** For resuming a session after a reload: continue counters where they were. */
  get counters() {
    return { sent: this.sent, lastSeen: this.lastSeen };
  }
  restore(c: { sent: number; lastSeen: number }) {
    this.sent = c.sent;
    this.lastSeen = c.lastSeen;
  }
}

export const isSealed = (x: unknown): x is SealedFrame =>
  !!x && typeof x === 'object' && 'd' in x && 'n' in x && 's' in x;
