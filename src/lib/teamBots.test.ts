/**
 * TERRORNODE team mode AI NPG girls (teammode/bots.ts): seat fill and leave, a human taking a bot's seat, bots never
 * on the Erobotz side, never host, and the no-earn rule (no tx, no score, no identity key).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmTx, createMatch, join, leave, pickSide, publicState, shoot, start, tick, type Match } from './teammode/match';
import { BOT_GIRLS, BOT_TEAM_SIZE, botsOf, fillBots, girlOf, stepBots, withSeatFor } from './teammode/bots';

let n = 0;
const human = (m: Match, side: 'npg' | 'erobotz' | null = null, now = 1000) =>
  withSeatFor(m, BOT_TEAM_SIZE, now, () => join(m, { name: `p${++n}`, identityKey: `key${n}`, side, now, id: `h${n}`, resumeToken: `r${n}` }));

test('one human: four AI girls fill the NPG seats, with girl names', () => {
  const m = createMatch({ code: 'ABCDE', mode: 'coop', now: 0, rand: () => 0.5 });
  const r = human(m);
  assert.ok(r.ok);
  const bots = botsOf(m);
  assert.equal(bots.length, BOT_TEAM_SIZE - 1);
  assert.equal(m.players.size, BOT_TEAM_SIZE);
  for (const b of bots) {
    assert.equal(b.team, 'npg');
    assert.equal(b.host, false);
    assert.ok(girlOf(b.name), `${b.name} is one of the Tripo girls`);
  }
  assert.equal(new Set(bots.map((b) => b.name)).size, bots.length, 'four different girls');
  const pub = publicState(m, 0);
  assert.equal(pub.players.filter((p) => p.bot).length, 4);
  for (const p of pub.players.filter((q) => q.bot)) assert.equal(p.identityKey, null);
  assert.ok(pub.players.find((p) => !p.bot)?.host);
});

test('a joining human takes a bot seat; bots return when she leaves; nobody left = no bots', () => {
  const m = createMatch({ code: 'ABCDF', mode: 'coop', now: 0 });
  const a = human(m);
  const keep = botsOf(m).slice(0, 3).map((b) => b.id);
  const b = human(m);
  assert.ok(a.ok && b.ok);
  assert.equal(botsOf(m).length, BOT_TEAM_SIZE - 2);
  assert.deepEqual(botsOf(m).map((x) => x.id), keep, 'the same bots stay, the newest left');
  assert.equal(m.players.size, BOT_TEAM_SIZE);
  // lobby leave removes the human; the seat is refilled
  leave(m, b.ok ? b.player.id : '', 2000);
  fillBots(m, BOT_TEAM_SIZE, 2000);
  assert.equal(botsOf(m).length, BOT_TEAM_SIZE - 1);
  leave(m, a.ok ? a.player.id : '', 3000);
  fillBots(m, BOT_TEAM_SIZE, 3000);
  assert.equal(m.players.size, 0, 'no humans: no bots, the match can idle out');
  // five humans: no bots at all
  for (let i = 0; i < 5; i++) human(m);
  assert.equal(botsOf(m).length, 0);
});

test('size 0 turns bots off', () => {
  const m = createMatch({ code: 'ABCDG', mode: 'coop', now: 0 });
  withSeatFor(m, 0, 0, () => join(m, { name: 'solo', now: 0, id: 'x', resumeToken: 't' }));
  assert.equal(botsOf(m).length, 0);
});

test('PvP: bots only take NPG seats; humans balance among humans and can switch onto NPG', () => {
  const m = createMatch({ code: 'ABCDH', mode: 'pvp', now: 0 });
  const a = human(m, 'npg');
  const b = human(m, 'erobotz');
  assert.ok(a.ok && b.ok);
  assert.equal(b.ok && b.player.team, 'erobotz', 'a human is not pushed off by bots');
  assert.ok(botsOf(m).every((x) => x.team === 'npg'));
  assert.equal(botsOf(m).length, BOT_TEAM_SIZE - 1);
  // balance is decided on humans: 1 v 1, so the erobotz human may not stack NPG 2 v 0 (bots do not count)
  const r = withSeatFor(m, BOT_TEAM_SIZE, 0, () => pickSide(m, b.ok ? b.player.id : '', 'npg'));
  assert.equal(r.ok, false);
  assert.equal(botsOf(m).length, BOT_TEAM_SIZE - 1, 'a refused switch leaves the bots as they were');
  // a third human (ties go to NPG) takes a bot seat
  const c = human(m);
  assert.ok(c.ok && c.player.team === 'npg');
  assert.equal(botsOf(m).length, BOT_TEAM_SIZE - 2);
});

test('no-earn: bot shots carry no tx, bot kills add no score, confirmTx ignores bots', () => {
  const m = createMatch({ code: 'ABCDJ', mode: 'pvp', now: 0, rand: () => 0.5 });
  const a = human(m, 'erobotz');
  assert.ok(a.ok);
  const host = a.ok ? a.player : null!;
  assert.ok(start(m, host.id, 0).ok);
  const bot = botsOf(m)[0];
  // stand the erobotz human right in front of the bot, then fire with a real-looking txid
  [host.x, host.z] = [bot.x, bot.z - 3];
  const txid = 'a'.repeat(64);
  for (let t = 1; t < 40 && host.alive; t++) shoot(m, bot.id, 0, txid, t * 200);
  assert.ok(bot.shots > 0);
  assert.equal(bot.txShots, 0, 'never counted as a transaction');
  assert.ok(bot.kills >= 1, 'the bot did kill');
  assert.equal(bot.score, 0, 'but earns nothing');
  assert.equal(m.frags.npg, bot.kills, 'the side still gets the frag');
  confirmTx(m, bot.id, 50);
  assert.equal(bot.txShots, 0);
  assert.equal(m.txLog.length, 0, 'room tx/s untouched');
});

test('stepBots: bots follow the human and shoot the nearest Erobot in range (free shots)', () => {
  const m = createMatch({ code: 'ABCDK', mode: 'coop', now: 0, rand: () => 0.5 });
  const a = human(m);
  assert.ok(a.ok);
  const h = a.ok ? a.player : null!;
  assert.ok(start(m, h.id, 0).ok);
  m.enemies = [{ id: 1, x: h.x, z: h.z - 10, yaw: 0, hp: 1e9, kind: 0 }];
  m.waveLeft = 0;
  const before = botsOf(m).map((b) => [b.x, b.z]);
  let now = 0;
  for (let i = 0; i < 40; i++) {
    now += 50;
    stepBots(m, now);
    tick(m, now);
  }
  const bots = botsOf(m);
  assert.ok(bots.some((b, i) => Math.hypot(b.x - before[i][0], b.z - before[i][1]) > 0.1 || b.shots > 0));
  assert.ok(bots.reduce((s, b) => s + b.shots, 0) > 0, 'they fire');
  assert.equal(bots.reduce((s, b) => s + b.txShots, 0), 0);
  assert.equal(BOT_GIRLS.length, 5);
});
