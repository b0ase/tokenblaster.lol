import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkAll, ROOT } from '../../scripts/content-lib';
import { validateShipPack, validateTrackPack } from './content/schema';
import { SCORE_GAMES } from './scores';
import { SHIPS, TRACK_LIST } from './hyper/content';

const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('content: every pack in the repo passes content:check', () => {
  const { errors } = checkAll();
  assert.deepEqual(errors, []);
});

test('content: registry has the launch circuits, the example pack and the core hulls', () => {
  assert.deepEqual(TRACK_LIST.slice(0, 3).map((t) => t.id), ['canyon', 'spiral', 'void']);
  assert.ok(TRACK_LIST.some((t) => t.id === 'mempool-loop' && !t.core && t.licence === 'CC0'));
  assert.deepEqual(SHIPS.slice(0, 3).map((s) => s.id), ['needle', 'wedge', 'manta']);
});

test('content: score boards derive from track slugs', () => {
  for (const t of TRACK_LIST) {
    assert.equal(SCORE_GAMES[`bracer-${t.id}`].tag, 'bracer');
    assert.equal(SCORE_GAMES[`bracer-${t.id}-hc`].tag, 'bracer-hc');
  }
  assert.equal(SCORE_GAMES['bracer-canyon'].title, 'bRacer · Genesis Canyon');
});

test('content: schema rejects bad licences, URLs, out-of-range stats and unknown fields', () => {
  const t = read('content/bracer/tracks/mempool-loop/track.json');
  const bad = { ...t, licence: 'GPL-3.0', description: 'see https://example.com', colour: 'red', features: { ...t.features, loops: [{ at: 3, radius: 500, shift: 0 }] } };
  const r = validateTrackPack(bad);
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  assert.match(all, /licence must be one of/);
  assert.match(all, /must not contain a URL/);
  assert.match(all, /colour is not a known field/);
  assert.match(all, /loops\[0\]\.radius must be between 40 and 90/);
  const s = read('content/bracer/ships/wedge/ship.json');
  const rs = validateShipPack({ ...s, stats: { vmax: 182, accel: 54, turn: 90, grip: 3.1 } });
  assert.equal(rs.ok, false);
  assert.match(rs.errors.join('\n'), /over budget/);
  assert.equal(validateShipPack({ ...s, licence: 'CC-BY-4.0' }).ok, false, 'CC-BY needs a credit');
});

test('content: content:check catches a deliberately broken pack folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-content-'));
  try {
    const cp = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
    };
    cp('content/bracer/tracks/mempool-loop/track.json');
    cp('content/bracer/ships/wedge/ship.json');
    assert.deepEqual(checkAll(tmp, { index: false }).errors, [], 'clean copy passes');
    // Break it: a bad track, a stray file, an oversized fake model, a malformed ship.
    const dir = path.join(tmp, 'content/bracer/tracks/Broken_Pack');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'track.json'), JSON.stringify({ ...read('content/bracer/tracks/mempool-loop/track.json'), licence: 'All rights reserved' }));
    fs.writeFileSync(path.join(dir, 'music.mp3'), 'x');
    const sd = path.join(tmp, 'content/bracer/ships/fake-glb');
    fs.mkdirSync(sd);
    fs.writeFileSync(path.join(sd, 'ship.json'), '{ not json');
    fs.writeFileSync(path.join(sd, 'model.glb'), Buffer.alloc(2 * 1024 * 1024));
    const { errors } = checkAll(tmp, { index: false });
    const all = errors.join('\n');
    assert.match(all, /Broken_Pack: folder name must be/);
    assert.match(all, /music\.mp3: unexpected file/);
    assert.match(all, /licence must be one of/);
    assert.match(all, /fake-glb\/ship\.json: is not valid JSON/);
    assert.match(all, /model\.glb: 2048 KB is over the 1536 KB limit/);
    assert.match(all, /model\.glb: is not a binary glTF/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
