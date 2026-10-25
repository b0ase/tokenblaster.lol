/**
 * Recoverable gun (owner money-ok, 25 Oct 2026). The gun's key lives in this browser (src/lib/gun.ts); clearing site
 * data or changing device used to lose it, with its sats and tokens. Now the key is ENCRYPTED BY THE PLAYER'S OWN
 * BRC-100 WALLET (encrypt, protocol [1, 'tokenblaster gun'], keyID 'v1', counterparty 'self') and only that ciphertext
 * and the gun's ADDRESS are kept server-side, under the player's identity key (db/025_gun_backups.sql). The server can
 * never read the key: only the same wallet can decrypt it. Every request is signed by the identity key (BRC-3, the
 * same pattern as /api/launch/claim).
 *
 * Never log the key, the WIF, or the decrypted bytes.
 */
import { Hash, PrivateKey, ProtoWallet, Utils, type WalletInterface, type WalletProtocol } from '@bsv/sdk';
import type { Wallet } from './wallet';

export const GUN_PROTO: WalletProtocol = [1, 'tokenblaster gun'];
export const GUN_KEY_ID = 'v1';
export const BACKUP_SIG_PROTO: WalletProtocol = [1, 'tokenblaster gun backup'];
/** A signed request is good for this long. */
export const BACKUP_SIG_MS = 5 * 60_000;
export const MAX_CIPHER_HEX = 1024;

export type GunBackup = { address: string; ciphertext: string };
export const isAddr = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
export const isIdKey = (k: unknown): k is string => typeof k === 'string' && /^0[23][0-9a-f]{64}$/.test(k);
export const isCipher = (c: unknown): c is string => typeof c === 'string' && c.length <= MAX_CIPHER_HEX && c.length >= 32 && /^[0-9a-f]+$/.test(c) && c.length % 2 === 0;

/** Encrypt the gun key with the player's wallet. Returns hex ciphertext. */
export async function sealGunKey(w: Pick<WalletInterface, 'encrypt'>, key: PrivateKey): Promise<string> {
  const { ciphertext } = await w.encrypt({ plaintext: Utils.toArray(key.toWif(), 'utf8'), protocolID: GUN_PROTO, keyID: GUN_KEY_ID, counterparty: 'self' });
  return Utils.toHex(ciphertext);
}

/** Decrypt a backup with the player's wallet and check it really is the key for `address` before anyone uses it. */
export async function openGunKey(w: Pick<WalletInterface, 'decrypt'>, b: GunBackup): Promise<PrivateKey> {
  const { plaintext } = await w.decrypt({ ciphertext: Utils.toArray(b.ciphertext, 'hex'), protocolID: GUN_PROTO, keyID: GUN_KEY_ID, counterparty: 'self' });
  let key: PrivateKey;
  try {
    key = PrivateKey.fromWif(Utils.toUTF8(plaintext));
  } catch {
    throw new Error('The gun backup did not decrypt to a key.');
  }
  if (key.toAddress() !== b.address) throw new Error('The gun backup does not match its address.');
  return key;
}

/** What the identity key signs: the operation, itself, the gun address and the ciphertext's hash (put), and the time. */
export function backupMessage(op: 'put' | 'get', identityKey: string, ts: string, address = '', ciphertext = ''): string {
  const h = ciphertext ? Utils.toHex(Hash.sha256(Utils.toArray(ciphertext, 'hex'))) : '';
  return `TokenBlaster gun backup ${op}\n${identityKey}\n${address}\n${h}\n${ts}`;
}

export type BackupRequest = { op: 'put' | 'get'; identityKey: string; ts: string; signature: string; address?: string; ciphertext?: string };

/** Server side: is this request signed by `identityKey`, recently, for exactly this address and ciphertext? */
export async function verifyBackupRequest(r: BackupRequest, now = Date.now()): Promise<boolean> {
  if (!isIdKey(r.identityKey) || !/^\d{10,16}$/.test(r.ts ?? '') || !/^[0-9a-f]{16,200}$/.test(r.signature ?? '')) return false;
  if (!(Math.abs(now - Number(r.ts)) < BACKUP_SIG_MS)) return false;
  if (r.op === 'put' && (!isAddr(r.address) || !isCipher(r.ciphertext))) return false;
  const data = Utils.toArray(backupMessage(r.op, r.identityKey, r.ts, r.address, r.ciphertext), 'utf8');
  const { valid } = await new ProtoWallet('anyone')
    .verifySignature({ data, signature: Utils.toArray(r.signature, 'hex'), protocolID: BACKUP_SIG_PROTO, keyID: r.ts, counterparty: r.identityKey })
    .catch(() => ({ valid: false }));
  return valid;
}

