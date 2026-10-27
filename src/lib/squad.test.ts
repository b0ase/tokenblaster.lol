import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQUAD, hurtMate, makeSquad, squadSlots, stepSquad, type SquadWorld } from './galleryGame/squad';

const ROSTER = ['aika', 'ayumi', 'kimiko', 'nao', 'kazuyo'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
const world = (o: Partial<SquadWorld> = {}): SquadWorld => ({ player: { x: 0, z: 0 }, foes: [], kweg: null, act: 1, playerDps: 100, ...o });
const run = (mates: ReturnType<typeof makeSquad>, w: SquadWorld, secs: number, dt = 1 / 30) => {
  const shots = [];
  for (let t = 0; t < secs; t += dt) shots.push(...stepSquad(mates, w, dt, () => 0.5));
  return shots;
};

test('solo: the four girls you did not pick are AI, all labelled ai', () => {
  const sq = makeSquad(ROSTER, 'nao');
  assert.equal(sq.length, 4);
  assert.ok(!sq.some((m) => m.id === 'nao'));
  assert.ok(sq.every((m) => m.ai));
});

test('team: humans keep their slots, AI fills only the empty NPG slots', () => {
  const s = squadSlots(ROSTER, [{ girl: 'aika' }, { girl: 'kazuyo' }]);
  assert.deepEqual(s.filter((x) => x.ai).map((x) => x.girl.id), ['ayumi', 'kimiko', 'nao']);
  assert.equal(squadSlots(ROSTER, ROSTER.map((g) => ({ girl: g.id }))).filter((x) => x.ai).length, 0);
});

test('follow: with nothing in view they close on their formation slot round the player', () => {
  const sq = makeSquad(ROSTER, 'aika');
  for (const m of sq) {
    m.x = 30;
    m.z = 30;
  }
  const w = world({ player: { x: 5, z: -20 } });
  run(sq, w, 12);
  for (const m of sq) {
    assert.equal(m.state, 'follow');
    const f = SQUAD.formation[m.slot];
    assert.ok(Math.hypot(m.x - (5 + f.x), m.z - (-20 + f.z)) < 1.6, `${m.id} at ${m.x},${m.z}`);
  }
});

test('engage: they shoot erobotz in range for a modest share of the player damage', () => {
  const sq = makeSquad(ROSTER, 'aika');
  const shots = run(sq, world({ foes: [{ id: 'e1', x: 0, z: -20 }] }), 3);
  assert.ok(sq.every((m) => m.state === 'engage' && m.target === 'e1'));
  assert.ok(shots.length > 0);
  // the four girls together deal ~35-50% of the player's DPS: the player still makes most kills
  const dps = shots.reduce((a, s) => a + s.dmg, 0) / 3;
  assert.ok(dps >= 35 && dps <= 50, `squad dps ${dps}`);
  // out of range: no shots
  const sq2 = makeSquad(ROSTER, 'aika');
  assert.equal(run(sq2, world({ foes: [{ id: 'far', x: 0, z: -200 }] }), 3).length, 0);
});

test('protect Kweg: in Act 2 they prioritise erobotz attacking Dr Wong over a nearer one', () => {
  const sq = makeSquad(ROSTER, 'aika');
  const foes = [
    { id: 'near', x: 0, z: -6 },
    { id: 'onKweg', x: 1, z: -24, onKweg: true },
  ];
  run(sq, world({ act: 2, kweg: { x: 0, z: -25 }, foes }), 1);
  assert.ok(sq.every((m) => m.state === 'protect' && m.target === 'onKweg'));
  // Act 1: just the nearest
  const sq1 = makeSquad(ROSTER, 'aika');
  run(sq1, world({ act: 1, kweg: { x: 0, z: -25 }, foes }), 1);
  assert.ok(sq1.every((m) => m.target === 'near'));
});

test('downed: a girl goes down at 0 hp, holds no fire, and is back up after ~10 s (never dies)', () => {
  const sq = makeSquad(ROSTER, 'aika');
  const m = sq[0];
  hurtMate(m, 999);
  assert.equal(m.state, 'downed');
  const w = world({ foes: [{ id: 'e1', x: 0, z: -15 }] });
  const shots = run([m], w, SQUAD.downSecs - 0.5);
  assert.equal(shots.length, 0);
  assert.equal(m.state, 'downed');
  run([m], w, 1);
  assert.notEqual(m.state, 'downed');
  assert.ok(m.hp > 0);
  // bites take damage
  const b = makeSquad(ROSTER, 'aika')[0];
  run([b], world({ foes: [{ id: 'bite', x: b.x, z: b.z }] }), 1);
  assert.ok(b.hp < SQUAD.hp);
});

test('no payment from AI shots: the squad never touches wallet / pay / broadcast / split code', () => {
  for (const f of ['squad.ts', 'squadView.ts', 'squadBodies.ts']) {
    const src = readFileSync(new URL(`./galleryGame/${f}`, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual(imports.filter((i) => !(i === 'three' || i.startsWith('three/examples/') || ['./squad', './squadBodies'].includes(i))), [], `${f} imports ${imports}`);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /pull\(|accept\(|broadcast|wallet|split|receipt/i);
  }
  // the engine applies AI shots straight to the robots, without the paid hooks
  const eng = readFileSync(new URL('./galleryGame/engine.ts', import.meta.url), 'utf8');
  const body = eng.slice(eng.indexOf('private tickSquad('), eng.indexOf('  dispose() {'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /hooks|accept\(|pull\(/);
});
