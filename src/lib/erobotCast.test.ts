import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CAST, CLOSE, WEAPONS, holdOut, pickCast, standOff } from './galleryGame/cast';
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

test('fairness: low damage, telegraphed shots, close cap (PR #46)', () => {
  assert.ok(CLOSE.minDist >= 4);
  assert.ok(CLOSE.maxClose <= 3);
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

test('stand-off: no enemy rests under 4 m from the player (PR #46)', () => {
  assert.ok(-TUNING.erobots.melee.stopZ >= 4, 'melee plant depth');
  for (const st of TUNING.stages) assert.ok(-st.lane.stopZ[1] >= 4, 'shooter plant depth');
  const sz = TUNING.erobots.sizes;
  const out: [number, number] = [0, 0];
  for (const size of [sz.range[0], 1, sz.range[1], sz.heavy]) {
    const min = standOff(size);
    assert.ok(min >= 4);
    // a grid of resting spots all round the player, including on top of and behind them
    for (let x = -8; x <= 8; x += 0.5)
      for (let z = -8; z <= 8; z += 0.5) {
        holdOut(x, z, 0, 0, min, out);
        assert.ok(Math.hypot(out[0], out[1]) >= 4 - 1e-9, `${x},${z} -> ${out}`);
        assert.ok(out[1] < 0, 'held in front');
      }
  }
});
