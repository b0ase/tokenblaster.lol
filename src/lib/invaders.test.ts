import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatDetector, comboKill, comboTick, fireSpecs, formationSlots, hpFor, multFor, newCombo, PATTERNS, rollPower, sizeFor, waveSpec, POWERS } from './invaders/sim';

test('invaders: ship size grows with tx bytes and stays in range', () => {
  let prev = 0;
  for (const b of [100, 250, 1000, 5000, 50_000, 500_000, 5_000_000]) {
    const s = sizeFor(b);
    assert.ok(s >= prev && s >= 0.78 && s <= 1.9, `${b}: ${s}`);
    prev = s;
  }
  assert.equal(hpFor('token', 200), 2);
  assert.equal(hpFor('payment', 200), 1);
  assert.equal(hpFor('data', 100_000), 3);
});

test('invaders: every pattern lays out exactly n slots inside the field, none stacked', () => {
  for (const p of PATTERNS) {
    for (const n of [1, 5, 14, 24, 33, 44]) {
      const slots = formationSlots(n, p);
      assert.equal(slots.length, n, `${p} ${n}`);
      const minX = Math.min(...slots.map((s) => s.x));
      const maxX = Math.max(...slots.map((s) => s.x));
      assert.ok(maxX - minX <= 8 * 2 + 6, `${p} ${n} width ${maxX - minX}`);
      for (let i = 0; i < slots.length; i++)
        for (let j = i + 1; j < slots.length; j++) assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z) > 1.2, `${p} ${n} overlap ${i},${j}`);
    }
  }
});

test('invaders: waves grow with wave number and mempool backlog, bosses come every fifth wave or on a block', () => {
  const a = waveSpec(1, 0, false);
  const b = waveSpec(4, 0, false);
  const busy = waveSpec(4, 120, false);
  assert.ok(b.count > a.count && busy.count > b.count);
  assert.ok(busy.diverEvery < b.diverEvery);
  assert.ok(b.fireEvery < a.fireEvery);
  assert.equal(waveSpec(5, 0, false).boss, true);
  assert.equal(waveSpec(2, 0, true).boss, true);
  assert.equal(waveSpec(3, 0, false).boss, false);
  assert.ok(waveSpec(60, 9999, false).count <= 44);
});

test('invaders: combo multiplier steps up, beat kills count double, the timer breaks it', () => {
  assert.equal(multFor(0), 1);
  assert.equal(multFor(5), 2);
  assert.equal(multFor(40), 6);
  assert.equal(multFor(500), 8);
  const c = newCombo();
  for (let i = 0; i < 5; i++) comboKill(c, false);
  assert.equal(c.count, 5);
  comboKill(c, true);
  assert.equal(c.count, 7);
  assert.equal(c.best, 7);
  assert.equal(comboTick(c, 1), false);
  assert.equal(comboTick(c, 1.5), true);
  assert.equal(c.count, 0);
  assert.equal(c.best, 7);
});

test('invaders: weapons and power-up rolls', () => {
  assert.equal(fireSpecs(false, false).length, 1);
  assert.equal(fireSpecs(true, false).length, 3);
  assert.ok(fireSpecs(false, true)[0].pierce > 0);
  const seen = new Set(Array.from({ length: 200 }, (_, i) => rollPower(i / 200)));
  for (const p of POWERS) assert.ok(seen.has(p), p);
});

test('invaders: beat detector finds onsets in a bass pulse and falls back to a metronome in silence', () => {
  const d = new BeatDetector();
  let music = 0;
  for (let i = 0; i < 600; i++) {
    const t = i / 60;
    const phase = (t % 0.5) / 0.5;
    if (d.feed(phase < 0.08 ? 0.8 : 0.1, t)) music++;
  }
  assert.ok(music >= 17 && music <= 23, `10s of 120 bpm gave ${music} beats`);
  assert.equal(d.fromMusic, true);
  const q = new BeatDetector();
  let n = 0;
  for (let i = 0; i < 600; i++) if (q.feed(0, i / 60)) n++;
  assert.ok(n >= 17 && n <= 23, `metronome ${n}`);
  assert.equal(q.fromMusic, false);
});
