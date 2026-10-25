/**
 * Recoverable gun: wallet-encrypted backup round trip, the address check, the signed request, corrupt-record handling
 * and the token-rescue message. No network, no real wallet: a ProtoWallet over a throwaway key stands in for the
 * player's BRC-100 wallet, and every key here is random.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, ProtoWallet, Transaction, Utils, type WalletInterface } from '@bsv/sdk';
import { GUN_LOCKED, Gun, GunNeedsSats, bsv21, satsToRescue } from './gun';
import { backupMessage, openGunKey, sealGunKey, signBackupRequest, syncGunBackup, verifyBackupRequest, type BackupApi, type BackupRequest, type GunBackup } from './gunBackup';

async function mockWallet() {
  const pw = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey } = await pw.getPublicKey({ identityKey: true });
  return { client: pw as unknown as WalletInterface, publicKey };
}

/** In-memory browser storage, so the gun reads and writes `tokenblaster.gun` as it does in a tab. */
function withStorage<T>(fn: (store: Map<string, string>) => Promise<T>): Promise<T> {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const g0 = globalThis as unknown as Record<string, unknown>;
  const had = { window: g0.window, localStorage: g0.localStorage, sessionStorage: g0.sessionStorage };
  Object.assign(g0, { window: g0, localStorage: ls, sessionStorage: ls });
  return fn(store).finally(() => Object.assign(g0, had));
}

/** A backup server in memory, checking signatures exactly as the route does. */
function memApi() {
  const rows = new Map<string, GunBackup[]>();
  const seen: BackupRequest[] = [];
  const api: BackupApi = {
    async put(r) {
      seen.push(r);
      assert.ok(await verifyBackupRequest(r));
      const l = rows.get(r.identityKey) ?? [];
      if (!l.some((b) => b.address === r.address)) l.unshift({ address: r.address!, ciphertext: r.ciphertext! });
      rows.set(r.identityKey, l);
    },
    async get(r) {
      seen.push(r);
      assert.ok(await verifyBackupRequest(r));
      return rows.get(r.identityKey) ?? [];
    },
  };
  return { api, rows, seen };
}

