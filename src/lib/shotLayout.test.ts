/**
 * 31 Oct 2026: TERRORNODE rounds were broadcast behind a stuck LOADING screen, and carried the player's paymail in
 * push 2 (the ammo). These tests pin the shot layouts and the fire gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, Utils } from '@bsv/sdk';
import { ammoPush, tagPushes } from './stormCore';
import { DEFAULT_AMMO, GALLERY_GAME, GALLERY_TAGS, galleryPushes } from './gallery';
import { playPushes } from './coinop/credit';
import { runTagMatches } from './scores';
import { dropBacklog, mayBroadcast, type FireState } from './terrornode/fireGate';

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));
const opReturn = (p: string[]) => Script.fromASM(`OP_FALSE OP_RETURN ${p.map(hex).join(' ')}`).toHex();

test('push 2 is "sats" or a ticker, never a paymail', () => {
  assert.equal(ammoPush(''), 'sats');
  assert.equal(ammoPush(undefined), 'sats');
  assert.equal(ammoPush('b0asex@bwalletx.com'), 'sats');
  assert.equal(ammoPush('TERRORNODE'), 'TERRORNODE');
  assert.equal(ammoPush('coinop'), 'coinop');
  assert.equal(DEFAULT_AMMO, 'sats');
});

test('every shooting game: "tokenblaster.lol" <ammo> <n> <game> [paymail]', () => {
  for (const game of ['bsvgun', 'invaders', 'snake', 'rally', 'bracer']) {
    assert.deepEqual(tagPushes('', 7, game, ['b0asex@bwalletx.com']), ['tokenblaster.lol', 'sats', '7', game, 'b0asex@bwalletx.com']);
    assert.deepEqual(tagPushes('BSVGUN', 7, game, []), ['tokenblaster.lol', 'BSVGUN', '7', game]);
  }
  // TERRORNODE: the storm gets game = terrornode and extra = the paymail (galleryPushes(handle).slice(1)).
  const ex = galleryPushes('b0asex@bwalletx.com');
  assert.deepEqual(tagPushes(DEFAULT_AMMO, 14259, GALLERY_GAME, ex.slice(1)), ['tokenblaster.lol', 'sats', '14259', 'terrornode', 'b0asex@bwalletx.com']);
  // The 31 Oct bug: the paymail passed as the ammo too. The push is now "sats" whatever the caller passed.
  assert.deepEqual(tagPushes('b0asex@bwalletx.com', 14259, GALLERY_GAME, ex.slice(1)), ['tokenblaster.lol', 'sats', '14259', 'terrornode', 'b0asex@bwalletx.com']);
  assert.deepEqual(tagPushes('', 1, undefined, undefined), ['tokenblaster.lol', 'sats', '1', 'bsvgun']);
});

test('coin-op: "tokenblaster.lol" "coinop" <n> "coinop" <game> <name>', () => {
  // CoinOpGate: fireBatch(n, [playPushes(game, who)], house, 'coinop') -> [TAG, ammoPush('coinop'), n, ...extra]
  const p = ['tokenblaster.lol', ammoPush('coinop'), '3', ...playPushes('invaders', 'kweg')];
  assert.deepEqual(p, ['tokenblaster.lol', 'coinop', '3', 'coinop', 'invaders', 'kweg']);
});

test('scores: old (paymail in push 2) and new ("sats") TERRORNODE rounds both verify', () => {
  const pm = 'b0asex@bwalletx.com';
  const old = opReturn(['tokenblaster.lol', pm, '14259', 'terrornode', pm]);
  const now = opReturn(tagPushes('', 14259, GALLERY_GAME, [pm]));
  const legacy = opReturn(['tokenblaster.lol', 'sats', '9', 'gallery', pm]);
  for (const s of [old, now, legacy]) assert.ok(runTagMatches(s, GALLERY_TAGS, pm));
  assert.ok(!runTagMatches(now, GALLERY_TAGS, 'someone@else.com'));
  assert.ok(runTagMatches(opReturn(tagPushes('', 2, 'invaders', [])), 'invaders'));
  assert.ok(!runTagMatches(opReturn(tagPushes('', 2, 'snake', [])), 'invaders'));
});

const live: FireState = { mode: 'live', loadout: false, over: false, flat: false, paused: false, fired: 10, sent: 4 };

test('fire gate: paid rounds only while a round is visibly live and fired', () => {
  assert.ok(mayBroadcast(live));
  assert.ok(!mayBroadcast({ ...live, mode: 'warm' }), 'never during the ammo load / warm-up');
  assert.ok(!mayBroadcast({ ...live, mode: 'off' }));
  assert.ok(!mayBroadcast({ ...live, loadout: true }));
  assert.ok(!mayBroadcast({ ...live, over: true }));
  assert.ok(!mayBroadcast({ ...live, flat: true }));
  assert.ok(!mayBroadcast({ ...live, paused: true }));
  assert.ok(!mayBroadcast({ ...live, fired: 4 }), 'nothing queued: nothing sent');
  assert.deepEqual(dropBacklog({ fired: 10, sent: 4 }), { fired: 4, dropped: 6 });
});

test('TERRORNODE wires every paid sender through the gate', () => {
  const src = readFileSync(new URL('../components/gallery/ShootingGallery.tsx', import.meta.url), 'utf8');
  assert.ok(!/const ammo = paymail/.test(src), 'push 2 never takes the paymail');
  // both storms (sats + coin) hold unless the gate says go
  assert.equal(src.match(/\(\) => !canSend\(\)/g)?.length, 2);
  // the burst sender waits on the gate
  assert.match(src, /if \(!canSend\(\)\) \{/);
  // the load stops the last sender and drops its backlog BEFORE the warm-up screen goes up
  const load = src.slice(src.indexOf('const lockAndLoadOnce'));
  const drop = load.indexOf('dropBacklog(');
  const warm = load.indexOf("setMode('warm')");
  assert.ok(drop > 0 && warm > drop && load.slice(0, warm).includes('stop.current = true'));
});