/** Client side: sign a request with the wallet's identity key (counterparty 'anyone', so the server can check it). */
export async function signBackupRequest(w: Pick<Wallet, 'client' | 'publicKey'>, op: 'put' | 'get', address?: string, ciphertext?: string, now = Date.now()): Promise<BackupRequest> {
  const ts = String(now);
  const data = Utils.toArray(backupMessage(op, w.publicKey, ts, address, ciphertext), 'utf8');
  const { signature } = await w.client.createSignature({ data, protocolID: BACKUP_SIG_PROTO, keyID: ts, counterparty: 'anyone' });
  return { op, identityKey: w.publicKey, ts, signature: Utils.toHex(signature), address, ciphertext };
}

export type BackupApi = { put: (r: BackupRequest) => Promise<void>; get: (r: BackupRequest) => Promise<GunBackup[]> };
export const httpBackupApi: BackupApi = {
  async put(r) {
    const res = await fetch('/api/gun/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Gun backup failed (${res.status}).`);
  },
  async get(r) {
    const res = await fetch('/api/gun/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Gun backup lookup failed (${res.status}).`);
    const j = (await res.json()) as { backups?: GunBackup[] };
    return (j.backups ?? []).filter((b) => isAddr(b.address) && isCipher(b.ciphertext));
  },
};

/** Which (identity key, gun address) pairs this browser already backed up, so connecting doesn't re-ask the wallet. */
const DONE = 'tokenblaster.gunBackup';
const doneList = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DONE) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
export const isBackedUp = (identityKey: string, address: string) => doneList().includes(`${identityKey}:${address}`);
const markBackedUp = (identityKey: string, address: string) => {
  try {
    localStorage.setItem(DONE, JSON.stringify([...new Set([...doneList(), `${identityKey}:${address}`])].slice(-50)));
  } catch {
    /* it is just asked again next time */
  }
};

/** The parts of the gun this needs (src/lib/gun.ts Gun). */
export type GunLike = {
  readonly locked: boolean;
  readonly fresh: boolean;
  readonly address: string;
  balance(): Promise<number>;
  tokensHeld(): Promise<unknown[]>;
  adoptKey(key: PrivateKey): boolean;
  exportWif(): string;
};

/** Refused backups: (identity key, gun address) pairs whose wallet said no to the backup. We stop asking. */
const DECLINED = 'tokenblaster.gunBackup.declined';
const declinedList = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DECLINED) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
export const isBackupDeclined = (identityKey: string, address: string) => declinedList().includes(`${identityKey}:${address}`);
const markDeclined = (identityKey: string, address: string) => {
  try {
    localStorage.setItem(DECLINED, JSON.stringify([...new Set([...declinedList(), `${identityKey}:${address}`])].slice(-50)));
  } catch {
    /* asked again next session at most */
  }
};
const refused = (e: unknown) => /cancel|denied|reject|declin|abort|not approved|user (?:said no|refused)/i.test(e instanceof Error ? e.message : String(e));

export type RestoreResult = 'restored' | 'ok' | 'locked';

/**
 * ON CONNECT ONLY, and only when this browser has no readable gun (fresh, never backed up here, or locked): look for
 * the player's wallet backup and adopt it, checking the key against its stored address. A readable local gun is never
 * touched and costs no wallet call ('ok'). Never replaces a gun that holds coins. 'locked' = unreadable, no backup.
 */
