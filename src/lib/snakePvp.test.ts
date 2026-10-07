/**
 * Token Snake PvP, headless: three clients in one room on an in-memory broadcast bus, each with a stub wallet (records
 * calls, never signs or broadcasts). Wiring mirrors TokenSnake + SnakeArena: presence carries `gun`, the victim's
 * engine reports onKilled(did, by) once and broadcasts the death 3x, the shell pays through src/lib/pvpPay.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arenaSend, createKillPay, createPvpQueue, hitMsg, type HitMsg, type PvpShot } from './pvpPay';
import { cleanGun } from './snake/arenaNet';
import { BOOST_DROP, BOOST_ORB_V, boostOrbId, HALF, readBoostOrb } from './snake/arenaSim';

type Msg = { ev: string; p: Record<string, unknown> };
function makeBus() {
  const subs: ((m: Msg) => void)[] = [];
  return { sub: (f: (m: Msg) => void) => subs.push(f), send: (m: Msg) => subs.forEach((f) => f(m)) };
}

function client(id: string, gun: string, bus: ReturnType<typeof makeBus>, mode: { live: boolean; tok: boolean }) {
  const calls: { fn: string; to?: string; extras: string[][] }[] = [];
  const toasts: string[] = [];
  const wallet = {
    fireBatch: async (_n: number, extras: string[][]) => {
      calls.push({ fn: 'fireBatch', extras });
      return extras.map((_, i) => `${id}-b${i}`);
    },
    fireTokens: async (_n: number, extras: string[][], to?: string) => {
      calls.push({ fn: 'fireTokens', to, extras });
      return extras.map((_, i) => `${id}-t${i}`);
    },
  };
  const roster = new Map<string, string | undefined>(); // presence: id -> gun
  const q = createPvpQueue({
    maxRun: 25,
    retries: 0,
    emptyMsg: 'Out of ammo: load more to keep playing.',
    send: (n, batch, to) => arenaSend(wallet, mode.tok, n, batch.map((x) => x.extra), to),
    onPaid: (txids, _b, _to, target) => {
      if (target && txids.length) bus.send({ ev: 'h', p: { ...hitMsg(target, id, txids, mode.tok, { sym: 'BSVGUN', icon: null }), i: id } });
    },
    onFail: () => {},
  });
  const kp = createKillPay({
    game: 'snake',
    live: () => mode.live && mode.tok,
    push: (s: PvpShot) => {
      q.push(s);
      void q.drain();
    },
  });
  bus.sub(({ ev, p }) => {
    if (ev === 'presence') roster.set(String(p.id), cleanGun(p.gun));
    // Belt and braces: even if a client fed every received death into the payer, `did` dedupes it.
    if (ev === 'd' && p.i === id && typeof p.by === 'string') kp.onKilled(String(p.did), p.by, roster.get(p.by));
    if (ev === 'h' && p.to === id) toasts.push(`+${(p as unknown as HitMsg).n} $${(p as unknown as HitMsg).sym}`);
  });
  return {
    id,
    gun,
    calls,
    toasts,
    q,
    join: () => bus.send({ ev: 'presence', p: { id, gun } }),
    /** The engine's die(): onKilled once, the death message 3x (best effort). */
    die(life: number, by: string) {
      const did = `${id}.${life}`;
      kp.onKilled(did, by, roster.get(by));
      for (let i = 0; i < 3; i++) bus.send({ ev: 'd', p: { i: id, did, l: life, by, cause: 'cut' } });
    },
  };
}

const GUNS = { a: '1AaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaA', b: '1BbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbB', c: '1CccccccccccccccccccccccccccccccccC' };
const settle = () => new Promise((r) => setTimeout(r, 10));

test('3 clients, LIVE tokens: one payment per death, to the killer gun, killer told once', async () => {
  const bus = makeBus();
  const mode = { live: true, tok: true };
  const [a, b, c] = [client('a', GUNS.a, bus, mode), client('b', GUNS.b, bus, mode), client('c', GUNS.c, bus, mode)];
  for (const x of [a, b, c]) x.join();
  a.die(1, 'b'); // b cut off a
  a.die(1, 'b'); // a duplicate report of the same death
  c.die(1, 'b'); // b cut off c too
  a.die(2, 'c'); // a's next life: c cut it off
  await settle();
  assert.deepEqual(a.calls, [
    { fn: 'fireTokens', to: GUNS.b, extras: [['snake', 'player', 'b']] },
    { fn: 'fireTokens', to: GUNS.c, extras: [['snake', 'player', 'c']] },
  ]);
  assert.deepEqual(c.calls, [{ fn: 'fireTokens', to: GUNS.b, extras: [['snake', 'player', 'b']] }]);
  assert.deepEqual(b.calls, []); // killers pay nothing
  assert.deepEqual(b.toasts, ['+1 $BSVGUN', '+1 $BSVGUN']);
  assert.deepEqual(c.toasts, ['+1 $BSVGUN']);
});

test('practice and sats mode send nothing to the killer (the Arena only pays players in token mode)', async () => {
  for (const mode of [
    { live: false, tok: true },
    { live: true, tok: false },
  ]) {
    const bus = makeBus();
    const [a, b] = [client('a', GUNS.a, bus, mode), client('b', GUNS.b, bus, mode)];
    a.join();
    b.join();
    a.die(1, 'b');
    await settle();
    assert.deepEqual(a.calls, []);
  }
});

test('no gun in presence (or a junk one): nothing paid', async () => {
  const bus = makeBus();
  const mode = { live: true, tok: true };
  const a = client('a', GUNS.a, bus, mode);
  const b = client('b', 'not-an-address', bus, mode);
  a.join();
  b.join();
  a.die(1, 'b');
  await settle();
  assert.deepEqual(a.calls, []);
});

test('boost orbs: owner-scoped ids, validated like corpse orbs', () => {
  const id = boostOrbId('abc', 3);
  assert.equal(id, 'abc.b3');
  const ok = readBoostOrb('abc', { c: id, x: 1, z: 2, v: BOOST_ORB_V }, 0xff, 10);
  assert.deepEqual(ok, { id, x: 1, z: 2, v: BOOST_ORB_V, col: 0xff, born: 10 });
  assert.equal(readBoostOrb('evil', { c: id, x: 1, z: 2, v: 1 }, 0, 0), null); // not the sender's orb
  assert.equal(readBoostOrb('abc', { c: id, x: HALF + 5, z: 0 }, 0, 0), null);
  assert.equal(readBoostOrb('abc', { c: id, x: 0, z: 0, v: 1e9 }, 0, 0)?.v, BOOST_DROP);
  assert.ok(BOOST_ORB_V < BOOST_DROP); // dropping orbs never creates mass
});
