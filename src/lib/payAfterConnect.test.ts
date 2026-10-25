/**
 * LOCK & LOAD with no wallet connected = connect, then pay (useCabinet). The cabinet drops the pay intent the moment
 * the site wallet looks idle (no wallet, no chooser, not busy, not waiting: coinop/payFlow.ts). Discovery used to
 * clear busy/waiting a microtask BEFORE the connect (or the chooser) began, so that idle state was published and
 * the payment was dropped every time. These tests replay every published state and check it never looks idle.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, type WalletInterface } from '@bsv/sdk';
import { connectAttemptOver } from './coinop/payFlow';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
const g = globalThis as Record<string, unknown>;
g.sessionStorage = mem();
g.localStorage = mem();
const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.postMessage = () => undefined;
win.self = win;
win.top = win;
win.location = { host: 'www.tokenblaster.lol', origin: 'https://www.tokenblaster.lol' };
g.window = win;
g.location = win.location;
g.fetch = async () => {
  throw new Error('offline');
};

const KEY = PrivateKey.fromRandom().toPublicKey().toString();
const fake = { getPublicKey: async () => ({ publicKey: KEY }), isAuthenticated: async () => ({ authenticated: true }), getVersion: async () => ({ version: 'bwalletx-5.2.42' }) } as unknown as WalletInterface;
let announcer: (() => void) | null = null;
const installExtension = () => {
  const announce = () => win.dispatchEvent(new CustomEvent('brc100:announceWallet', { detail: { info: { uuid: 'u', name: 'bWalletX', rdns: 'com.bwalletx.extension', kind: 'extension' }, wallet: fake } }));
  win.addEventListener('brc100:requestWallet', announce);
  announcer = () => win.removeEventListener('brc100:requestWallet', announce);
};

type SW = typeof import('./siteWallet');
let openSiteWallet: SW['openSiteWallet'], getSiteWallet: SW['getSiteWallet'], subSiteWallet: SW['subSiteWallet'], _resetSiteWallet: SW['_resetSiteWallet'];
let rememberWallet: typeof import('./discovery')['rememberWallet'];
before(async () => {
  ({ openSiteWallet, getSiteWallet, subSiteWallet, _resetSiteWallet } = await import('./siteWallet'));
  ({ rememberWallet } = await import('./discovery'));
});

const idle = (s: ReturnType<typeof getSiteWallet>) => connectAttemptOver({ hasWallet: Boolean(s.wallet), chooserOpen: Boolean(s.chooser), busy: s.busy, waiting: Boolean(s.waiting) });

beforeEach(() => {
  announcer?.();
  announcer = null;
  _resetSiteWallet();
  (g.sessionStorage as { clear: () => void }).clear();
  (g.localStorage as { clear: () => void }).clear();
});

test('remembered extension: discovery hands straight over to the connect, never an idle moment', async () => {
  installExtension();
  rememberWallet('com.bwalletx.extension');
  const seen: ReturnType<typeof getSiteWallet>[] = [];
  const off = subSiteWallet(() => seen.push(getSiteWallet()));
  const w = await openSiteWallet();
  off();
  assert.equal(w?.publicKey, KEY);
  assert.ok(seen.length > 1);
  assert.deepEqual(seen.filter(idle), [], 'a published state looked like "connect over": the cabinet would drop the payment');
  assert.equal(getSiteWallet().busy, false);
  assert.equal(getSiteWallet().waiting, null);
});

test('first visit, extension installed: the chooser replaces the discovery wait in one update', async () => {
  installExtension();
  const seen: ReturnType<typeof getSiteWallet>[] = [];
  const off = subSiteWallet(() => seen.push(getSiteWallet()));
  assert.equal(await openSiteWallet(), null);
  off();
  assert.deepEqual(seen.filter(idle), []);
  const s = getSiteWallet();
  assert.ok(s.chooser);
  assert.equal(s.busy, false);
  assert.equal(s.waiting, null);
});

test('no wallet installed: the chooser opens (no stuck "Looking for your wallet…")', async () => {
  const w = await openSiteWallet();
  assert.equal(w, null);
  const s = getSiteWallet();
  assert.ok(s.chooser);
  assert.equal(s.busy, false);
  assert.equal(s.waiting, null);
});
