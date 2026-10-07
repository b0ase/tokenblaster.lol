import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARENA_BATCH, arenaSend, createKillPay, createPvpQueue, hitMsg, isEmptyGun, leadingRun, type PvpShot } from './pvpPay';

// A mocked gun: records every call, never signs or broadcasts anything.
type Call = { fn: 'fireBatch' | 'fireTokens'; startN: number; extras: string[][]; to?: string };
function mockGun(opts: { tokens?: number; failTimes?: number; failMsg?: string } = {}) {
  const calls: Call[] = [];
  let left = opts.tokens ?? Infinity;
  let fails = opts.failTimes ?? 0;
  let k = 0;
  const pay = (extras: string[][]) => {
    if (fails > 0) {
      fails--;
      throw new Error(opts.failMsg ?? 'ARC timeout');
    }
    const n = Math.max(0, Math.min(extras.length, left));
    left -= n;
    return extras.slice(0, n).map(() => `tx${++k}`);
  };
  return {
    calls,
    fireBatch: async (startN: number, extras: string[][]) => {
      calls.push({ fn: 'fireBatch', startN, extras });
      return pay(extras);
    },
    fireTokens: async (startN: number, extras: string[][], to?: string) => {
      calls.push({ fn: 'fireTokens', startN, extras, to });
      return pay(extras);
    },
  };
}

/** The Arena's drain exactly as it was inline in src/components/Arena.tsx before the extraction (sleep injected). */
function legacyArena(live: { tokenMode: boolean; fireBatch: (n: number, e: string[][]) => Promise<string[]>; fireTokens: (n: number, e: string[][], to?: string) => Promise<string[]> }, tk: { sym: string; icon: string | null }, log: unknown[]) {
  const BATCH = 50;
  const room = { broadcast: (ev: string, p: unknown) => log.push(['bc', ev, p]) };
  let n = 0;
  type Shot = { extra: string[]; to?: string; target?: string };
  const queue: Shot[] = [];
  let draining = false;
  let fails = 0;
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) {
      let run = 1;
      while (run < queue.length && run < BATCH && queue[run].to === queue[0].to) run++;
      const batch = queue.slice(0, run);
      const to = batch[0].to;
      const target = batch[0].target;
      try {
        const extras = batch.map((q) => q.extra);
        const txids = await (live.tokenMode ? live.fireTokens(n + 1, extras.slice(0, 25), to) : live.fireBatch(n + 1, extras));
        if (target && txids.length && room) {
          room.broadcast('hit', { to: target, from: 'me', n: txids.length, tokens: live.tokenMode, sym: tk?.sym, icon: tk?.icon, txid: txids[txids.length - 1] });
        }
        n += txids.length;
        queue.splice(0, txids.length);
        log.push(['paid', txids.length]);
        fails = 0;
        if (!txids.length) throw new Error('Out of ammo.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const empty = /out of|empty|no tokens|no sats|load/i.test(msg);
        if (!empty && ++fails <= 3) {
          await Promise.resolve();
          continue;
        }
        fails = 0;
        queue.length = 0;
        log.push(['fail', msg]);
        break;
      }
    }
    draining = false;
  };
  return { queue, drain };
}

/** The same game wiring, now through the shared module (what Arena.tsx does). */
function moduleArena(live: Parameters<typeof legacyArena>[0], tk: { sym: string; icon: string | null }, log: unknown[]) {
  const room = { broadcast: (ev: string, p: unknown) => log.push(['bc', ev, p]) };
  return createPvpQueue({
    maxRun: ARENA_BATCH,
    retries: 3,
    emptyMsg: 'Out of ammo.',
    wait: () => Promise.resolve(),
    send: (startN, batch, to) => arenaSend(live, live.tokenMode, startN, batch.map((q) => q.extra), to),
    onPaid: (txids, _b, _to, target) => {
      if (target && txids.length && room) room.broadcast('hit', hitMsg(target, 'me', txids, live.tokenMode, tk));
      log.push(['paid', txids.length]);
    },
    onFail: (msg) => log.push(['fail', msg]),
  });
}

const shots = (): PvpShot[] => [
  { extra: ['arena', 'miss'] },
  { extra: ['arena', 'kill'] },
  ...Array.from({ length: 30 }, () => ({ extra: ['arena', 'player', 'bob'], to: '1BobGun', target: 'bob' })),
  { extra: ['arena', 'hit'] },
  { extra: ['arena', 'player', 'cat'], to: '1CatGun', target: 'cat' },
  ...Array.from({ length: 60 }, () => ({ extra: ['arena', 'miss'] })),
];

