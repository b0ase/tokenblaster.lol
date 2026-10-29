import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQUAD, hurtMate, keepClear, makeSquad, squadSlots, stepSquad, type SquadWorld } from './galleryGame/squad';

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
    assert.deepEqual(imports.filter((i) => !(i === 'three' || i.startsWith('three/examples/') || ['./squad', './squadBodies', './skinnedBox'].includes(i))), [], `${f} imports ${imports}`);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /pull\(|accept\(|broadcast|wallet|split|receipt/i);
  }
  // the engine applies AI shots straight to the robots, without the paid hooks
  const eng = readFileSync(new URL('./galleryGame/engine.ts', import.meta.url), 'utf8');
  const body = eng.slice(eng.indexOf('private tickSquad('), eng.indexOf('  dispose() {'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /hooks|accept\(|pull\(/);
});

test('formation: flanks ~3-7 m at 30-60 deg, far pair wider ahead; none in the 12 deg aim cone or within 2 m', () => {
  for (const [i, f] of SQUAD.formation.entries()) {
    const r = Math.hypot(f.x, f.z);
    const deg = (Math.atan2(Math.abs(f.x), -f.z) * 180) / Math.PI;
    assert.ok(deg > 12 && r > 2, `slot ${i}`);
    if (i < 2) assert.ok(r >= 3 && r <= 7 && deg >= 29.5 && deg <= 60, `flank ${i}: ${r} m ${deg} deg`);
    else assert.ok(-f.z > -SQUAD.formation[0].z && Math.abs(f.x) > Math.abs(SQUAD.formation[0].x), `far ${i}`);
  }
});

test('formation turns with the camera and the girls never enter the aim cone or personal space', () => {
  const sq = makeSquad(ROSTER, 'aika');
  for (const fwd of [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }]) {
    const w = world({ player: { x: 3, z: 4, fwd } });
    for (let t = 0; t < 10; t += 1 / 30) {
      stepSquad(sq, w, 1 / 30, () => 0.5);
      for (const m of sq) {
        const dx = m.x - 3;
        const dz = m.z - 4;
        const r = Math.hypot(dx, dz);
        const ahead = dx * fwd.x + dz * fwd.z;
        assert.ok(r >= SQUAD.minR - 1e-6, `${m.id} ${r}`);
        if (ahead > 0) assert.ok(Math.acos(Math.min(1, ahead / r)) >= SQUAD.clearCone - 1e-6, `${m.id} in cone`);
      }
    }
    for (const m of sq) {
      const dx = m.x - 3;
      const dz = m.z - 4;
      assert.ok(dx * fwd.x + dz * fwd.z > 2, `${m.id} settles ahead of the camera`);
    }
  }
});

test('keepClear: a girl dead on the crosshair or on top of the camera is pushed out', () => {
  const f = { x: 0, z: -1 };
  const a = keepClear(0, 0, f, 0, -5, 1);
  assert.ok(Math.abs(a.x) >= 5 * Math.tan(SQUAD.clearCone));
  const b = keepClear(0, 0, f, 0.1, 0, -1);
  assert.ok(Math.hypot(b.x, b.z) >= SQUAD.minR - 1e-9);
});

test('engaged girls turn to face their target', () => {
  const sq = makeSquad(ROSTER, 'aika');
  const w = world({ foes: [{ id: 'e1', x: 20, z: -2 }] });
  run(sq, w, 2);
  for (const m of sq) {
    assert.equal(m.target, 'e1');
    assert.ok(Math.abs(m.yaw - Math.atan2(20 - m.x, -(-2 - m.z))) < 1e-9);
  }
});
