import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from './racemp/buffer';

const mk = () => new SnapshotBuffer({ maxSpeed: 260, clamp: [[-50, 50], [0, 10]], frozenBit: 8 });
const pkt = (ts: number, p: number, lat = 0, fl = 0) => ({ ts, p, v: 100, l: 0, f: fl, a: [lat, 1] });

test('interpolates smoothly under jitter', () => {
  const b = mk();
  // Sender at 100 m/s sending every 80 ms; arrival jittered by up to 40 ms.
  let prev = -1;
  for (let i = 0; i < 40; i++) {
    const ts = 1000 + i * 80;
    b.push(pkt(ts, i * 8, Math.sin(i / 5) * 10), ts + 30 + ((i * 37) % 40));
    const st = b.sample(ts + 100);
    if (st && prev >= 0) assert.ok(st.prog >= prev - 1e-6, 'progress never goes backwards');
    if (st) prev = st.prog;
  }
});

test('extrapolates briefly when late, then holds', () => {
  const b = mk();
  b.push(pkt(1000, 0), 1000);
  b.push(pkt(1100, 10), 1100);
  const a = b.sample(1100 + 130 + 100);
  assert.ok(a && a.prog > 10 && a.prog <= 10 + 100 * 0.3 + 1e-6);
  const z = b.sample(1100 + 130 + 5000);
  assert.ok(z && z.prog <= 10 + 100 * 0.3 + 1e-6);
});

test('clamps teleports (counted) and freezes a cheater', () => {
  const b = mk();
  b.push(pkt(1000, 0), 1000);
  b.push(pkt(1100, 5000), 1100); // 5 km in 100 ms
  assert.equal(b.suspect, 1);
  const st = b.sample(1100 + 130);
  assert.ok(st && st.prog < 100, 'clamped to a plausible distance');
  let ts = 1100;
  for (let i = 0; i < 20; i++) {
    ts += 100;
    b.push(pkt(ts, 9e5 + i * 1e5), ts);
  }
  assert.ok(b.frozen);
  assert.equal(b.push(pkt(ts + 100, 1), ts + 100), false);
});

test('rejects garbage and out-of-order packets, clamps channels', () => {
  const b = mk();
  assert.equal(b.push({ ts: 1, p: NaN, v: 1, l: 0, f: 0, a: [0, 0] }, 1), false);
  assert.equal(b.push({ ts: 1, p: 1, v: 1, l: 0, f: 0, a: [0] }, 1), false);
  assert.equal(b.push(pkt(2000, 10, 999), 2000), true);
  assert.equal(b.push(pkt(1999, 11), 2001), false);
  assert.equal(b.sample(2200)?.a[0], 50);
});

test('quaternion channels nlerp on the short arc', () => {
  const b = new SnapshotBuffer({ maxSpeed: 260, clamp: [[-1, 1], [-1, 1], [-1, 1], [-1, 1]], quat: 0 });
  b.push({ ts: 1000, p: 0, v: 0, l: 0, f: 0, a: [0, 0, 0, 1] }, 1000);
  b.push({ ts: 1100, p: 0, v: 0, l: 0, f: 0, a: [0, 0, 0, -1] }, 1100); // same rotation, opposite sign
  const st = b.sample(1050 + 130);
  assert.ok(st && Math.abs(Math.abs(st.a[3]) - 1) < 1e-6);
});
