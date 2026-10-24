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
  const shooters = T.erobots.liveCap * roleWeights(1).shooter;
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

test('combat: the player can die and CONTINUE is an arcade countdown with coins', () => {
  assert.ok(TUNING.player.hp > 0);
  assert.ok(TUNING.continueSecs >= 5 && TUNING.continueSecs <= 15);
  assert.equal('continueFree' in TUNING, false, 'the free-continue flag is gone');
});
