import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PER_SIDE, RULES, createMatch, join, leave, makeCode, move, pickSide, publicState, setStream, shoot, start, tick, validCode, dirOf, type Match } from './teammode/match';

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = (mode: 'coop' | 'pvp', now = 0) => createMatch({ code: 'ABCDE', mode, tournamentId: 'cup-31oct', now, rand });
let n = 0;
const add = (m: Match, side?: 'npg' | 'erobotz', now = 0) => {
  const r = join(m, { name: `p${++n}`, side, now, id: `id${n}`, resumeToken: `r${n}` });
  assert.ok(r.ok, !r.ok ? r.error : '');
  return r.player;
};
/** Point the shooter at a target. */
const aim = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

test('codes are 5 unambiguous chars', () => {
  for (let i = 0; i < 50; i++) assert.ok(validCode(makeCode(rand)));
  assert.equal(validCode('ABC0O'), false);
});

test('pvp balances 8 v 8 and refuses the 17th', () => {
  const m = mk('pvp');
  for (let i = 0; i < 16; i++) add(m, 'npg');
  const s = publicState(m, 0);
  assert.equal(s.teams[0].size, MAX_PER_SIDE);
  assert.equal(s.teams[1].size, MAX_PER_SIDE);
  const r = join(m, { name: 'x', now: 0, id: 'x', resumeToken: 'x' });
  assert.equal(r.ok, false);
});

test('side switch keeps teams balanced', () => {
  const m = mk('pvp');
  const a = add(m, 'npg');
  const b = add(m, 'erobotz');
  assert.equal(a.team, 'npg');
  assert.equal(b.team, 'erobotz');
  assert.equal(pickSide(m, a.id, 'erobotz').ok, false); // would make 0 v 2
  add(m, 'npg');
  assert.equal(pickSide(m, a.id, 'erobotz').ok, true); // 1 v 2 is fine
});

test('coop takes 16 on one squad', () => {
  const m = mk('coop');
  for (let i = 0; i < 16; i++) assert.equal(add(m).team, 'npg');
  assert.equal(join(m, { name: 'x', now: 0, id: 'y', resumeToken: 'y' }).ok, false);
});

test('pvp: hits, friendly fire off, frags, kill score', () => {
  const m = mk('pvp');
  const a = add(m, 'npg');
  const foe = add(m, 'erobotz');
  const mate = add(m, 'npg');
  assert.equal(mate.team, 'npg');
  assert.equal(start(m, a.id, 0).ok, true);
  [a.x, a.z, mate.x, mate.z, foe.x, foe.z] = [0, 0, 0, -5, 0, -10];
  // the teammate is in the line of fire: friendly fire is off, the ray passes through to the foe
  let t = 1000;
  for (let i = 0; i < 5; i++, t += 100) assert.equal(shoot(m, a.id, aim(a, foe), null, t).hit?.id, foe.id);
  assert.equal(mate.hp, RULES.hp);
  assert.equal(foe.alive, false);
  assert.equal(m.frags.npg, 1);
  assert.equal(a.kills, 1);
  assert.equal(foe.deaths, 1);
  // respawn after the timer
  tick(m, t + RULES.respawnMs + 10);
  assert.equal(foe.alive, true);
});

test('shots are rate limited and tx shots counted', () => {
  const m = mk('coop');
  const a = add(m);
  start(m, a.id, 0);
  assert.equal(shoot(m, a.id, 0, 'f'.repeat(64), 1000).ok, true);
  assert.equal(shoot(m, a.id, 0, null, 1010).ok, false);
  assert.equal(a.txShots, 1);
});

test('moves are clamped to max speed and the arena', () => {
  const m = mk('coop');
  const a = add(m);
  start(m, a.id, 0);
  const [x0, z0] = [a.x, a.z];
  move(m, a.id, x0 + 100, z0, 0, 100);
  assert.ok(a.x - x0 <= RULES.speed * 0.1 + 0.26);
  for (let t = 200; t < 20000; t += 100) move(m, a.id, a.x - 5, a.z, 0, t);
  assert.ok(a.x >= -22);
});

test('coop: waves spawn, the horde advances, kills score for the squad', () => {
  const m = mk('coop');
  const a = add(m);
  start(m, a.id, 0);
  assert.equal(m.wave, 1);
  for (let i = 1; i <= 20; i++) tick(m, i * 50);
  assert.ok(m.enemies.length > 0);
  const e = m.enemies[0];
  const z0 = e.z;
  for (let i = 21; i <= 40; i++) tick(m, i * 50);
  assert.ok(e.z > z0, 'erobots walk toward the squad');
  [a.x, a.z] = [e.x, e.z + 5];
  let t = 5000;
  while (m.enemies.includes(e)) {
    shoot(m, a.id, aim(a, e), null, (t += 100));
    if (t > 20000) break;
  }
  assert.equal(m.enemies.includes(e), false);
  assert.ok(m.frags.npg >= 1);
  assert.ok(a.score >= RULES.killScore);
});

test('reconnect keeps the slot within the grace window', () => {
  const m = mk('pvp');
  const a = add(m, 'npg');
  add(m, 'erobotz');
  start(m, a.id, 0);
  a.kills = 3;
  leave(m, a.id, 1000);
  assert.equal(a.connected, false);
  tick(m, 1000 + RULES.graceMs - 1);
  const r = join(m, { name: 'again', resume: a.resume, now: 2000, id: 'new', resumeToken: 'z' });
  assert.ok(r.ok && r.resumed && r.player.id === a.id && r.player.kills === 3);
  leave(m, a.id, 3000);
  tick(m, 3000 + RULES.graceMs + 1);
  assert.equal(m.players.has(a.id), false);
});

test('public state: teams, tournament id, stream slots, invite link, no resume tokens', () => {
  const m = mk('pvp');
  const a = add(m, 'npg');
  add(m, 'erobotz');
  setStream(m, a.id, 'npg-girl@chat');
  const s = publicState(m, 5, { inviteBase: 'https://tokenblaster.lol' });
  assert.equal(s.id, 'TN-ABCDE');
  assert.equal(s.tournamentId, 'cup-31oct');
  assert.deepEqual(s.teams.map((t) => t.name), ['NPG', 'Erobotz']);
  assert.equal(s.streams[0].slot, 'npg-girl@chat');
  assert.equal(s.inviteUrl, 'https://tokenblaster.lol/arcade/terrornode/team?match=ABCDE');
  assert.ok(!JSON.stringify(s).includes(a.resume));
});

test('pvp ends at the frag limit with a winner', () => {
  const m = mk('pvp');
  const a = add(m, 'npg');
  const b = add(m, 'erobotz');
  start(m, a.id, 0);
  m.frags.npg = RULES.fragLimit - 1;
  [a.x, a.z, b.x, b.z] = [0, 0, 0, -8];
  let t = 100;
  while (m.phase === 'live' && t < 5000) shoot(m, a.id, aim(a, b), null, (t += 100));
  assert.equal(m.phase, 'over');
  assert.equal(m.winner, 'npg');
});

test('dirOf yaw 0 faces -Z', () => {
  const d = dirOf(0);
  assert.ok(Math.abs(d.dx) < 1e-9 && d.dz === -1);
});
