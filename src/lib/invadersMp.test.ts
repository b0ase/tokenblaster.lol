import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvadersNet, PoseBuffer, claimBeats, hashSeed, mulberry32, validateInvCfg, type NetHandlers, type WaveMsg } from './invaders/mp';
import { formationSlots, waveSpec } from './invaders/sim';
import type { RaceInfo, RaceLink } from './racemp/session';
import type { InvCfg } from './invaders/mp';

test('seeded rng: same room + wave gives the same stream, other waves differ', () => {
  const a = mulberry32(hashSeed('room1') ^ 7);
  const b = mulberry32(hashSeed('room1') ^ 7);
  const c = mulberry32(hashSeed('room1') ^ 8);
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((v) => v >= 0 && v < 1));
});

test('formation: every client derives the same slots from (count, pattern)', () => {
  const spec = waveSpec(3, 20, false);
  const a = formationSlots(spec.count, spec.pattern).sort((p, q) => q.z - p.z || Math.abs(p.x) - Math.abs(q.x));
  const b = formationSlots(spec.count, spec.pattern).sort((p, q) => q.z - p.z || Math.abs(p.x) - Math.abs(q.x));
  assert.deepEqual(a, b);
});

test('pose buffer: interpolates between snapshots, extrapolates briefly, never NaN', () => {
  const b = new PoseBuffer();
  assert.equal(b.sample(1000), 0);
  b.push(1000, 0, 10);
  b.push(1100, 1, 10);
  assert.equal(b.sample(1105 + 0, 110), 0); // render time 995: before the first snapshot
  assert.ok(Math.abs(b.sample(1160, 110) - 0.5) < 1e-9); // render time 1050: halfway
  assert.ok(b.sample(5000, 110) <= 1 + 10 * 0.25 + 1e-9); // extrapolation capped
  b.push(900, 5, 0); // older than the last: ignored
  assert.equal(b.size, 2);
});

test('claims: earliest time wins, ties go to the lower id', () => {
  assert.ok(claimBeats({ by: 'b', t: 1 }, { by: 'a', t: 2 }));
  assert.ok(!claimBeats({ by: 'a', t: 2 }, { by: 'b', t: 1 }));
  assert.ok(claimBeats({ by: 'a', t: 5 }, { by: 'b', t: 5 }));
  assert.ok(!claimBeats({ by: 'b', t: 5 }, { by: 'a', t: 5 }));
});

test('cfg validation', () => {
  assert.deepEqual(validateInvCfg({ mode: 'coop' }), { mode: 'coop' });
  assert.deepEqual(validateInvCfg({ mode: 'versus' }), { mode: 'versus' });
  assert.equal(validateInvCfg({ mode: 'x' }), null);
  assert.equal(validateInvCfg(null), null);
});

// ── Two-client wiring over a fake room ──

type Log = { waves: WaveMsg[]; kills: { id: string; by: string; t: number }[]; bolts: number; hits: string[] };
function room(ids: string[]) {
  const links = new Map<string, RaceLink<InvCfg>>();
  const logs = new Map<string, Log>();
  const nets = new Map<string, InvadersNet>();
  const cfg: InvCfg = { mode: 'coop' };
  const race: RaceInfo<InvCfg> = { rid: 'abcd1234', ids, players: Object.fromEntries(ids.map((id) => [id, { name: id, vehicle: 'ship', team: '', x: id === 'a' ? 'alice' : 'bob_x' }])), cfg };
  for (const id of ids) {
    const link: RaceLink<InvCfg> = {
      id,
      race,
      on: null,
      send: (ev, p) => {
        for (const [oid, l] of links) if (oid !== id) l.on?.(ev, JSON.parse(JSON.stringify(p)));
      },
      humans: () => ids.length,
      finish: () => undefined,
      green: () => undefined,
    };
    links.set(id, link);
  }
  for (const id of ids) {
    const log: Log = { waves: [], kills: [], bolts: 0, hits: [] };
    logs.set(id, log);
    const h: NetHandlers = {
      onWave: (m) => log.waves.push(m),
      onSpawn: () => undefined,
      onBolts: (b) => (log.bolts += b.length),
      onHit: (hid) => log.hits.push(hid),
      onKill: (kid, c) => log.kills.push({ id: kid, by: c.by, t: c.t }),
      onBossHit: () => undefined,
      onBossKill: () => undefined,
      onForm: () => undefined,
      onVs: () => undefined,
      onPeers: () => undefined,
    };
    nets.set(id, new InvadersNet(links.get(id)!, race, h));
  }
  return { nets, logs, links, dispose: () => nets.forEach((n) => n.dispose()) };
}

