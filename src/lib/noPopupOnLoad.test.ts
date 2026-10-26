/**
 * Nothing asks the wallet on page load (owner, 25 Oct 2026, after #95), the UNLOAD button and the credit-aware
 * main button. Mock wallet only (a ProtoWallet over a throwaway key, wrapped to count calls); no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk';
import { Gun } from './gun';
import { restoreGunIfNeeded } from './gunBackup';
import { mayAskWallet, restoreGate } from './gunRestoreGate';
import { getSiteWallet } from './siteWallet';
import { playButton, showUnload, unloadLabel } from './coinop/playButton';

const store = new Map<string, string>();
const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const g0 = globalThis as unknown as Record<string, unknown>;
Object.assign(g0, { window: g0, localStorage: ls, sessionStorage: ls });


async function countingWallet() {
  const pw = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey } = await pw.getPublicKey({ identityKey: true });
  const calls: string[] = [];
  const client = new Proxy(pw as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return async (...a: unknown[]) => {
        calls.push(prop);
        return (v as (...x: unknown[]) => unknown).apply(target, a);
      };
    },
  }) as unknown as WalletInterface;
  return { w: { client, publicKey, name: 'mock', id: 'mock', address: PrivateKey.fromRandom().toAddress() }, calls };
}

test('mount and silent resume: zero wallet calls and no waiting card, even with a fresh gun that would want a restore', async () => {
  const { w, calls } = await countingWallet();
  const g = new Gun(); // fresh, never backed up: exactly the case restore would ask about
  const run = restoreGate();
  const api = { put: async () => undefined, get: async () => [] };
  assert.equal(await run('mount', w, g, (x, y) => restoreGunIfNeeded(x, y, api)), 'skip');
  assert.equal(await run('resume', w, g, (x, y) => restoreGunIfNeeded(x, y, api)), 'skip');
  assert.equal(calls.length, 0, `wallet calls during mount: ${calls.join(', ')}`);
  assert.equal(getSiteWallet().waiting, null);
  // The player's press is what may ask (one signature for the lookup), once per wallet per gun.
  assert.equal(mayAskWallet('press'), true);
  await run('press', w, g, (x, y) => restoreGunIfNeeded(x, y, api));
  assert.ok(calls.length > 0);
  const n = calls.length;
  assert.equal(await run('press', w, g, (x, y) => restoreGunIfNeeded(x, y, api)), 'skip');
  assert.equal(calls.length, n);
});

test('a failed restore on a press stays invisible (no throw)', async () => {
  const { w } = await countingWallet();
  const run = restoreGate();
  assert.equal(await run('press', w, new Gun(), async () => Promise.reject(new Error('server down'))), 'error');
});

test('useBlaster: no effect runs the restore when the wallet appears (only presses call syncBackup)', () => {
  const s = readFileSync(new URL('../lib/useBlaster.ts', import.meta.url), 'utf8');
  assert.ok(!/useEffect\(\(\) => \{\s*if \(wallet\) void syncBackup/.test(s), 'restore on wallet appear');
  for (const m of s.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)) assert.ok(!/syncBackup|restoreGun|scheduleGunBackup|getPublicKey|isAuthenticated|createSignature/.test(m[1]), `wallet call in an effect: ${m[1].slice(0, 80)}`);
});

test('UNLOAD renders whenever the gun holds credit or tokens, labelled with the amount', () => {
  assert.equal(showUnload(0), false);
  assert.equal(showUnload(0.25), true);
  assert.equal(showUnload(0, 1), true);
  assert.equal(unloadLabel(0.25), 'UNLOAD $0.25 → wallet');
  const gallery = readFileSync(new URL('../components/gallery/ShootingGallery.tsx', import.meta.url), 'utf8');
  assert.ok((gallery.match(/<UnloadButton/g) ?? []).length >= 3, 'cabinet credit readout, attract screen and pause screen');
});

test('the main button label switches with credit', () => {
  assert.deepEqual(playButton(0.5, 0, 0.1), { label: 'PLAY ($0.50 credit)', kind: 'play', sub: 'no payment' });
  assert.equal(playButton(0, 0, 0.1).label, 'LOCK & LOAD $0.10');
  assert.equal(playButton(0, 0, 0.1).kind, 'quick');
  assert.equal(playButton(0.03, 0, 0.1).label, 'LOCK & LOAD $0.10');
  assert.equal(playButton(0.5, 0.2, 0.1).label, 'LOCK & LOAD $0.20');
  assert.equal(playButton(0, 0.2, 0.1).kind, 'pay');
});
