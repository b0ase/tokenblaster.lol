import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING, ramp, roleWeights } from './galleryGame/tuning';

const MINIGUN_DPS = 1500; // one accepted round is 1 damage; the minigun streams up to 1500 a second

test('combat: wave 1 is the baseline and everything escalates after it', () => {
  assert.equal(ramp(0.2, 1), 1);
  assert.ok(ramp(TUNING.waveRamp.erobotDamage, 4) > ramp(TUNING.waveRamp.erobotDamage, 2));
  assert.ok(ramp(TUNING.waveRamp.bossDamage, 6) >= 2);
  assert.ok(ramp(TUNING.waveRamp.bossPush, 12, TUNING.boss.pushMinScale) >= TUNING.boss.pushMinScale, 'push never falls below its floor');
});

test('combat: erobot roles sum to 1 and shift from shooters to rushers', () => {
  for (const w of [1, 3, 6, 20]) {
    const r = roleWeights(w);
    assert.ok(Math.abs(r.shooter + r.rusher + r.flanker - 1) < 1e-9, `wave ${w}`);
  }
  assert.ok(roleWeights(6).rusher > roleWeights(1).rusher);
  assert.ok(roleWeights(6).shooter < roleWeights(1).shooter);
});

test('combat: wave 1 is survivable for a player who keeps firing', () => {
  const T = TUNING;
  // worst case: every live erobot shoots a true bolt at the fastest cadence and nothing is shot down
  const shooters = T.stages[0].lane.liveCap * roleWeights(1).shooter;
  const boltDps = (shooters * T.erobots.bolt.damage * (1 - T.erobots.bolt.miss)) / ((T.erobots.bolt.every[0] + T.erobots.bolt.every[1]) / 2);
  assert.ok(boltDps < 12, `bolt dps on wave 1 is ${boltDps.toFixed(1)}`);
  // the boss can't one-shot, and the opening is quiet
  assert.ok(T.boss.swipe.damage < T.player.hp * 0.25);
  assert.ok(T.boss.lunge.damage < T.player.hp * 0.35);
  assert.ok(T.player.openingGrace >= 3);
  // erobots die easily: a fraction of a second of one minigun on a single target
  assert.ok(T.erobots.hp / MINIGUN_DPS < 0.1);
});

test('combat: sustained fire pushes the boss back, easing off lets him advance fast', () => {
  const B = TUNING.boss;
  assert.ok(MINIGUN_DPS >= B.pushFullDps, 'full minigun rate is a full push');
  assert.ok(B.pushMax * ramp(TUNING.waveRamp.bossPush, 1, B.pushMinScale) > B.stalkSpeed, 'wave 1: firing beats his walk');
  assert.ok(B.catchupSpeed > B.stalkSpeed * 1.5, 'quiet: he closes the gap fast');
  assert.ok(B.staggerDps <= MINIGUN_DPS, 'sustained minigun fire staggers him');
  assert.ok(B.minDist < B.reach && B.reach < B.maxBack);
});

test('block: one ten-minute run, four stages in order, back to back with no gaps', () => {
  const R = TUNING.run;
  const S = TUNING.stages;
  assert.equal(R.secs, 600, 'one block is ten minutes');
  assert.deepEqual(S.map((x) => x.id), ['street', 'floors', 'core', 'roof']);
  assert.equal(S[0].at, 0);
  for (let i = 1; i < S.length; i++) assert.ok(S[i].at > S[i - 1].at && S[i].at - S[i - 1].at >= 60, `stage ${i + 1} follows on`);
  assert.ok(S[3].at < R.bossAt && R.bossAt < R.secs - 30, 'the Liquid Unit has the last minutes');
  assert.ok(R.fogSurge < 3, 'the set swap is a short fog surge, not a pause');
  assert.equal('leaveMs' in TUNING.stageFlow, false, 'no lift: nothing stops play between stages');
  S.forEach((x, i) => {
    assert.equal(x.level, i + 1);
    assert.ok(x.walk > 0, `${x.id}: the player is walked forward`);
  });
});

test('block: the player almost never dies (knockdown, fast regen, light damage)', () => {
  const P = TUNING.player;
  assert.ok(P.knockdownHp >= 0.5, 'a knockdown puts you straight back in');
  assert.ok(P.regenPerSec >= 10 && P.regenDelay <= 2);
  assert.ok(TUNING.erobots.bolt.damage <= 2 && TUNING.erobots.melee.damage <= 3);
  for (const k of TUNING.horde.kinds) assert.ok(k.damage <= 5, k.id);
});

test('block: a constant swarm of different sizes, inside the pools', () => {
  const H = TUNING.horde;
  const sizes = H.kinds.flatMap((k) => k.size);
  assert.ok(Math.min(...sizes) < 0.9 && Math.max(...sizes) > 2.5, 'small, medium and huge');
  const pool = H.kinds.reduce((n, k) => n + k.pool, 0);
  for (const x of TUNING.stages) {
    assert.ok(x.horde > 0 && Math.max(x.horde, x.hordeEnd) <= pool, x.id);
    assert.ok(x.lane.liveCap <= TUNING.erobots.poolHigh, x.id);
    assert.ok(x.lane.liveCap + x.horde >= 12, `${x.id}: always something to shoot`);
  }
  assert.ok('bossLevel' in TUNING.stages[3]);
});

test('stages: the core jam is a bonus that needs a steady stream', () => {
  const g = TUNING.stages[2].jam;
  const secs = g.rounds / (MINIGUN_DPS - g.drainPerSec);
  assert.ok(secs > 2 && secs < 12, `a full minigun jams the core in ${secs.toFixed(1)}s`);
  assert.ok(g.drainPerSec > 100);
});

test('stages: the lanes fit their sets (flankers stay inside the walls)', () => {
  for (const x of TUNING.stages) {
    assert.ok(x.lane.flankX[1] <= x.lane.wallX, x.id);
    assert.ok(x.lane.strafeX <= x.lane.wallX, x.id);
    assert.ok(x.lane.spawnZ < x.lane.stopZ[0], x.id);
  }
});