export async function restoreGunIfNeeded(w: Pick<Wallet, 'client' | 'publicKey'>, g: GunLike, api: BackupApi = httpBackupApi): Promise<RestoreResult> {
  if (!g.locked && !(g.fresh && !isBackedUp(w.publicKey, g.address))) return 'ok';
  const list = await api.get(await signBackupRequest(w, 'get')).catch(() => null);
  for (const b of list ?? []) {
    let key: PrivateKey;
    try {
      key = await openGunKey(w.client, b);
    } catch {
      continue; // another wallet's, corrupt, or the wrong address: never used
    }
    if (!g.locked) {
      // A fresh gun gives way only if it truly holds nothing (chain included).
      const bal = await g.balance().catch(() => -1);
      const toks = await g.tokensHeld().catch(() => null);
      if (bal !== 0 || !toks || toks.length) break;
    }
    if (g.adoptKey(key)) {
      markBackedUp(w.publicKey, g.address);
      return 'restored';
    }
    break;
  }
  return g.locked ? 'locked' : 'ok';
}

export type BackupResult = 'backed-up' | 'ok' | 'declined' | 'locked';

/**
 * Back the gun key up (wallet encrypt + one identity signature + POST). At most once per gun per identity; a refusal
 * is remembered and never asked again. Called only AFTER a successful payment, in the background (scheduleGunBackup).
 */
export async function backupGun(w: Pick<Wallet, 'client' | 'publicKey'>, g: GunLike, api: BackupApi = httpBackupApi): Promise<BackupResult> {
  if (g.locked) return 'locked';
  if (isBackedUp(w.publicKey, g.address)) return 'ok';
  if (isBackupDeclined(w.publicKey, g.address)) return 'declined';
  try {
    const ciphertext = await sealGunKey(w.client, PrivateKey.fromWif(g.exportWif()));
    await api.put(await signBackupRequest(w, 'put', g.address, ciphertext));
  } catch (e) {
    if (refused(e)) {
      markDeclined(w.publicKey, g.address);
      return 'declined';
    }
    throw e;
  }
  markBackedUp(w.publicKey, g.address);
  return 'backed-up';
}

const inFlight = new Map<string, Promise<BackupResult | 'error'>>();
const retryAt = new Map<string, ReturnType<typeof setTimeout>>();
/** Retry a failed backup this long after the failure, at the next idle moment. */
export const BACKUP_RETRY_MS = 60_000;
const whenIdle = (f: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(f, { timeout: 10_000 });
  else setTimeout(f, 0);
};

/**
 * Fire-and-forget backup after a paid LOCK & LOAD. Never awaited by the play flow; every failure is swallowed (and
 * retried once the page is idle a minute later); one in flight per gun per identity. `canAsk` is checked again before
 * a retry, so it never opens a wallet sheet while a game is holding the wallet. Returns the promise for tests only.
 */
export function scheduleGunBackup(
  w: Pick<Wallet, 'client' | 'publicKey'>,
  g: GunLike,
  opts: { api?: BackupApi; canAsk?: () => boolean; retryMs?: number; onError?: (e: unknown) => void } = {},
): Promise<BackupResult | 'error'> {
  const id = `${w.publicKey}:${g.address}`;
  const running = inFlight.get(id);
  if (running) return running;
  const t = retryAt.get(id);
  if (t) {
    clearTimeout(t);
    retryAt.delete(id);
  }
  const p = backupGun(w, g, opts.api)
    .catch((e: unknown) => {
      opts.onError?.(e);
      const later = setTimeout(() => {
        retryAt.delete(id);
        whenIdle(() => {
          if (opts.canAsk && !opts.canAsk()) return; // the next paid LOCK & LOAD schedules it again
          void scheduleGunBackup(w, g, opts);
        });
      }, opts.retryMs ?? BACKUP_RETRY_MS);
      (later as { unref?: () => void }).unref?.();
      retryAt.set(id, later);
      return 'error' as const;
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

/** Old name (restore, then back up), kept for scripts and tests. The play flow never calls it. */
export type SyncResult = 'restored' | 'backed-up' | 'ok' | 'locked';
export async function syncGunBackup(w: Pick<Wallet, 'client' | 'publicKey'>, g: GunLike, api: BackupApi = httpBackupApi): Promise<SyncResult> {
  const r = await restoreGunIfNeeded(w, g, api);
  if (r !== 'ok') return r;
  const b = await backupGun(w, g, api);
  return b === 'backed-up' ? 'backed-up' : 'ok';
}
