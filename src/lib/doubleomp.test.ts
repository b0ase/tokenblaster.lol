import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanRoomCode, newRoomCode, pickSpawn, PoseBuffer, roomLink, roomName, Scores } from './doubleo/mp';

test('room codes and names', () => {
  assert.equal(cleanRoomCode(' AbC123 '), 'abc123');
  assert.equal(cleanRoomCode('a b'), null);
  assert.equal(cleanRoomCode('x'.repeat(30)), null);
  assert.equal(cleanRoomCode(5), null);
  assert.match(newRoomCode(), /^[a-z2-9]{6}$/);
  assert.equal(roomName('facility', 'coop', null), 'doubleokweg-facility');
  assert.equal(roomName('facility', 'dm', null), 'doubleokweg-facility-dm');
  assert.equal(roomName('tower', 'dm', 'abc123'), 'doubleokweg-tower-dm-p-abc123');
  assert.equal(roomLink('https://x', '/g', 'tower', 'dm', 'abc123'), 'https://x/g?room=abc123&mode=dm&m=tower');
});

test('PoseBuffer interpolates between snapshots and rejects junk', () => {
  const b = new PoseBuffer(100);
  assert.equal(b.push({ ts: 1000, x: 0, z: 0, yaw: 0 }, 1050), true);
  assert.equal(b.push({ ts: 1100, x: 1, z: 0, yaw: 0.5 }, 1150), true);
  assert.equal(b.push({ ts: 1100, x: 9, z: 9, yaw: 0 }, 1160), false); // not newer
  assert.equal(b.push({ ts: 1200, x: NaN, z: 0, yaw: 0 }, 1250), false);
  assert.equal(b.push({ ts: 1200, x: 2, z: 0, yaw: 1 }, 1250), true);
  // lag = 50, interp = 100 -> render time = now - 150. now 1300 -> t = 1150: halfway between ts 1100 and 1200.
  const s = b.sample(1300)!;
  assert.ok(Math.abs(s.x - 1.5) < 1e-9);
  assert.ok(Math.abs(s.yaw - 0.75) < 1e-9);
});

test('PoseBuffer snaps on teleports (respawn) and takes the short way round the yaw circle', () => {
  const b = new PoseBuffer(0);
  b.push({ ts: 1000, x: 0, z: 0, yaw: 3.0 }, 1000);
  b.push({ ts: 1100, x: 0.5, z: 0, yaw: -3.0 }, 1100);
  const mid = b.sample(1050)!;
  assert.ok(Math.abs(Math.abs(mid.yaw) - Math.PI) < 0.2, `yaw ${mid.yaw}`);
  b.push({ ts: 1200, x: 80, z: 40, yaw: 0 }, 1200);
  assert.equal(b.teleported, true);
  assert.equal(b.size, 1);
  assert.deepEqual(b.sample(1250), { x: 80, z: 40, yaw: 0 });
});

test('PoseBuffer extrapolates briefly, then holds', () => {
  const b = new PoseBuffer(0, 0.25);
  b.push({ ts: 1000, x: 0, z: 0, yaw: 0 }, 1000);
  b.push({ ts: 1100, x: 1, z: 0, yaw: 0 }, 1100);
  assert.ok(Math.abs(b.sample(1200)!.x - 2) < 1e-9); // 0.1 s late at 10 u/s
  assert.ok(Math.abs(b.sample(5000)!.x - 3.5) < 1e-9); // capped at 0.25 s
});

test('Scores: frag log is idempotent and merging order does not matter', () => {
  const a = new Scores();
  const b = new Scores();
  assert.equal(a.add({ key: 'bob#1', k: 'al', v: 'bob' }), true);
  assert.equal(a.add({ key: 'bob#1', k: 'al', v: 'bob' }), false);
  a.add({ key: 'al#1', k: 'bob', v: 'al' });
  a.add({ key: 'cy#1', k: null, v: 'cy' }); // bot / fall: a death, no kill
  assert.equal(b.merge(a.entries()).length, 3);
  assert.equal(b.merge(a.entries()).length, 0);
  for (const s of [a, b]) {
    assert.equal(s.kills('al'), 1);
    assert.equal(s.deaths('al'), 1);
    assert.equal(s.deaths('cy'), 1);
    assert.equal(s.kills('cy'), 0);
  }
  assert.equal(b.merge('nonsense').length, 0);
  assert.equal(b.merge([{ key: 5 }, null, { key: 'x'.repeat(99), v: 'a' }]).length, 0);
  assert.equal(a.winner(['al', 'bob', 'cy'], 2), null);
  a.add({ key: 'cy#2', k: 'al', v: 'cy' });
  assert.equal(a.winner(['al', 'bob', 'cy'], 2), 'al');
  assert.deepEqual(a.rank(['bob', 'al']).map((r) => r.id), ['al', 'bob']);
});

test('pickSpawn prefers cells far from other players', () => {
  const cells: [number, number][] = [[0, 0], [100, 100]];
  let r = 0;
  const rand = () => (r++ % 2) / 2; // alternates cell 0 / 1
  assert.deepEqual(pickSpawn(cells, [[1, 1]], rand), [100, 100]);
  assert.equal(pickSpawn([], [], rand), null);
});