async function compare(tokenMode: boolean, gunOpts: Parameters<typeof mockGun>[0]) {
  const tk = { sym: 'BSVGUN', icon: 'ic' };
  const gA = mockGun(gunOpts);
  const gB = mockGun(gunOpts);
  const logA: unknown[] = [];
  const logB: unknown[] = [];
  const a = legacyArena({ tokenMode, ...gA }, tk, logA);
  const b = moduleArena({ tokenMode, ...gB }, tk, logB);
  for (const s of shots()) {
    a.queue.push(s);
    b.push(s);
  }
  await a.drain();
  await b.drain();
  assert.deepEqual(gB.calls, gA.calls, 'same wallet calls (fn, startN, extras, recipient)');
  assert.deepEqual(logB, logA, 'same hit broadcasts / outcomes');
  assert.equal(b.queue.length, a.queue.length);
  return gA.calls;
}

test('Arena old vs new: token mode, identical calls, recipients and hit messages', async () => {
  const calls = await compare(true, {});
  // the rule itself: hits on bob go to bob's gun, 25 per request; misses burn (to undefined)
  assert.deepEqual(
    calls.map((c) => [c.fn, c.startN, c.extras.length, c.to]),
    [
      ['fireTokens', 1, 2, undefined],
      ['fireTokens', 3, 25, '1BobGun'],
      ['fireTokens', 28, 5, '1BobGun'],
      ['fireTokens', 33, 1, undefined],
      ['fireTokens', 34, 1, '1CatGun'],
      ['fireTokens', 35, 25, undefined],
      ['fireTokens', 60, 25, undefined],
      ['fireTokens', 85, 10, undefined],
    ],
  );
});

test('Arena old vs new: sats mode (plain blasts, nothing to the target)', async () => {
  const calls = await compare(false, {});
  assert.ok(calls.every((c) => c.fn === 'fireBatch' && c.to === undefined));
  assert.deepEqual(
    calls.map((c) => c.extras.length),
    [2, 30, 1, 1, 50, 10],
  );
});

test('Arena old vs new: empty gun mid-queue stops and clears', async () => {
  await compare(true, { tokens: 20 });
});

test('Arena old vs new: transient errors retry 3x then give up; empty-gun errors stop at once', async () => {
  await compare(true, { failTimes: 2 });
  await compare(true, { failTimes: 10 });
  await compare(false, { failTimes: 1, failMsg: 'No sats left: load more' });
});

test('helpers', () => {
  assert.equal(leadingRun([], 5), 0);
  assert.equal(leadingRun([{ to: 'a' }, { to: 'a' }, { to: 'b' }], 50), 2);
  assert.equal(leadingRun([{}, {}, {}], 2), 2);
  assert.ok(isEmptyGun('Out of ammo.') && isEmptyGun('no tokens') && !isEmptyGun('ARC 503'));
  assert.deepEqual(hitMsg('bob', 'me', ['t1', 't2'], true, { sym: 'X', icon: null }), { to: 'bob', from: 'me', n: 2, tokens: true, sym: 'X', icon: null, txid: 't2' });
});

test('reset restarts the tag counter and drops queued shots', async () => {
  const g = mockGun();
  const q = createPvpQueue({ maxRun: 50, retries: 0, emptyMsg: 'Out of ammo.', send: (n, b, to) => arenaSend(g, true, n, b.map((x) => x.extra), to), onPaid: () => {}, onFail: () => {} });
  q.push({ extra: ['a'] });
  await q.drain();
  q.reset();
  q.push({ extra: ['b'] });
  await q.drain();
  assert.deepEqual(
    g.calls.map((c) => c.startN),
    [1, 1],
  );
});

test('kill pay: one shot per death id, practice sends nothing, no gun no pay', () => {
  const pushed: PvpShot[] = [];
  let live = true;
  const kp = createKillPay({ game: 'snake', push: (s) => pushed.push(s), live: () => live });
  // the death is broadcast 3x and also seen locally: only the first counts
  assert.equal(kp.onKilled('me.1', 'bob', '1BobGun'), true);
  assert.equal(kp.onKilled('me.1', 'bob', '1BobGun'), false);
  assert.equal(kp.onKilled('me.1', 'bob', '1BobGun'), false);
  assert.deepEqual(pushed, [{ extra: ['snake', 'player', 'bob'], to: '1BobGun', target: 'bob' }]);
  assert.equal(kp.onKilled('me.2', null, undefined), false); // wall / self
  assert.equal(kp.onKilled('me.3', 'cat', undefined), false); // killer has no gun in presence
  live = false;
  assert.equal(kp.onKilled('me.4', 'bob', '1BobGun'), false); // practice
  assert.equal(pushed.length, 1);
});
