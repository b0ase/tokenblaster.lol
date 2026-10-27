import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP, DEFAULT_ROSTER, NEUTRAL, BASE, WEAPONS, allowedWeapons, elementsOfCard, isNpgMap, modsFor, normalizePick, ownedFrom, statsFor } from './npgLoadout';

test('default roster: 4-6 NPG girls, each with a starter pair she is allowed to hold', () => {
  assert.ok(DEFAULT_ROSTER.length >= 4 && DEFAULT_ROSTER.length <= 6);
  for (const g of DEFAULT_ROSTER) {
    assert.ok(g.right && g.left, `${g.id} has both hands`);
    assert.ok(allowedWeapons(g, 'right').some((w) => w.id === g.right));
    assert.ok(allowedWeapons(g, 'left').some((w) => w.id === g.left));
    assert.ok(g.parts.some((p) => p.layer === '21-Body'), `${g.id} has a body`);
  }
  assert.ok(WEAPONS.filter((w) => w.hand === 'right').length >= 30);
});

test('allowed weapons: no other girl’s or Erobot signature pieces unless owned', () => {
  const aika = DEFAULT_ROSTER.find((g) => g.id === 'aika')!;
  const list = allowedWeapons(aika, 'right');
  assert.ok(list.every((w) => !w.owner || w.owner === 'Aika'));
  assert.ok(list.every((w) => w.team !== 'Erobot' || w.owner === 'Aika'));
  const erobot = WEAPONS.find((w) => w.hand === 'right' && w.team === 'Erobot' && w.owner)!;
  assert.ok(!list.includes(erobot));
  assert.ok(allowedWeapons(aika, 'right', new Set([erobot.id])).includes(erobot));
  // an unowned off-limits weapon falls back to her starter
  assert.notEqual(normalizePick({ girl: 'aika', right: erobot.id }).right, erobot.id);
  assert.equal(normalizePick({ girl: 'aika', right: erobot.id }, new Set([erobot.id])).right, erobot.id);
});

test('stat mapping: baseline is neutral, each modifier stays within ±CAP and moves the right way', () => {
  assert.deepEqual(modsFor({ ...BASE }), NEUTRAL);
  const hi = modsFor({ strength: 99, speed: 99, skill: 99, stamina: 99, stealth: 99, style: 99 });
  assert.deepEqual(hi, { damage: 1 + CAP, speed: 1 + CAP, spread: 1 - CAP, hp: 1 + CAP, incoming: 1 - CAP, score: 1 + CAP });
  const lo = modsFor({ strength: 0, speed: 0, skill: 0, stamina: 0, stealth: 0, style: 0 });
  for (const v of Object.values(lo)) assert.ok(v >= 1 - CAP && v <= 1 + CAP);
  for (const g of DEFAULT_ROSTER) for (const v of Object.values(modsFor(statsFor({ girl: g.id, right: g.right, left: g.left })))) assert.ok(Math.abs(v - 1) <= CAP + 1e-9);
});

test('normalizePick: junk → first girl with her starters', () => {
  const p = normalizePick({ girl: 'nobody', right: 'zz', left: null });
  assert.equal(p.girl, DEFAULT_ROSTER[0].id);
  assert.equal(p.right, DEFAULT_ROSTER[0].right);
  assert.equal(p.left, DEFAULT_ROSTER[0].left);
});

test('ownership parsing: NPG MAP + card bodies → unlocked weapons and girls', () => {
  assert.equal(isNpgMap({ app: 'npg', type: 'ord', npgType: 'part' }), 'part');
  assert.equal(isNpgMap({ app: 'npg', type: 'ord', npgType: 'stack' }), 'stack');
  assert.equal(isNpgMap({ app: 'npg', type: 'element-master' }), null);
  assert.equal(isNpgMap({ app: 'tokenblaster', npgType: 'part' }), null);
  assert.equal(isNpgMap(null), null);
  assert.deepEqual(elementsOfCard({ type: 'part', elementId: '07_003', layer: '07-Right-Weapon' }), ['07_003']);
  assert.deepEqual(elementsOfCard({ type: 'part', elementId: 'bad' }), []);
  const body = DEFAULT_ROSTER[1].parts.find((p) => p.layer === '21-Body')!.id;
  const stack = { type: 'stack', partLayers: [{ layer: '21-Body', elementId: body }, { layer: '08-Left-Weapon', elementId: '08_005' }, { layer: 'x', elementId: 7 }] };
  assert.deepEqual(elementsOfCard(stack), [body, '08_005']);
  assert.deepEqual(elementsOfCard('nope'), []);
  const o = ownedFrom([elementsOfCard(stack), ['07_003']], 1);
  assert.ok(o.elements.has('07_003') && o.elements.has('08_005'));
  assert.deepEqual([...o.girls], [DEFAULT_ROSTER[1].id]);
  assert.equal(o.stacks, 1);
});