const row = (id: string) => [id, 'payment', 250, 0, 0] as [string, string, number, 0, 0];

test('leader election: the first pilot on the grid leads, a silent leader is replaced', () => {
  const r = room(['a', 'b', 'c']);
  const a = r.nets.get('a')!;
  const b = r.nets.get('b')!;
  assert.ok(a.isLeader());
  assert.ok(!b.isLeader());
  const later = performance.now() + 10_000; // nobody heard for 10 s: "a" is gone for b
  assert.equal(b.leaderId(later), 'b');
  r.dispose();
});

test('wave manifest: guests get it once (resends are deduped), guests cannot publish one', () => {
  const r = room(['a', 'b']);
  const a = r.nets.get('a')!;
  const msg: WaveMsg = { n: 2, bl: 10, bd: 0, bp: null, t: [row('t1'), row('t2')] };
  a.sendWave(msg);
  a.sendWave(msg);
  assert.equal(r.logs.get('b')!.waves.length, 1);
  assert.equal(r.logs.get('b')!.waves[0].t.length, 2);
  r.nets.get('b')!.sendWave({ n: 3, bl: 0, bd: 0, bp: null, t: [row('x1')] }); // b is not the leader
  assert.equal(r.logs.get('a')!.waves.length, 0);
  r.dispose();
});

test('claims: both clients see both claims; the earlier one wins on each side; sanity filters drop junk', () => {
  const r = room(['a', 'b']);
  const a = r.nets.get('a')!;
  const b = r.nets.get('b')!;
  const now = Date.now();
  b.sendKill('tx1', now); // b first
  a.sendKill('tx1', now + 30); // a later
  const la = r.logs.get('a')!.kills;
  const lb = r.logs.get('b')!.kills;
  assert.equal(la.length, 1);
  assert.equal(lb.length, 1);
  // Wrong wave and stale clocks are ignored.
  a.wave = 9;
  b.sendKill('far', Date.now());
  assert.equal(la.length, 1);
  a.wave = 1;
  b.sendKill('old', Date.now() - 60_000);
  assert.equal(la.length, 1);
  // Rate limit: a burst far above the bucket is cut off.
  for (let i = 0; i < 300; i++) b.sendKill(`burst${i}`, Date.now());
  assert.ok(la.length < 150, `bucket should cap a flood, got ${la.length}`);
  r.dispose();
});

test('enemy bolts: only the leader may send them, guests receive the same list', () => {
  const r = room(['a', 'b']);
  const a = r.nets.get('a')!;
  const b = r.nets.get('b')!;
  a.queueBolt([1, 20, 0, -8, 0]);
  a.queueBolt([2, 20, 1, -8, 1]);
  a.tick(0.02, () => null);
  assert.equal(r.logs.get('b')!.bolts, 2);
  b.queueBolt([3, 20, 0, -8, 0]);
  b.tick(0.02, () => null); // b is not the leader: nothing leaves
  assert.equal(r.logs.get('a')!.bolts, 0);
  r.dispose();
});

test('versus: extra invaders reach only the targeted pilot', () => {
  const r = room(['a', 'b', 'c']);
  const got: Record<string, number> = { a: 0, b: 0, c: 0 };
  for (const id of ['a', 'b', 'c']) {
    const link = r.links.get(id)!;
    const prev = link.on!;
    link.on = (ev, p) => {
      if (ev === 'vs' && (p as { to?: string }).to === id) got[id] += 1;
      prev(ev, p);
    };
  }
  r.nets.get('a')!.sendVs('c', 2);
  assert.deepEqual(got, { a: 0, b: 0, c: 1 });
  r.dispose();
});
