/**
 * Gun key safety and credit visibility (owner, 31 Oct 2026: "it stole my money"). No network, no wallet: in-memory
 * storage stands in for the browser and every key is random.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk';
import { Gun } from './gun';
import { GUN_KEYS, GUN_STORE, archiveKey, archivedKeys, chainSats, gunAddresses, keyPersisted, peekCredit, storedGunAddress } from './gunKeys';
import { restoreGunIfNeeded, sealGunKey, verifyBackupRequest, type BackupApi, type GunBackup } from './gunBackup';
import { CREDIT_UNKNOWN_LINE, missingCreditLine, safeCreditLine } from './coinop/creditSafe';

function withStorage<T>(fn: (store: Map<string, string>) => Promise<T> | T, opts: { blocked?: boolean } = {}): Promise<T> {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.blocked) throw new Error('QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  };
  const g0 = globalThis as unknown as Record<string, unknown>;
  const had = { window: g0.window, localStorage: g0.localStorage, sessionStorage: g0.sessionStorage };
  Object.assign(g0, { window: g0, localStorage: ls, sessionStorage: ls });
  return Promise.resolve()
    .then(() => fn(store))
    .finally(() => Object.assign(g0, had));
}

async function mockWallet() {
  const pw = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey } = await pw.getPublicKey({ identityKey: true });
  return { client: pw as unknown as WalletInterface, publicKey };
}
function memApi(rows: GunBackup[]): BackupApi {
  return {
    async put() {},
    async get(r) {
      assert.ok(await verifyBackupRequest(r));
      return rows;
    },
  };
}
const res = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });

test('a new gun key is stored and listed BEFORE anything can pay it, and a reload gets the same key back', () =>
  withStorage((store) => {
    const g = new Gun();
    assert.equal(g.fresh, true);
    assert.equal(g.persisted, true); // the load may pay it
    assert.ok(store.get(GUN_STORE)?.includes(g.exportWif()));
    assert.deepEqual(archivedKeys().map((k) => k.address), [g.address]);
    const again = new Gun(); // the reload
    assert.equal(again.address, g.address);
    assert.equal(again.fresh, false);
    assert.equal(archivedKeys().length, 1);
    assert.equal(storedGunAddress(), g.address);
  }));

test('storage blocked (private window): the key is not persisted, so the load refuses to pay into it', () =>
  withStorage(
    () => {
      const g = new Gun();
      assert.equal(g.persisted, false);
      assert.equal(archiveKey(PrivateKey.fromRandom()), false);
    },
    { blocked: true },
  ));

test('the key list is append-only and keeps an unreadable list aside instead of overwriting it', () =>
  withStorage((store) => {
    store.set(GUN_KEYS, '[{"wif":'); // truncated
    const k = PrivateKey.fromRandom();
    assert.equal(archiveKey(k, localStorage, 42), true);
    assert.equal(store.get(`${GUN_KEYS}.unreadable-42`), '[{"wif":');
    archiveKey(k, localStorage);
    archiveKey(PrivateKey.fromRandom(), localStorage);
    assert.equal(archivedKeys().length, 2);
    assert.equal(keyPersisted(k.toWif()), false); // listed, but not the current gun
  }));

test('a wallet restore that replaces a fresh gun keeps the replaced key in the list (never orphaned)', async () => {
  const w = await mockWallet();
  const owner = PrivateKey.fromRandom();
  const rows = [{ address: owner.toAddress(), ciphertext: await sealGunKey(w.client, owner) }];
  await withStorage(async () => {
    const g = new Gun();
    const fresh = g.address;
    (g as unknown as { balance: () => Promise<number> }).balance = async () => 0;
    (g as unknown as { tokensHeld: () => Promise<unknown[]> }).tokensHeld = async () => [];
    assert.equal(await restoreGunIfNeeded(w, g, memApi(rows)), 'restored');
    assert.equal(g.address, owner.toAddress());
    assert.deepEqual(new Set(gunAddresses()), new Set([owner.toAddress(), fresh]));
    assert.equal(gunAddresses()[0], owner.toAddress()); // the current gun first
  });
});

test('an unreadable chain is not "empty": a fresh gun is never replaced when its balance cannot be read', async () => {
  const w = await mockWallet();
  const owner = PrivateKey.fromRandom();
  const rows = [{ address: owner.toAddress(), ciphertext: await sealGunKey(w.client, owner) }];
  await withStorage(async () => {
    const g = new Gun();
    const mine = g.address;
    // The real balance(), strict: the chain read fails (no /api/coins in node) and must throw, not count as 0.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => res([], { 'x-coins-upstream': 'failed' })) as typeof fetch;
    try {
      await assert.rejects(() => g.balance('test', true));
      (g as unknown as { tokensHeld: () => Promise<unknown[]> }).tokensHeld = async () => [];
      assert.equal(await restoreGunIfNeeded(w, g, memApi(rows)), 'missing');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(g.address, mine);
  });
});

test('a restore that finds the wallet\'s earlier credit but cannot bring it here says "missing", not nothing', async () => {
  const w = await mockWallet();
  const other = await mockWallet(); // a backup this wallet can't open: nothing restored
  const k = PrivateKey.fromRandom();
  const rows = [{ address: k.toAddress(), ciphertext: await sealGunKey(other.client, k) }];
  await withStorage(async () => {
    const g = new Gun();
    assert.equal(await restoreGunIfNeeded(w, g, memApi(rows)), 'missing');
    assert.equal(await restoreGunIfNeeded(w, new Gun(), memApi([])), 'ok'); // no backups: nothing to report
  });
});

test('the credit is read from the public chain with no wallet; a failed read is unknown (null), never 0', async () =>
  withStorage(async () => {
    const g = new Gun();
    let asked = '';
    const ok = (async (u: string) => ((asked = u), res([{ txid: 'a', vout: 0, sats: 1500 }, { txid: 'b', vout: 1, sats: 500 }]))) as unknown as typeof fetch;
    assert.deepEqual(await peekCredit(localStorage, ok), { address: g.address, sats: 2000 });
    assert.ok(asked.includes(g.address) && asked.includes('amounts=1'));
    const failed = (async () => res([], { 'x-coins-upstream': 'failed' })) as unknown as typeof fetch;
    assert.equal(await chainSats(g.address, failed), null);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    assert.equal(await chainSats(g.address, down), null);
  }));

test('no stored gun: the peek makes no key and reads nothing', () =>
  withStorage(async (store) => {
    assert.deepEqual(await peekCredit(localStorage, (async () => assert.fail('no fetch')) as unknown as typeof fetch), { address: null, sats: null });
    assert.equal(store.size, 0);
  }));

test('dead-end copy: credit is "safe" with PLAY / UNLOAD, never "nothing was charged"', () => {
  assert.equal(safeCreditLine(1.234), 'Your $1.23 is safe in your game credit. PLAY or UNLOAD it back to your wallet.');
  assert.match(safeCreditLine(null), /not lost/);
  for (const l of [safeCreditLine(1), safeCreditLine(null), safeCreditLine(0), CREDIT_UNKNOWN_LINE]) assert.doesNotMatch(l, /nothing was charged/i);
  assert.match(missingCreditLine('missing'), /^Credit not found on this device/);
});
