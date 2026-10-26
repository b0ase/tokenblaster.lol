/**
 * One-prompt play (#45, owner 25 Oct 2026): LOCK & LOAD is exactly ONE wallet request, the payment. The gun backup
 * runs after the payment, in the background, once per gun per identity; a refusal is remembered. Restore never runs
 * over a readable local gun. Every game names itself in the wallet's payment description.
 * Mock wallet only (a ProtoWallet over a throwaway key, wrapped to count calls); no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, ProtoWallet, Transaction, type WalletInterface } from '@bsv/sdk';
import { Gun } from './gun';
import { backupGun, restoreGunIfNeeded, scheduleGunBackup, verifyBackupRequest, type BackupApi, type GunBackup } from './gunBackup';
import { payIntoGun } from './lockLoadPay';
import { payLabel } from './coinop/credit';
import type { Wallet } from './wallet';

const store = new Map<string, string>();
const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const g0 = globalThis as unknown as Record<string, unknown>;
Object.assign(g0, { window: g0, localStorage: ls, sessionStorage: ls });

type Call = { m: string; at: number };
async function countingWallet(opts: { refuse?: string[] } = {}) {
  const pw = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey } = await pw.getPublicKey({ identityKey: true });
  const calls: Call[] = [];
  let t = 0;
  const client = new Proxy(pw as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return async (...a: unknown[]) => {
        calls.push({ m: prop, at: t++ });
        if (opts.refuse?.includes(prop)) throw new Error('User denied the request');
        return (v as (...x: unknown[]) => unknown).apply(target, a);
      };
    },
  }) as unknown as WalletInterface;
  const w = { client, publicKey, name: 'mock', address: PrivateKey.fromRandom().toAddress() } as unknown as Wallet;
  return { w, calls };
}

/** fund() stand-in that counts as the wallet's createAction (the real fund() makes exactly one createAction). */
const mockFund = (calls: Call[]) => async (_w: Wallet, address: string, sats: number) => {
  calls.push({ m: 'createAction', at: calls.length });
  const src = new Transaction();
  src.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: sats });
  return src;
};

function memApi() {
  const rows = new Map<string, GunBackup[]>();
  let puts = 0;
  const api: BackupApi = {
    async put(r) {
      puts++;
      assert.ok(await verifyBackupRequest(r));
      rows.set(r.identityKey, [{ address: r.address!, ciphertext: r.ciphertext! }]);
    },
    async get() {
      return [];
    },
  };
  return { api, rows, puts: () => puts };
}

test('LOCK & LOAD makes exactly ONE wallet request (the payment); the backup runs after it, in the background', async () => {
  store.clear();
  const { w, calls } = await countingWallet();
  const g = new Gun();
  const { api, puts } = memApi();
  let backup: Promise<unknown> | null = null;
  // The connect-time restore over a readable gun: no wallet call.
  g.load = (async () => undefined) as typeof g.load;
  void g.address;
  const paid = payIntoGun(w, g, 1000, payLabel('TerrorNode', 0.1), {
    fund: mockFund(calls),
    afterPaid: () => void (backup = scheduleGunBackup(w, g, { api })),
  });
  await paid;
  const atPay = calls.filter((c) => c.m === 'createAction').length;
  const beforePay = calls.findIndex((c) => c.m === 'createAction');
  assert.equal(atPay, 1, 'one payment request');
  assert.equal(beforePay, 0, 'nothing asked of the wallet before the payment');
  assert.ok(backup, 'the backup was handed off after the payment');
  await backup;
  assert.equal(puts(), 1);
  assert.ok(calls.findIndex((c) => c.m === 'encrypt') > beforePay, 'encrypt only after the payment');
  // A second LOCK & LOAD: one more payment, and no backup sheets again (once per gun per identity).
  const n = calls.length;
  await payIntoGun(w, g, 1000, 'x', { fund: mockFund(calls), afterPaid: () => void (backup = scheduleGunBackup(w, g, { api })) });
  await backup;
  assert.deepEqual(calls.slice(n).map((c) => c.m), ['createAction']);
  assert.equal(puts(), 1);
});

