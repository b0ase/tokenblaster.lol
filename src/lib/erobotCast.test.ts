import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CAST, CLOSE, PROXIMITY, WEAPONS, approachK, holdOut, pickCast, standOff } from './galleryGame/cast';
import { TUNING } from './galleryGame/tuning';
import { NPG_GIRLS } from './npgGirls';

test('every named Erobot is canon (npgGirls team Erobot)', () => {
  const canon = new Set(NPG_GIRLS.filter((g) => g.team === 'Erobot').map((g) => g.slug));
  const named = CAST.filter((c) => c.named);
  assert.ok(named.length >= 8);
  for (const c of named) assert.ok(canon.has(c.id), c.id);
});

test('every cast member has hi and lo models on disk', () => {
  for (const c of CAST) for (const d of ['hi', 'lo']) assert.ok(existsSync(`public/gallery/erobots/${d}/${c.id}.glb`), `${d}/${c.id}`);
});

test('ids are unique', () => {
  assert.equal(new Set(CAST.map((c) => c.id)).size, CAST.length);
});

test('threat: they can reach you (contact range, no 3-attacker cap), low damage, telegraphed shots', () => {
  assert.ok(CLOSE.minDist <= 2.5, 'they get close enough to hit');
  assert.ok(CLOSE.maxClose >= 5, 'a crowd can swarm you');
  for (const [k, w] of Object.entries(WEAPONS)) {
    assert.ok(w.damage * w.burst <= 2, `${k} volley damage`);
    assert.ok(w.damage <= 1.3, `${k} shot damage`);
    assert.ok(w.melee <= 1.2, `${k} melee`);
    if (w.ranged || w.throws) assert.ok(w.charge >= 0.25, `${k} telegraph`);
  }
});

test('pickCast is weighted and stays in the free set', () => {
  const free = [0, 8, 9];
  for (let r = 0; r < 1; r += 0.01) assert.ok(free.includes(pickCast(free, r)));
  assert.equal(pickCast([], 0.5), -1);
});

test('proximity slowdown: full speed far out, 30-40% at contact, never stops', () => {
  const c = standOff(1);
  assert.equal(approachK(30, c), 1);
  assert.equal(approachK(PROXIMITY.from, c), 1);
  assert.ok(approachK(c, c) >= 0.3 && approachK(c, c) <= 0.4);
  let prev = 0;
  for (let d = 0; d <= 12; d += 0.25) {
    const k = approachK(d, c);
    assert.ok(k >= prev - 1e-9, 'slower the closer');
    assert.ok(k > 0);
    prev = k;
  }
});

test('contact range: bodies still never sit inside the camera or behind it', () => {
  assert.ok(-TUNING.erobots.melee.stopZ >= 1.5 && -TUNING.erobots.melee.stopZ <= 3, 'rushers close to contact');
  for (const st of TUNING.stages) assert.ok(-st.lane.stopZ[1] >= 4, 'shooter plant depth');
  const sz = TUNING.erobots.sizes;
  const out: [number, number] = [0, 0];
  for (const size of [sz.range[0], 1, sz.range[1], sz.heavy]) {
    const min = standOff(size);
    assert.ok(min >= CLOSE.minDist);
    for (let x = -8; x <= 8; x += 0.5)
      for (let z = -8; z <= 8; z += 0.5) {
        holdOut(x, z, 0, 0, min, out);
        assert.ok(Math.hypot(out[0], out[1]) >= min * 0.5 - 1e-9, `${x},${z} -> ${out}`);
        assert.ok(out[1] < 0, 'held in front');
      }
  }
});
