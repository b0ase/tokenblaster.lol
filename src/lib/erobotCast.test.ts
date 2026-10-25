import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CAST, CLOSE, WEAPONS, pickCast } from './galleryGame/cast';
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
