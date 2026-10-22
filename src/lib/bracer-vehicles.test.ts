/** bRacer team vehicles (src/lib/hyper/vehicles): every body builds a full Rig, unknown ids fall back, claws are seeded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ALL_TEAMS, teamById } from './hyper/registry';
import { CORE_SHIPS } from './hyper/content';
import { hullFor } from './hyper/ships';
import * as V from './hyper/vehicles';
import { CLAW_LIMITS, CLAW_PRESETS, clawSpec } from './hyper/vehicles/claw';
import { B as RB, buildRider, RIDER_LIMBS, RIDER_MOUNT } from './hyper/vehicles/rider';

// Minimal DOM for the livery canvases (only touched when a rig is built): a 2D context that accepts every call.
const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };


type Rig = ReturnType<typeof V.buildVehicle>;
const livery = { base: '#f97316', accent: '#ffffff', trim: '#111111', ticker: '$TEST', number: '07', team: 'TEST', logo: null, decal: { text: 'bAcc', bg: '#f5b800', fg: '#010101' } };
const wedge = CORE_SHIPS.find((s) => s.id === 'wedge')!;

function assertRig(r: Rig, what: string) {
  assert.ok(r.root instanceof THREE.Group, `${what}: root`);
  assert.ok(r.tilt instanceof THREE.Group && r.tilt.parent === r.root, `${what}: tilt under root`);
  assert.ok(r.flame instanceof THREE.Mesh && r.flameMat instanceof THREE.MeshBasicMaterial, `${what}: flame`);
  assert.ok(r.glow instanceof THREE.Mesh, `${what}: glow`);
  assert.ok(r.shield instanceof THREE.Mesh && r.shield.visible === false, `${what}: shield hidden`);
  assert.ok(r.bodyMat instanceof THREE.MeshPhysicalMaterial && r.trimMat instanceof THREE.MeshBasicMaterial, `${what}: materials`);
  assert.ok(r.tex instanceof THREE.CanvasTexture && r.canvas, `${what}: livery texture`);
  assert.ok(r.engine.length >= 2 && r.engine.every((e) => e instanceof THREE.Vector3 && e.z < 0), `${what}: engines at the back`);
  assert.equal(typeof r.setLivery, 'function');
  assert.equal(typeof r.dispose, 'function');
  r.setLivery({ ...livery, number: '99' });
}

/** Ship-space size of everything the rig draws (shield excluded). */
function size(r: Rig) {
  r.shield.visible = false;
  r.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  r.tilt.traverse((o) => {
    if (o === r.shield || !(o instanceof THREE.Mesh)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
  });
  return box.getSize(new THREE.Vector3());
}

const usesStandardHull = (r: Rig) => {
  const body = hullFor(wedge).body;
  let hit = false;
  r.tilt.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry === body) hit = true;
  });
  return hit;
};

test('the three family teams race their own vehicles; everyone else keeps the standard ship', () => {
  const has = Object.fromEntries(ALL_TEAMS.filter((t) => t.vehicle).map((t) => [t.id, t.vehicle]));
  assert.deepEqual(has, { clawdex: 'claw', gitdex: 'paperplane', vexvoid: 'jetbike' });
  for (const t of ALL_TEAMS) if (t.vehicle) assert.ok(V.isVehicleId(t.vehicle), `${t.id}: ${t.vehicle} is registered`);
});

test('every team vehicle builds a complete Rig, not the standard hull, in a sane footprint', () => {
  const std = size(V.buildVehicle({}, wedge, livery, '#f97316'));
  for (const id of ['clawdex', 'vexvoid', 'gitdex']) {
    const t = teamById(id)!;
    for (const detail of ['low', 'high'] as const) {
      const r = V.buildVehicle({ vehicle: t.vehicle, detail }, wedge, livery, '#f97316');
      assertRig(r, `${id}/${detail}`);
      assert.equal(usesStandardHull(r), false, `${id} builds its own body`);
      const s = size(r);
      assert.ok(s.z > std.z * 0.75 && s.z < std.z * 1.45, `${id} length ${s.z.toFixed(2)} vs ${std.z.toFixed(2)}`);
      assert.ok(s.x > std.x * 0.45 && s.x < std.x * 1.4, `${id} span ${s.x.toFixed(2)} vs ${std.x.toFixed(2)}`);
      r.dispose();
    }
  }
});

test('unknown or missing vehicle ids fall back to the standard ship', () => {
  for (const vehicle of [undefined, null, '', 'hovercar', 'toString', '__proto__', 'constructor']) {
    const r = V.buildVehicle({ vehicle }, wedge, livery, '#f97316');
    assertRig(r, String(vehicle));
    assert.ok(usesStandardHull(r), `${String(vehicle)} -> standard hull`);
  }
});

test('claw presets: stable ids, all different, each builds, within the size limits', () => {
  const ids = CLAW_PRESETS.map((p) => p.preset);
  assert.ok(ids.length >= 4 && ids.length <= 8);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 6), ['grabber', 'nipper', 'crusher', 'needle', 'kingcrab', 'hydra'], 'preset ids are stable (collectibles key on them)');
  const shapes = new Set(CLAW_PRESETS.map((p) => `${p.arms}/${p.pincer}/${p.core}/${p.jets}`));
  assert.equal(shapes.size, ids.length, 'no two presets share arms + pincer + core + jets');
  const lengths: number[] = [];
  for (const p of CLAW_PRESETS) {
    const r = V.buildVehicle({ vehicle: 'claw', variant: p.preset }, wedge, livery, '#f97316');
    assertRig(r, p.preset);
    lengths.push(size(r).z);
  }
  assert.ok(Math.max(...lengths) / Math.min(...lengths) > 1.15, 'presets differ in size');
});

