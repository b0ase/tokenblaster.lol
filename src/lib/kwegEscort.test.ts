import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESCORT, EscortAI } from './galleryGame/escort';

/** A fixed sequence for the AI's random draws (cycles). */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};
const P = { x: 0, z: 0 };
const run = (ai: EscortAI, secs: number, player = P, threats: { x: number; z: number }[] = [], dt = 1 / 30) => {
  const ev: string[] = [];
  for (let t = 0; t < secs; t += dt) {
    const e = ai.update(dt, player, threats);
    if (e) ev.push(e);
  }
  return ev;
};

test('follow: trots to his spot beside the player and stays inside the follow radius', () => {
  const ai = new EscortAI(seq(0.99)); // panics as late as possible
  ai.reset({ x: 6, z: 8 });
  run(ai, 3);
  assert.equal(ai.state, 'follow');
  assert.ok(Math.hypot(ai.x - ESCORT.spot.x, ai.z - ESCORT.spot.z) <= ESCORT.followR + 0.01);
});

test('panic: every few seconds he runs the wrong way (back into the core with no threats)', () => {
  const ai = new EscortAI(seq(0, 0.99, 0.5)); // first panic at the earliest
  ai.reset();
  const ev = run(ai, ESCORT.panicEvery[0] + 0.1, { x: 0, z: -40 }); // the player is far ahead: no grab
  assert.ok(ev.includes('panic'));
  assert.equal(ai.state, 'panic');
  const z0 = ai.z;
  run(ai, 1, { x: 0, z: -40 });
  assert.ok(ai.z > z0, 'ran back towards +Z (the core)');
});

test('panic: towards the Erobotz when the draw says so', () => {
  const ai = new EscortAI(seq(0, 0.99, 0.1));
  ai.reset({ x: 0, z: 0 });
  const threats = [{ x: 0, z: -15 }];
  run(ai, ESCORT.panicEvery[0] + 0.1, { x: 0, z: 30 }, threats);
  const z = ai.z;
  run(ai, 0.5, { x: 0, z: 30 }, threats);
  assert.equal(ai.state, 'panic');
  assert.ok(ai.z < z, 'ran towards the threat (-Z)');
});

test('staying close grabs him back on track', () => {
  const ai = new EscortAI(seq(0, 0.99, 0.5));
  ai.reset({ x: 0, z: 0 });
  run(ai, ESCORT.panicEvery[0] + 0.1, { x: 0, z: -20 });
  assert.equal(ai.state, 'panic');
  run(ai, 0.6, { x: ai.x, z: ai.z }); // the player is right on him
  assert.equal(ai.state, 'follow');
});

test('CALL KWEG: he sprints back to the player and returns to following', () => {
  const ai = new EscortAI(seq(0, 0.99, 0.5));
  ai.reset({ x: 0, z: 10 });
  assert.equal(ai.call(), true);
  assert.equal(ai.state, 'called');
  run(ai, 0.1);
  assert.equal(ai.speed, ESCORT.callSpeed);
  let t = 0;
  while (ai.state === 'called' && t < ESCORT.callFor + 1) {
    ai.update(1 / 30, P, []);
    t += 1 / 30;
  }
  assert.equal(ai.state, 'follow');
  assert.ok(Math.hypot(ai.x, ai.z) < ESCORT.arriveR + 0.5, 'arrived at the player');
});

test('the Erobotz hurt him; at zero HP he is lost and stays lost', () => {
  const ai = new EscortAI(seq(0.99));
  ai.reset({ x: ESCORT.spot.x, z: ESCORT.spot.z });
  const swarm = [0, 1, 2].map(() => ({ x: ESCORT.spot.x, z: ESCORT.spot.z }));
  const ev = run(ai, 10, P, swarm);
  assert.deepEqual(ev.filter((e) => e === 'lost'), ['lost']);
  assert.equal(ai.state, 'dead');
  assert.equal(ai.alive, false);
  assert.equal(ai.call(), false);
  assert.equal(ai.hurt(10), null);
});

test('a bolt that kills him reports lost', () => {
  const ai = new EscortAI();
  assert.equal(ai.hurt(ESCORT.hp - 1), null);
  assert.equal(ai.hurt(5), 'lost');
});

test('win: once safe he takes no more damage and never panics', () => {
  const ai = new EscortAI(seq(0));
  ai.reset();
  ai.safe();
  const ev = run(ai, 20, P, [{ x: ai.x, z: ai.z }]);
  assert.equal(ai.state, 'safe');
  assert.equal(ai.hp, ESCORT.hp);
  assert.deepEqual(ev, []);
});

test('reset brings him back to full health following (retry from Act 2)', () => {
  const ai = new EscortAI();
  ai.hurt(1000);
  ai.reset();
  assert.equal(ai.state, 'follow');
  assert.equal(ai.hp, ESCORT.hp);
});
