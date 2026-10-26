/**
 * TERRORNODE MELEE and big matches (26 Oct): the 64-player room cap and its scaling (waves, live cap, boss HP), the
 * plaza arena (spawns spread out, cover stops rounds and bodies, terraces), interest management (each player gets
 * what is near them plus the room's counters) and the server-summed ROOM TX/SEC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_KIND, INTEREST, MAX_PER_SIDE, MAX_PLAYERS, RULES, TX_WINDOW_MS, confirmTx, createMatch, join, move, publicState, shoot, snapFor, snapParts, snapshot, start, tick, txPerSec, type Match } from './teammode/match';
import { MELEE, MELEE_R, TOWER_R, coverHit, heightAt, resolve } from './teammode/arena';
import { TEAM_LEVELS, bossHpFor, crowdK, enemyCapFor, teamWaveFor, teamWaveSize } from './teammode/levels';

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = (mode: 'coop' | 'pvp' = 'coop', level = 'melee') => createMatch({ code: 'MELEE', mode, level, now: 0, rand });
const fill = (m: Match, n: number, side?: 'npg' | 'erobotz') => {
  for (let i = 0; i < n; i++) {
    const r = join(m, { name: `p${i}`, side: side ?? (i % 2 ? 'erobotz' : 'npg'), now: 0, id: `id${i}`, resumeToken: `r${i}` });
    assert.ok(r.ok, !r.ok ? r.error : '');
  }
};
const aim = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

test('room cap: 64 in co-op, 32 v 32 in PvP, the 65th refused with the real numbers', () => {
  assert.equal(MAX_PLAYERS, 64);
  assert.equal(MAX_PER_SIDE, 32);
  const c = mk('coop');
  fill(c, 64);
  const r = join(c, { name: 'x', now: 0, id: 'x', resumeToken: 'x' });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /64/);
  const p = mk('pvp');
  fill(p, 64);
  const s = publicState(p, 0);
  assert.deepEqual(s.teams.map((t) => [t.size, t.max]), [[32, 32], [32, 32]]);
  assert.equal(s.maxPerSide, 32);
  assert.equal(s.arena, 'melee');
});

test('crowd scaling: waves, the live cap and the boss grow with the head count; a squad of 4 plays as written', () => {
  const L = TEAM_LEVELS.melee;
  assert.equal(teamWaveFor(L, 3, 1), teamWaveSize(L, 3));
  assert.equal(teamWaveFor(L, 3, 4), teamWaveSize(L, 3));
  assert.ok(teamWaveFor(L, 3, 64) > teamWaveSize(L, 3) * 10, '64 players: ~10x the enemies of a squad');
  assert.ok(crowdK(64) < 16, 'a little under linear');
  assert.equal(enemyCapFor(1), RULES.enemyCap);
  assert.equal(enemyCapFor(64), 160);
  assert.equal(bossHpFor(L, 1), L.bossHp);
  assert.ok(bossHpFor(L, 64) > L.bossHp! * 30);
  // in a match: wave 1 for 64 is sized to 64, and the field holds more than the squad cap
  const m = mk();
  fill(m, 64);
  assert.ok(start(m, 'id0', 0).ok);
  assert.equal(m.waveLeft, teamWaveFor(L, 1, 64));
  for (let t = 1; t <= 60; t++) tick(m, t * 50);
  assert.ok(m.enemies.length > RULES.enemyCap, `live ${m.enemies.length}`);
  assert.ok(m.enemies.length <= enemyCapFor(64));
});

test('the TOWER CORE walks out of the tower door on the last wave, HP scaled to the crowd', () => {
  const m = mk();
  fill(m, 32);
  start(m, 'id0', 0);
  while (m.wave < TEAM_LEVELS.melee.waves) {
    m.enemies = [];
    m.waveLeft = 0;
    tick(m, m.wave * 1000);
  }
  const boss = m.enemies.find((e) => e.kind === BOSS_KIND)!;
  assert.ok(boss);
  assert.equal(boss.hp, bossHpFor(TEAM_LEVELS.melee, 32));
  assert.ok(Math.hypot(boss.x, boss.z) < TOWER_R + 5, 'at the tower');
  const c = snapshot(m, [], 99_000).c;
  assert.deepEqual(c.boss, [boss.hp, boss.hp]);
  assert.equal(publicState(m, 0).boss?.[1], boss.hp);
});

test('plaza: 64 spawns spread round the rim, PvP sides on opposite halves, nobody inside cover', () => {
  const m = mk();
  fill(m, 64);
  start(m, 'id0', 0);
  const ps = [...m.players.values()];
  let close = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < 1.2) close++;
  // 32 spawn points for 64 players: pairs share a point (jittered), never more
  assert.ok(close <= 40, `${close} near pairs`);
  for (const p of ps) {
    assert.ok(Math.hypot(p.x, p.z) < MELEE_R, 'inside the plaza');
    for (const c of MELEE.cover) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.r, 'not inside cover');
  }
  const v = mk('pvp');
  fill(v, 64);
  start(v, 'id0', 0);
  for (const p of v.players.values()) assert.ok(p.team === 'npg' ? p.z > 0 : p.z < 0.01, `${p.team} at z ${p.z}`);
});

test('plaza: terraces rise outward, cover stops bodies and rounds, the tower is solid', () => {
  assert.equal(heightAt(MELEE, 10, 10), 0);
  assert.equal(heightAt(MELEE, 45, 0), 1.6);
  assert.ok(heightAt(MELEE, 36, 0) > 0 && heightAt(MELEE, 36, 0) < 1.6, 'ramp');
  assert.equal(heightAt(MELEE, 0, 74), 4.8);
  const r = resolve(MELEE, 1, 1);
  assert.ok(Math.hypot(r.x, r.z) >= TOWER_R + 0.5, 'pushed out of the tower');
  const out = resolve(MELEE, 200, 0);
  assert.ok(Math.hypot(out.x, out.z) <= MELEE_R);
  // a round fired at the tower stops at its wall
  assert.ok(Math.abs(coverHit(MELEE, 0, 20, 0, -1) - (20 - TOWER_R)) < 1e-6);
  // a foe behind the tower can't be hit
  const m = mk('pvp');
  fill(m, 2);
  start(m, 'id0', 0);
  const [a, b] = [m.players.get('id0')!, m.players.get('id1')!];
  [a.x, a.z, b.x, b.z] = [0, 25, 0, -25];
  const s = shoot(m, a.id, aim(a, b), null, 5000);
  assert.equal(s.hit, null);
  // a move into the tower is held outside it
  a.lastMove = 0;
  [a.x, a.z] = [0, TOWER_R + 1];
  move(m, a.id, 0, 0, 0, 10_000);
  assert.ok(Math.hypot(a.x, a.z) >= TOWER_R + RULES.playerRadius - 1e-6);
});

test('interest management: a player gets themself, what is near, the boss and the counters; spectators everything', () => {
  const m = mk();
  fill(m, 64);
  start(m, 'id0', 0);
  for (let t = 1; t <= 80; t++) tick(m, t * 50);
  // put the boss far from id0
  m.enemies.push({ id: 9999, x: 0, z: -(TOWER_R + 3), yaw: 0, hp: 5000, kind: BOSS_KIND });
  m.bossMax = 5000;
  const me = m.players.get('id0')!;
  [me.x, me.z] = [0, 74];
  const ev = [
    { k: 'shot' as const, by: 'id0', x: 0, z: 74, yaw: 0, len: 10 },
    { k: 'shot' as const, by: 'far', x: 0, z: -74, yaw: 0, len: 10 },
    { k: 'wave' as const, n: 2 },
  ];
  const parts = snapParts(m, ev, 5000);
  const s = JSON.parse(snapFor(parts, 'id0'));
  assert.equal(s.ip, 1);
  assert.ok(s.p.some((p: unknown[]) => p[0] === 'id0'), 'self is always in');
  assert.ok(s.p.length <= INTEREST.players);
  assert.ok(s.e.length <= INTEREST.enemies);
  assert.ok(s.e.some((e: unknown[]) => e[5] === BOSS_KIND), 'the boss is always in');
  for (const p of s.p) if (p[0] !== 'id0') assert.ok(Math.hypot(p[1] - 0, p[2] - 74) <= INTEREST.radius + 1e-6);
  assert.equal(s.c.pc, 64, 'counters: the whole room');
  assert.ok(s.c.ec >= m.enemies.length);
  assert.deepEqual(s.c.boss, [5000, 5000]);
  assert.ok(s.ev.some((e: { by?: string }) => e.by === 'id0'), 'own shot');
  assert.ok(!s.ev.some((e: { by?: string }) => e.by === 'far'), 'a far shot is not sent');
  assert.ok(s.ev.some((e: { k: string }) => e.k === 'wave'), 'waves always');
  const spec = JSON.parse(parts.spectator);
  assert.equal(spec.ip, 0);
  assert.equal(spec.p.length, 64);
  assert.equal(spec.e.length, m.enemies.length);
  assert.ok(snapFor(parts, 'id0').length < parts.full.length / 2, 'a player snapshot is well under the full one');
  // an unknown viewer (a spectator socket) gets the spectator cut
  assert.equal(snapFor(parts, 'nobody'), parts.spectator);
  // the full snapshot is the same JSON shape as snapshot()
  const full = JSON.parse(parts.full);
  assert.deepEqual(Object.keys(full).sort(), Object.keys(snapshot(m, ev, 5000)).sort());
});

test('ROOM TX/SEC: the server sums every player\'s reported paid rounds over the window; no reports = 0', () => {
  const m = mk();
  fill(m, 3);
  start(m, 'id0', 0);
  for (const id of ['id0', 'id1', 'id2']) for (let i = 0; i < 40; i++) shoot(m, id, 0, null, 100 + i * 100);
  assert.equal(txPerSec(m, 5000), 0, 'shots without transactions are not tx');
  confirmTx(m, 'id0', 20, 5000);
  confirmTx(m, 'id1', 30, 5000);
  confirmTx(m, 'id2', 40, 5000);
  assert.equal(txPerSec(m, 5000), 18, '90 tx over a 5 s window');
  assert.equal(publicState(m, 5000).txPerSec, 18);
  assert.equal(snapshot(m, [], 5000).c.tps, 18);
  // never more than a player fired
  confirmTx(m, 'id0', 1000, 5000);
  assert.ok(m.players.get('id0')!.txShots <= m.players.get('id0')!.shots);
  assert.equal(txPerSec(m, 5000 + TX_WINDOW_MS + 1), 0, 'the window rolls off');
});
