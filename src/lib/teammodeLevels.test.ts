import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_KIND, RULES, createMatch, join, publicState, shoot, snapshot, start, tick, wavesOf, type Match } from './teammode/match';
import { levelOf } from './terrornode/levels';
import { teamWaveFor } from './teammode/levels';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = (level?: string) => createMatch({ code: 'ABCDE', mode: 'coop', level, now: 0, rand });
const fill = (m: Match, n = 16) => {
  for (let i = 0; i < n; i++) assert.ok(join(m, { name: `p${i}`, now: 0, id: `id${i}`, resumeToken: `r${i}` }).ok);
};

test('a match carries its level (unknown levels fall back to the block)', () => {
  assert.equal(mk('heart').level, 'heart');
  assert.equal(mk('../etc').level, 'assault');
  assert.equal(mk().level, 'assault');
  const s = publicState(mk('rails'), 0);
  assert.equal(s.level, 'rails');
  assert.equal(s.waves, levelOf('rails').team.waves);
});

test('co-op waves follow the level: size, enemy kinds, wave count', () => {
  const m = mk('datacore');
  fill(m, 16);
  assert.ok(start(m, 'id0', 0).ok);
  assert.equal(m.wave, 1);
  // 16 players: the wave is the level's wave 1 scaled to the crowd (levels.ts teamWaveFor)
  assert.equal(m.waveLeft, teamWaveFor(levelOf('datacore').team, 1, 16));
  assert.ok(m.waveLeft > levelOf('datacore').team.base + levelOf('datacore').team.perWave);
  for (let t = 1; t < 40; t++) tick(m, t * 50);
  const kinds = new Set(m.enemies.map((e) => e.kind));
  for (const k of kinds) assert.ok(levelOf('datacore').team.kinds.includes(k));
  assert.equal(wavesOf(m), 7);
});

test('the Heart brings its boss on the last wave, and it can be shot', () => {
  const m = mk('heart');
  fill(m, 1);
  assert.ok(start(m, 'id0', 0).ok);
  const L = levelOf('heart').team;
  // skip to the last wave: clear the field each step
  while (m.wave < L.waves) {
    m.enemies = [];
    m.waveLeft = 0;
    tick(m, m.wave * 1000);
  }
  const boss = m.enemies.find((e) => e.kind === BOSS_KIND);
  assert.ok(boss, 'boss is on the field');
  assert.equal(boss!.hp, L.bossHp);
  const p = m.players.get('id0')!;
  [p.x, p.z, boss!.x, boss!.z] = [0, 0, 0, -10];
  const r = shoot(m, 'id0', 0, null, 99_999);
  assert.equal(r.hit?.id, `e${boss!.id}`);
  assert.equal(boss!.hp, L.bossHp! - RULES.shotDamage);
  const snap = snapshot(m, []);
  assert.ok(snap.e.some((e) => e[5] === BOSS_KIND));
});

test('snapshot events are rounded to the centimetre (bandwidth)', () => {
  const m = mk();
  fill(m, 1);
  start(m, 'id0', 0);
  const ev = [{ k: 'shot' as const, by: 'id0', x: 1.23456, z: -7.891011, yaw: 0.123456789, len: 33.33333 }];
  const s = snapshot(m, ev);
  assert.deepEqual(s.ev[0], { k: 'shot', by: 'id0', x: 1.23, z: -7.89, yaw: 0.123, len: 33.33 });
});
