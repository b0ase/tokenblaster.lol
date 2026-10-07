import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedTx, TxKind } from './feed';
import { Level, MAX_GAP, MAX_RISE } from './hopper/level';
import { Hero, P, type SimInput } from './hopper/sim';

const KINDS: TxKind[] = ['payment', 'blast', 'token', 'inscription', 'social', 'data'];
const tx = (i: number): FeedTx => ({ id: `${i.toString(16).padStart(8, '0')}aaaa`, kind: KINDS[i % KINDS.length], bytes: 120 + ((i * 977) % 5000), sats: 1, mined: false, token: 'abc_0' });
const idle: SimInput = { x: 0, jump: false, dash: false };

test('level keeps every main-path hop reachable', () => {
  for (let seed = 1; seed < 40; seed++) {
    const lv = new Level(seed);
    let prev = lv.last;
    for (let i = 0; i < 300; i++) {
      const diff = Math.min(1, i / 120);
      const p = lv.extend(i % 53 === 52 ? { block: { height: 900000 + i, txCount: 100, miner: 'x' } } : i % 7 === 3 ? {} : { tx: tx(i) }, diff);
      if (p === prev) continue; // an aerial bonus slab: the main path is unchanged
      assert.ok(p.x0 - prev.x1 <= MAX_GAP, `gap ${p.x0 - prev.x1}`);
      assert.ok(p.top - prev.top <= MAX_RISE, `rise ${p.top - prev.top}`);
      assert.ok(p.top >= 1 && p.top <= 12);
      prev = p;
    }
  }
});

const run = (hero: Hero, lv: Level, inp: SimInput, secs: number) => {
  for (let t = 0; t < secs; t += 1 / 120) hero.step(1 / 120, inp, lv);
};

test('hero stands, runs to top speed, and a held jump clears about 3 m', () => {
  const lv = new Level(1);
  const h = new Hero();
  h.place(0, 4, lv.last);
  run(h, lv, idle, 0.5);
  assert.equal(h.ground, lv.last);
  run(h, lv, { x: 1, jump: false, dash: false }, 0.6);
  assert.ok(h.vx > 10 && h.vx <= P.RUN + 0.01, `vx ${h.vx}`);
  let peak = h.y;
  for (let t = 0; t < 1; t += 1 / 120) {
    h.step(1 / 120, { x: 0, jump: true, dash: false }, lv);
    peak = Math.max(peak, h.y);
  }
  assert.ok(peak - 4 > 2.9 && peak - 4 < 3.7, `peak ${peak - 4}`);
});

test('a tap is a short hop and coyote time forgives a late press', () => {
  const lv = new Level(1);
  const h = new Hero();
  h.place(0, 4, lv.last);
  run(h, lv, idle, 0.3);
  let peak = 0;
  for (let t = 0; t < 0.8; t += 1 / 120) {
    h.step(1 / 120, { x: 0, jump: t < 0.03, dash: false }, lv);
    peak = Math.max(peak, h.y - 4);
  }
  assert.ok(peak > 0.4 && peak < 2, `hop ${peak}`);
  const h2 = new Hero();
  h2.place(lv.last.x1 - 0.5, lv.last.top, lv.last);
  let left = -1;
  let jumped = false;
  for (let t = 0; t < 1; t += 1 / 120) {
    if (left < 0 && !h2.ground && t > 0.01) left = t;
    const press = left >= 0 && t - left > 0.05 && t - left < 0.2;
    const ev = h2.step(1 / 120, { x: 1, jump: press, dash: false }, lv);
    if (ev.some((e) => e.t === 'jump')) jumped = true;
  }
  assert.ok(jumped, 'coyote jump');
});

test('dash happens once per air time', () => {
  const lv = new Level(1);
  const h = new Hero();
  h.place(0, 4, lv.last);
  h.launch(22);
  let dashes = 0;
  for (let t = 0; t < 0.5; t += 1 / 120) {
    // Mash the dash button (press and release) while airborne.
    const ev = h.step(1 / 120, { x: 1, jump: false, dash: Math.floor(t * 30) % 2 === 0 }, lv);
    dashes += ev.filter((e) => e.t === 'dash').length;
    if (ev.some((e) => e.t === 'land')) break;
  }
  assert.equal(dashes, 1);
});

test('running into a tall wall in the air slides and wall-jumps away', () => {
  const lv = new Level(1);
  const wallPlat = lv.last; // x -14..26, top 4
  // A tall block to the right, 6 m above the floor, so it is a wall rather than a ledge.
  lv.plats.push({ ...wallPlat, id: 99, x0: 8, x1: 20, top: 10, bot: 3 });
  const h = new Hero();
  h.place(5, 4, wallPlat);
  let wj = false;
  for (let t = 0; t < 1.6; t += 1 / 120) {
    const jump = t < 0.4 || (t > 0.55 && t < 1.2);
    const ev = h.step(1 / 120, { x: h.lock > 0 ? 0 : 1, jump, dash: false }, lv);
    if (ev.some((e) => e.t === 'walljump')) wj = true;
  }
  assert.ok(wj, 'wall jump happened');
});
