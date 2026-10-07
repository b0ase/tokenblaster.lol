import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrack } from './hyper/track';
import { TRACK_LIST } from './hyper/content';
import { newShip, noInput, SHIPS, stepShip } from './hyper/sim';

for (const def of TRACK_LIST) {
  test(`bracer ${def.id}: track closes and an autopilot laps it`, () => {
    const tr = buildTrack(def);
    assert.ok(tr.len > 4000 && tr.len < 12000, `length ${tr.len}`);
    // Closed: last sample is a step from the first.
    const dx = tr.px[0] - tr.px[tr.n - 1];
    const dy = tr.py[0] - tr.py[tr.n - 1];
    const dz = tr.pz[0] - tr.pz[tr.n - 1];
    assert.ok(Math.hypot(dx, dy, dz) < 6, 'seam');
    // Frames orthonormal.
    for (let i = 0; i < tr.n; i += 17) {
      const d = tr.tx[i] * tr.ux[i] + tr.ty[i] * tr.uy[i] + tr.tz[i] * tr.uz[i];
      assert.ok(Math.abs(d) < 1e-3);
    }
    const ship = newShip(0);
    const inp = noInput();
    const spec = SHIPS[1];
    let t = 0;
    let maxH = 0;
    while (ship.S < tr.len * 2 && t < 400) {
      inp.throttle = 1;
      inp.steer = Math.max(-1, Math.min(1, (-ship.lat * 0.25 - ship.vl * 0.12) * -1 * -1));
      stepShip(ship, inp, spec, tr, 1 / 60);
      maxH = Math.max(maxH, ship.h);
      t += 1 / 60;
    }
    console.log(def.id, 'len', Math.round(tr.len), '2 laps', t.toFixed(1), 's hits', ship.hits, 'maxH', maxH.toFixed(1));
    assert.ok(ship.S >= tr.len * 2, 'finished two laps');
  });
}