/** Capture everything written to the console during `fn`. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  const saved = ['log', 'info', 'warn', 'error', 'debug'].map((k) => [k, c[k]] as const);
  for (const [k] of saved) c[k] = (...a: unknown[]) => void out.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    for (const [k, f] of saved) c[k] = f;
  }
  return out.join('\n');
}

test('round trip: the wallet encrypts the gun key and only the same wallet decrypts it, to the same address', async () => {
  const w = await mockWallet();
  const key = PrivateKey.fromRandom();
  const ciphertext = await sealGunKey(w.client, key);
  assert.ok(!ciphertext.includes(Utils.toHex(Utils.toArray(key.toWif(), 'utf8'))));
  const back = await openGunKey(w.client, { address: key.toAddress(), ciphertext });
  assert.equal(back.toWif(), key.toWif());
  const other = await mockWallet();
  await assert.rejects(() => openGunKey(other.client, { address: key.toAddress(), ciphertext }));
});

test('the address check: a backup whose key is not its stored address is refused', async () => {
  const w = await mockWallet();
  const ciphertext = await sealGunKey(w.client, PrivateKey.fromRandom());
  await assert.rejects(() => openGunKey(w.client, { address: PrivateKey.fromRandom().toAddress(), ciphertext }), /does not match/);
});

test('backup requests must be signed by the identity key, recent, and for exactly that ciphertext', async () => {
  const w = await mockWallet();
  const key = PrivateKey.fromRandom();
  const ciphertext = await sealGunKey(w.client, key);
  const r = await signBackupRequest(w, 'put', key.toAddress(), ciphertext);
  assert.equal(await verifyBackupRequest(r), true);
  assert.equal(await verifyBackupRequest({ ...r, ciphertext: ciphertext.replace(/^../, '00') }), false);
  assert.equal(await verifyBackupRequest({ ...r, address: PrivateKey.fromRandom().toAddress() }), false);
  assert.equal(await verifyBackupRequest({ ...r, identityKey: (await mockWallet()).publicKey }), false);
  assert.equal(await verifyBackupRequest(r, Number(r.ts) + 10 * 60_000), false);
  assert.ok(backupMessage('get', w.publicKey, '1').startsWith('TokenBlaster gun backup get'));
});

test('a new gun is backed up on connect, and restored from the wallet in a browser that lost it', async () => {
  const w = await mockWallet();
  const { api, rows } = memApi();
  let first = '';
  await withStorage(async () => {
    const g = new Gun();
    first = g.address;
    assert.equal(await syncGunBackup(w, g, api), 'backed-up');
    assert.equal(await syncGunBackup(w, g, api), 'ok'); // once per gun per wallet
  });
  assert.equal(rows.get(w.publicKey)?.[0].address, first);
  // Site data cleared / a new device: a fresh, empty gun takes the backed-up key.
  await withStorage(async () => {
    const g = new Gun();
    assert.notEqual(g.address, first);
    (g as unknown as { balance: () => Promise<number> }).balance = async () => 0;
    (g as unknown as { tokensHeld: () => Promise<unknown[]> }).tokensHeld = async () => [];
    assert.equal(await syncGunBackup(w, g, api), 'restored');
    assert.equal(g.address, first);
    assert.equal(new Gun().address, first); // saved: a reload keeps it
  });
});

test('a fresh gun that already holds coins is never replaced by a backup', async () => {
  const w = await mockWallet();
  const { api } = memApi();
  await withStorage(async () => void (await syncGunBackup(w, new Gun(), api)));
  await withStorage(async () => {
    const g = new Gun();
    const mine = g.address;
    (g as unknown as { balance: () => Promise<number> }).balance = async () => 5_000;
    (g as unknown as { tokensHeld: () => Promise<unknown[]> }).tokensHeld = async () => [];
    assert.equal(await syncGunBackup(w, g, api), 'backed-up'); // its own key is backed up instead
    assert.equal(g.address, mine);
  });
});

test('a corrupt gun record locks the gun (no new key over it), keeps the record, and restores from the wallet', async () => {
  const w = await mockWallet();
  const { api, rows } = memApi();
  const owner = PrivateKey.fromRandom();
  rows.set(w.publicKey, [{ address: owner.toAddress(), ciphertext: await sealGunKey(w.client, owner) }]);
  await withStorage(async (store) => {
    store.set('tokenblaster.gun', '{"wif":"not-a-key"'); // truncated / corrupt
    const g = new Gun();
    assert.equal(g.locked, true);
    assert.equal(store.get('tokenblaster.gun'), '{"wif":"not-a-key"'); // untouched
    await assert.rejects(() => g.unload('1BitcoinEaterAddressDontSendf59kuE'), new RegExp(GUN_LOCKED));
    await assert.rejects(() => g.fire('x', 1), new RegExp(GUN_LOCKED));
    assert.throws(() => g.exportWif(), new RegExp(GUN_LOCKED));
    assert.equal(await syncGunBackup(w, g, api), 'restored');
    assert.equal(g.locked, false);
    assert.equal(g.address, owner.toAddress());
    const kept = [...store.entries()].find(([k]) => k.startsWith('tokenblaster.gun.locked-'));
    assert.equal(kept?.[1], '{"wif":"not-a-key"'); // the old record is kept, not lost
  });
});

test('a corrupt record with no matching backup stays locked and untouched', async () => {
  const w = await mockWallet();
  const { api, rows } = memApi();
  const elsewhere = await mockWallet(); // a backup made by a different wallet: can't decrypt
  const k = PrivateKey.fromRandom();
  rows.set(w.publicKey, [{ address: k.toAddress(), ciphertext: await sealGunKey(elsewhere.client, k) }]);
  await withStorage(async (store) => {
    store.set('tokenblaster.gun', 'garbage');
    const g = new Gun();
    assert.equal(await syncGunBackup(w, g, api), 'locked');
    assert.equal(g.locked, true);
    assert.equal(store.get('tokenblaster.gun'), 'garbage');
  });
});

test('UNLOAD with tokens but no sats says exactly how many sats to load', async () => {
  assert.ok(satsToRescue(1, 0) > 0);
  assert.equal(satsToRescue(1, 10_000), 0);
  await withStorage(async () => {
    const g = new Gun();
    const id = 'a'.repeat(64) + '_0';
    const src = new Transaction();
    src.addOutput({ lockingScript: bsv21(id, BigInt(500), g.address), satoshis: 1 });
    g.adoptTokenCoin(id, src, 0, BigInt(500));
    (g as unknown as { tokenUtxos: () => Promise<unknown[]> }).tokenUtxos = async () => [];
    const e = await g.unloadTokens(id, PrivateKey.fromRandom().toAddress()).catch((x) => x);
    assert.ok(e instanceof GunNeedsSats);
    assert.equal(e.sats, satsToRescue(1, 0));
    assert.match(e.message, new RegExp(`Load at least ${e.sats}`));
  });
});

test('no gun key or WIF reaches any log, and the server only ever gets ciphertext', async () => {
  const w = await mockWallet();
  const { api, seen } = memApi();
  const wifs: string[] = [];
  const logs = await captureLogs(async () => {
    await withStorage(async (store) => {
      const g = new Gun();
      wifs.push(g.exportWif());
      await syncGunBackup(w, g, api);
      store.set('tokenblaster.gun', 'garbage');
      const locked = new Gun();
      await syncGunBackup(w, locked, api);
      wifs.push(locked.exportWif());
    });
  });
  for (const wif of wifs) {
    assert.ok(!logs.includes(wif));
    assert.ok(!JSON.stringify(seen).includes(wif));
    assert.ok(!JSON.stringify(seen).includes(Utils.toHex(Utils.toArray(wif, 'utf8'))));
  }
});
