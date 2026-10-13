import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrack } from './hyper/track';
import { TRACK_LIST } from './hyper/content';
import { noInput, SHIPS } from './hyper/sim';
import { bumpKarts, DRIFT_LEVELS, driftLevel, KART_H, newKart, stepKart } from './hyper/kart';
import { npgTrackDef } from './hyper/npgWorld';

for (const def0 of TRACK_LIST) {
  const def = npgTrackDef(def0);
  test(`npg racing ${def.id}: kart circuit closes, is shorter, and an autopilot kart laps it on the ground`, () => {
    const tr = buildTrack(def);
    const hover = buildTrack(def0);
    assert.ok(tr.len < hover.len * 0.8, `kart lap ${tr.len} vs hover ${hover.len}`);
    const dx = tr.px[0] - tr.px[tr.n - 1];
    const dy = tr.py[0] - tr.py[tr.n - 1];
    const dz = tr.pz[0] - tr.pz[tr.n - 1];
    assert.ok(Math.hypot(dx, dy, dz) < 6, 'seam');
    const k = newKart(0);
    const inp = noInput();
    const spec = SHIPS[1];
    let t = 0;
    let ground = 0;
    let steps = 0;
    while (k.S < tr.len && t < 400) {
      inp.throttle = 1;
      inp.steer = Math.max(-1, Math.min(1, -k.lat * 0.25 - k.vl * 0.12));
      stepKart(k, inp, spec, tr, 1 / 60);
      if (k.h < KART_H + 0.4) ground++;
      steps++;
      t += 1 / 60;
    }
    assert.ok(k.S >= tr.len, 'finished a lap');
    assert.ok(ground / steps > 0.68, `on the ground ${(ground / steps).toFixed(2)} of the time`);
    assert.equal(k.hp, 1, 'karts never break');
  });
}

test('kart drift: hold drift while steering to slide, release for a boost by charge level', () => {
  const tr = buildTrack(npgTrackDef(TRACK_LIST[0]));
  const k = newKart(0);
  const spec = SHIPS[1];
  const inp = noInput();
  inp.throttle = 1;
  for (let i = 0; i < 240; i++) stepKart(k, inp, spec, tr, 1 / 60);
  assert.ok(k.vs > 20, 'up to speed');
  assert.ok(k.vs <= spec.vmax * 0.5 * 1.28 + 1, 'kart top speed is half the hover ship (plus a pad boost)');
  // Drift key without steering does nothing.
  inp.boost = true;
  stepKart(k, inp, spec, tr, 1 / 60);
  assert.equal(k.drift, 0);
  // Steering + drift: hop in and slide right.
  inp.steer = 1;
  stepKart(k, inp, spec, tr, 1 / 60);
  assert.equal(k.drift, 1, 'drifting right');
  assert.ok(k.ev.roll, 'hop event');
  for (let i = 0; i < 120; i++) stepKart(k, inp, spec, tr, 1 / 60);
  assert.ok(k.driftT >= DRIFT_LEVELS[1] && k.driftT < DRIFT_LEVELS[2], `charge ${k.driftT.toFixed(2)} after 2 s of tight drift`);
  assert.equal(driftLevel(k.driftT), 2);
  assert.ok(k.yaw > 0.3, 'the kart points into the slide');
  // Release: level-2 boost.
  inp.boost = false;
  inp.steer = 0;
  const before = k.boostT;
  stepKart(k, inp, spec, tr, 1 / 60);
  assert.equal(k.drift, 0);
  assert.equal(k.driftLvl, 2);
  assert.ok(k.ev.rollBoost && k.boostT > before + 1, 'mini-boost on release');
});

test('kart drift is deterministic: two identical input streams produce identical state', () => {
  const tr = buildTrack(npgTrackDef(TRACK_LIST[1]));
  const spec = SHIPS[0];
  const run = () => {
    const k = newKart(0);
    const inp = noInput();
    for (let i = 0; i < 600; i++) {
      inp.throttle = 1;
      inp.steer = Math.sin(i / 40);
      inp.boost = i % 200 > 120;
      stepKart(k, inp, spec, tr, 1 / 60);
    }
    return [k.S, k.lat, k.vs, k.vl, k.h, k.driftT, k.boostT];
  };
  assert.deepEqual(run(), run());
});

test('bump-and-shove pushes both karts apart, no damage', () => {
  const a = { lat: 1, vl: 0, vs: 60 };
  const b = { lat: -1, vl: 0, vs: 60 };
  bumpKarts(a, b);
  assert.ok(a.vl > 0 && b.vl < 0);
  assert.ok(a.vs < 60 && b.vs < 60 && a.vs > 50);
});
