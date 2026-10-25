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

export type SyncResult = 'restored' | 'backed-up' | 'ok' | 'locked';

/**
 * On connect (and before every load): restore the gun from the wallet backup when this browser has none (fresh and
 * empty) or can't read it (locked), checking the key against its stored address; then back up the gun in use, once.
 * Never replaces a gun that holds coins. 'locked' = the stored gun is unreadable and no backup could restore it.
 */
export async function syncGunBackup(w: Pick<Wallet, 'client' | 'publicKey'>, g: GunLike, api: BackupApi = httpBackupApi): Promise<SyncResult> {
  if (g.locked || (g.fresh && !isBackedUp(w.publicKey, g.address))) {
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
    if (g.locked) return 'locked';
  }
  if (isBackedUp(w.publicKey, g.address)) return 'ok';
  const ciphertext = await sealGunKey(w.client, PrivateKey.fromWif(g.exportWif()));
  await api.put(await signBackupRequest(w, 'put', g.address, ciphertext));
  markBackedUp(w.publicKey, g.address);
  return 'backed-up';
}
