import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVES, multFor, N, SnakeSim, stepSecs, type FoodSpec } from './snake/sim';

const mk = (specs: FoodSpec[] = []) => {
  const q = [...specs];
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return new SnakeSim({ take: () => q.shift() ?? null, waiting: () => q.length }, rand);
};
const run = (sim: SnakeSim, secs: number) => {
  for (let t = 0; t < secs; t += 1 / 60) sim.update(1 / 60);
};
const food = (kind: FoodSpec['kind'] = 'payment'): FoodSpec => ({ kind, bytes: 250, sats: 1, id: 'abc', loot: null });

test('the snake moves one cell per step and interpolation alpha stays in range', () => {
  const sim = mk();
  const x0 = sim.head.x;
  sim.update(sim.interval + 0.001);
  assert.equal(sim.head.x, x0 + 1);
  assert.ok(sim.alpha >= 0 && sim.alpha <= 1);
});

test('reversing is ignored, turns are queued at most twice', () => {
  const sim = mk();
  assert.equal(sim.turn(2), false); // heading right: cannot reverse
  assert.equal(sim.turn(1), true);
  assert.equal(sim.turn(0), true);
  assert.equal(sim.turn(1), false); // queue full
  assert.equal(sim.turnRel(1), false);
});

test('eating a bite scores, grows, and builds the combo multiplier', () => {
  const sim = mk();
  sim.foods = [{ ...food('token'), uid: 99, x: sim.head.x + 1, y: sim.head.y, bornT: 0 }];
  const len = sim.cells.length;
  sim.update(sim.interval + 0.001);
  assert.equal(sim.score, 50);
  assert.equal(sim.combo, 1);
  run(sim, 0.8);
  assert.equal(sim.cells.length, len + 3);
  assert.equal(multFor(0), 1);
  assert.equal(multFor(4), 2);
  assert.equal(multFor(400), 8);
});

test('the combo drops after the window', () => {
  const sim = mk();
  sim.combo = 5;
  sim.comboT = 0.1;
  run(sim, 0.3);
  assert.equal(sim.combo, 0);
});

test('hitting the wall costs a life, then respawns with a shield; three lives end the game', () => {
  const sim = mk();
  let overs = 0;
  for (let life = 1; life <= LIVES; life++) {
    sim.foods = [];
    while (sim.state === 'play') sim.update(1 / 60);
    assert.equal(sim.lives, LIVES - life);
    while (sim.state === 'dying') sim.update(1 / 60);
    for (const e of sim.drain()) if (e.t === 'over') overs++;
    if (life < LIVES) {
      assert.equal(sim.state, 'play');
      assert.ok(sim.fx.shield > 0);
      run(sim, 2.5); // shield wears off
    }
  }
  assert.equal(sim.state, 'over');
  assert.equal(overs, 1);
});

test('ghost wraps through the wall instead of dying', () => {
  const sim = mk();
  sim.fx.ghost = 30;
  sim.foods = [];
  run(sim, 6);
  assert.equal(sim.lives, LIVES);
  assert.ok(sim.head.x >= 0 && sim.head.x < N);
});

test('blocks are solid, capped, and kept off the spawn lane', () => {
  const sim = mk();
  for (let i = 0; i < 40; i++) sim.addBlock(1000 + i, 100_000);
  assert.ok(sim.blocks.length <= 10);
  for (const b of sim.blocks) assert.ok(b.x >= 2 && b.y >= 2 && b.x + b.w < N);
  const sim2 = mk();
  sim2.foods = [];
  sim2.blocks = [{ uid: 5, x: sim2.head.x + 2, y: sim2.head.y, w: 1, h: 1, height: 1, txCount: 0, bornT: 0, label: 'x' }];
  run(sim2, 1);
  assert.equal(sim2.deathCause, 'block');
});

test('food respects the target count and uses the live supply first', () => {
  const sim = mk([food('blast'), food('token')]);
  assert.equal(sim.foods.length, 5);
  assert.deepEqual(sim.foods.slice(0, 2).map((f) => f.kind), ['blast', 'token']);
  assert.ok(sim.foods.slice(2).every((f) => f.kind === 'quiet'));
});

test('magnet pulls food toward the head', () => {
  const sim = mk();
  sim.fx.magnet = 10;
  sim.foods = [{ ...food(), uid: 1, x: sim.head.x + 6, y: sim.head.y + 4, bornT: 0 }];
  const d0 = Math.abs(sim.foods[0].x - sim.head.x) + Math.abs(sim.foods[0].y - sim.head.y);
  sim.step();
  const d1 = Math.abs(sim.foods[0].x - sim.head.x) + Math.abs(sim.foods[0].y - sim.head.y);
  assert.ok(d1 < d0);
});

test('the snake speeds up with bites and OVERDRIVE is faster still', () => {
  assert.ok(stepSecs(30, false) < stepSecs(0, false));
  assert.ok(stepSecs(0, true) < stepSecs(0, false));
  assert.ok(stepSecs(999, false) >= 0.075);
});
