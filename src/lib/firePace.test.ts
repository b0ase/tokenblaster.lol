import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireAllowance, pacedRate, secsLeft, shouldAutoLoad, spinUp, trulyEmpty, PACE_TARGET_SECS } from './firePace';

const MINIGUN = 3000;

test('a $0.10 load (~17k rounds) lasts at least 60 s at the paced rate', () => {
  const rounds = 16_927;
  const rate = pacedRate(MINIGUN, rounds);
  assert.ok(rate < MINIGUN);
  assert.ok(rounds / rate >= 60, `${rounds / rate}s`);
  assert.ok(rounds / rate <= PACE_TARGET_SECS + 1);
});

test('a $1 load (~170k rounds) lasts ~90 s; a $5 load gets full rate', () => {
  assert.ok(170_057 / pacedRate(MINIGUN, 170_057) >= 60);
  assert.equal(pacedRate(MINIGUN, 847_022), MINIGUN);
});

test('pacing never changes the rounds: every loaded round still fires (rate x time covers the load)', () => {
  for (const r of [1, 500, 16_927, 170_057, 847_022]) {
    const rate = pacedRate(MINIGUN, r);
    assert.ok(rate > 0);
    assert.ok(rate * Math.max(PACE_TARGET_SECS, r / rate) >= r);
  }
});

test('tiny loads still fire at a floor rate; nothing loaded fires nothing', () => {
  assert.equal(pacedRate(MINIGUN, 100), 50);
  assert.equal(pacedRate(MINIGUN, 0), 0);
});

test('spin-up ramps from 15% to full over 1.5 s', () => {
  assert.equal(spinUp(0), 0.15);
  assert.ok(spinUp(0.75) > 0.5 && spinUp(0.75) < 1);
  assert.equal(spinUp(1.5), 1);
  assert.equal(spinUp(10), 1);
});

test('the trigger can not run more than ~2 s ahead of the network', () => {
  assert.equal(fireAllowance({ left: 16_000, fired: 1000, sent: 1000, rate: 190 }), 380);
  assert.equal(fireAllowance({ left: 16_000, fired: 1380, sent: 1000, rate: 190 }), 0);
  assert.equal(fireAllowance({ left: 10, fired: 0, sent: 0, rate: 190 }), 10);
});

test('never "out of rounds" while the gun holds a round of credit or rounds still sending', () => {
  assert.equal(trulyEmpty({ left: 0, unsent: 0, spareSats: 5000, roundSats: 3 }), false);
  assert.equal(shouldAutoLoad({ left: 0, unsent: 0, spareSats: 5000, roundSats: 3 }), true);
  assert.equal(trulyEmpty({ left: 0, unsent: 40, spareSats: 0, roundSats: 3 }), false);
  assert.equal(shouldAutoLoad({ left: 0, unsent: 40, spareSats: 5000, roundSats: 3 }), false);
  assert.equal(trulyEmpty({ left: 0, unsent: 0, spareSats: 2, roundSats: 3 }), true);
  assert.equal(trulyEmpty({ left: 5, unsent: 0, spareSats: 0, roundSats: 3 }), false);
});

test('seconds left', () => {
  assert.equal(secsLeft(1900, 190), 10);
  assert.equal(secsLeft(0, 190), 0);
});

test('regression 31 Oct: after GO the held trigger shoots every tick for 2 s even if the network never reports', async () => {
  const { triggerTick, maxAhead } = await import('./firePace');
  const rate = 190; // $0.10 load
  let fired = 0;
  const sent = 0; // ARC stuck ANNOUNCED, Arcade not answered yet: nothing counted
  let shownTicks = 0;
  for (let t = 1; t <= 40; t++) {
    const n = Math.ceil((rate * 50) / 1000); // one 50 ms tick at full spin
    const k = triggerTick({ n, left: 17_000 - fired, fired, sent, rate });
    fired += k.paid;
    if (k.shown > 0) shownTicks++;
    assert.ok(k.paid <= k.shown);
  }
  assert.equal(shownTicks, 40, 'the gun visibly fires on every tick for 2 s');
  assert.ok(fired <= maxAhead(rate), 'paid rounds still never run more than ~2 s ahead of the network');
  // Arcade reports late: the paid queue resumes at once.
  assert.ok(triggerTick({ n: 10, left: 17_000 - fired, fired, sent: fired, rate }).paid === 10);
  // a dry pack shows nothing
  assert.deepEqual(triggerTick({ n: 10, left: 0, fired, sent, rate }), { shown: 0, paid: 0 });
});