test('restore on connect asks the wallet nothing when a readable local gun exists', async () => {
  store.clear();
  const { w, calls } = await countingWallet();
  const g = new Gun();
  assert.equal(await backupGun(w, g, memApi().api), 'backed-up'); // this browser backed it up once
  const n = calls.length;
  assert.equal(await restoreGunIfNeeded(w, new Gun(), memApi().api), 'ok');
  assert.equal(calls.length, n, 'no wallet call on connect');
});

test('a refused backup is remembered: never asked again', async () => {
  store.clear();
  const { w, calls } = await countingWallet({ refuse: ['encrypt'] });
  const g = new Gun();
  assert.equal(await backupGun(w, g, memApi().api), 'declined');
  const n = calls.length;
  assert.equal(await backupGun(w, g, memApi().api), 'declined');
  assert.equal(calls.length, n);
});

test('a failing backup is swallowed (the payment flow never sees it)', async () => {
  store.clear();
  const { w } = await countingWallet();
  const g = new Gun();
  const api: BackupApi = { put: async () => Promise.reject(new Error('server down')), get: async () => [] };
  assert.equal(await scheduleGunBackup(w, g, { api, retryMs: 10_000_000 }), 'error');
});

test('every game sends its own name in the payment description', () => {
  assert.equal(payLabel('TerrorNode', 0.1), 'TerrorNode: 0.10 USD credit');
  assert.equal(payLabel('Shooting Gallery', 0.25), 'Shooting Gallery: 0.25 USD credit');
  assert.ok(!payLabel('TerrorNode', 0.1).includes('Shooting Gallery'));
});

import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the play flow: nothing asks the wallet before the payment, and the backup is never awaited', () => {
  const s = src('lib/useBlaster.ts');
  const body = s.slice(s.indexOf('const loadOnce'), s.indexOf('payIntoGun(wallet'));
  assert.ok(body.length > 100);
  for (const bad of ['syncBackup', 'restoreGun', 'scheduleGunBackup', 'backupGun', 'encrypt', 'createSignature', 'getPublicKey']) assert.ok(!body.includes(bad), `${bad} before the payment`);
  assert.ok(!/await\s+(syncBackup|backupLater|scheduleGunBackup)/.test(s));
  const gunApp = src('components/GunApp.tsx');
  assert.ok(!/await\s+(syncGunBackup|scheduleGunBackup|backupGun)/.test(gunApp));
});

test('TerrorNode names itself: wallet description and round tag', async () => {
  assert.match(src('components/gallery/ShootingGallery.tsx'), /useCabinet\(b, 'TerrorNode'/);
  const { GALLERY_GAME, GALLERY_TAGS } = await import('./gallery');
  assert.equal(GALLERY_GAME, 'terrornode');
  assert.ok(GALLERY_TAGS.includes('gallery'), 'rounds fired before the rename still count on the board');
});

test('nothing goes fullscreen by itself: only the player-tapped button', () => {
  const shell = src('components/GameShell.tsx');
  assert.ok(!shell.includes('START_RE') && !shell.includes("addEventListener('click'"));
  const hook = src('lib/useGameFullscreen.ts');
  const enter = hook.slice(hook.indexOf('const enter = useCallback'), hook.indexOf('const enterNow'));
  assert.ok(!enter.includes('requestFullscreen') && !enter.includes('shellRef.current.enter'));
});

test('the backup never asks the wallet while a game holds it: it waits, then runs once play is over', async () => {
  store.clear();
  const { w, calls } = await countingWallet();
  const g = new Gun();
  const { api, puts } = memApi();
  let playing = true;
  assert.equal(await scheduleGunBackup(w, g, { api, delayMs: 5, retryMs: 5, canAsk: () => !playing }), 'deferred');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.filter((c) => c.m === 'encrypt').length, 0, 'no wallet call during play');
  playing = false;
  for (let i = 0; i < 100 && !puts(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(puts(), 1);
});