test('a claw is deterministic in (preset, seed); seed 0 is the preset; unknown presets fall back', () => {
  assert.deepEqual(clawSpec('crusher', 0), CLAW_PRESETS.find((p) => p.preset === 'crusher'));
  assert.deepEqual(clawSpec('crusher', 1234), clawSpec('crusher', 1234));
  assert.notDeepEqual(clawSpec('crusher', 1234), clawSpec('crusher', 1235));
  assert.equal(clawSpec('nope', 5).preset, CLAW_PRESETS[0].preset);
  assert.equal(clawSpec(undefined).preset, CLAW_PRESETS[0].preset);
  const within = (v: number, [a, b]: readonly [number, number]) => v >= a && v <= b;
  for (const p of CLAW_PRESETS) {
    for (let seed = 1; seed < 60; seed++) {
      const c = clawSpec(p.preset, seed * 7919);
      assert.equal(c.preset, p.preset);
      for (const k of ['arms', 'segments', 'armLen', 'armThick', 'coreSize', 'jets', 'scale', 'spread'] as const) assert.ok(within(c[k], CLAW_LIMITS[k]), `${p.preset}#${seed} ${k}=${c[k]}`);
      assert.match(c.tint, /^#[0-9a-f]{6}$/);
    }
  }
});

test('several claw racers on a grid all get different claws', () => {
  const picks = Array.from({ length: CLAW_PRESETS.length }, (_, n) => V.variantFor('claw', n));
  assert.equal(new Set(picks).size, CLAW_PRESETS.length);
  assert.equal(V.variantFor('jetbike', 3), undefined);
  assert.equal(V.variantFor(undefined, 0), undefined);
});

test('the jet-bike rider is one skinned mesh whose hands stay on the grips and feet on the pegs, leaning or not', () => {
  for (const [lean, boost] of [[0, 0], [0.5, 1], [-0.6, 0.3]]) {
    const r = buildRider(new THREE.MeshStandardMaterial(), 'high');
    r.pose(lean, boost, 1, 0);
    const bones = r.mesh.skeleton.bones;
    const endOf = (i: number, len: number) => new THREE.Vector3(0, 0, len).applyQuaternion(bones[i].quaternion).add(bones[i].position);
    const near = (a: THREE.Vector3, b: THREE.Vector3, what: string) => assert.ok(a.distanceTo(b) < 0.02, `${what} at lean ${lean}: off by ${a.distanceTo(b).toFixed(3)}`);
    for (const side of [1, -1]) {
      near(endOf(side > 0 ? RB.faL : RB.faR, RIDER_LIMBS.FA), new THREE.Vector3(side * RIDER_MOUNT.grip.x, RIDER_MOUNT.grip.y, RIDER_MOUNT.grip.z), 'hand');
      near(endOf(side > 0 ? RB.shL : RB.shR, RIDER_LIMBS.SH), new THREE.Vector3(side * RIDER_MOUNT.peg.x, RIDER_MOUNT.peg.y, RIDER_MOUNT.peg.z), 'foot');
    }
    // Leaning: the head moves toward the low side (positive lean = left side up, so the head goes right, -X).
    if (lean > 0) assert.ok(bones[RB.head].position.x < -0.05, 'rider leans into the turn');
  }
  const bike = V.buildVehicle({ vehicle: 'jetbike' }, wedge, livery, '#3f9bff');
  let skinned = 0;
  bike.tilt.traverse((o) => (skinned += (o as THREE.SkinnedMesh).isSkinnedMesh ? 1 : 0));
  assert.equal(skinned, 1, 'the bike carries exactly one rider');
});

test('claw details: rams on high detail only; per-racer seeds give different claws; own paper plane hides its dimensions', () => {
  const rams = (detail: 'low' | 'high') => {
    let n = 0;
    V.buildVehicle({ vehicle: 'claw', variant: 'hydra', detail }, wedge, livery, '#f97316').tilt.traverse((o) => (n += (o as THREE.InstancedMesh).isInstancedMesh ? 1 : 0));
    return n;
  };
  assert.equal(rams('high'), 2);
  assert.equal(rams('low'), 0);
  const a = size(V.buildVehicle({ vehicle: 'claw', variant: 'grabber', seed: V.seedOf('rival:1:abc') }, wedge, livery, '#f97316'));
  const b = size(V.buildVehicle({ vehicle: 'claw', variant: 'grabber', seed: V.seedOf('rival:2:def') }, wedge, livery, '#f97316'));
  assert.notDeepEqual(a.toArray().map((x) => x.toFixed(3)), b.toArray().map((x) => x.toFixed(3)), 'two seeded grabbers differ');
  assert.equal(V.seedOf('pilot:x'), V.seedOf('pilot:x'));
  const lines = (own: boolean) => {
    let vis = 0;
    V.buildVehicle({ vehicle: 'paperplane', own }, wedge, livery, '#f05032').tilt.traverse((o) => (vis += (o as THREE.LineSegments).isLineSegments && o.visible ? 1 : 0));
    return vis;
  };
  assert.equal(lines(false) - lines(true), 1, 'only the dimension lines hide');
});
