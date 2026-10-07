import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimBook, ROUND_SECS, claimPoints, planRound, planTx, type Claim } from './bsvgun/versus';

const IDS = ['aaa', 'bbb', 'ccc'];
const claim = (n: number, i: string, t: number, extra: Partial<Claim> = {}): Claim => ({ n, i, t, d: 30, b: 0, m: 1, ...extra });

test('plan is identical for the same room and differs between rooms', () => {
  const a = planRound('r1xy', 3);
  const b = planRound('r1xy', 3);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map((e) => e.seed), planRound('other', 3).map((e) => e.seed));
  assert.ok(planRound('r1xy', 8).length > planRound('r1xy', 1).length, 'more shooters, denser stream');
  assert.ok(a.every((e, i) => e.i === i && (i === 0 || a[i - 1].t <= e.t) && e.t < ROUND_SECS));
  assert.ok(a.some((e) => e.kind === 'whale') && a.some((e) => e.kind === 'block'));
  assert.deepEqual(planTx(a[5]), planTx(a[5]));
});

test('earliest claim wins whatever the arrival order', () => {
  const plan = planRound('r2', 3);
  const n = 4;
  const t0 = plan[n].t + 0.5;
  const cs = [claim(n, 'bbb', t0 + 0.2), claim(n, 'aaa', t0 + 0.05), claim(n, 'ccc', t0 + 0.4)];
  const totals = new Set<string>();
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [2, 0, 1]]) {
    const book = new ClaimBook(plan, IDS);
    for (const k of order) {
      const v = book.validate(cs[k], t0 + 5);
      assert.ok(v);
      book.add(v);
    }
    assert.equal(book.winners.get(n)?.i, 'aaa');
    totals.add(JSON.stringify([...book.totals()]));
  }
  assert.equal(totals.size, 1, 'every client ends with the same scoreboard');
});

test('exact ties go to the lower player id; duplicates are ignored', () => {
  const plan = planRound('r3', 2);
  const t = plan[2].t + 0.3;
  const x = new ClaimBook(plan, IDS);
  const y = new ClaimBook(plan, IDS);
  x.add(claim(2, 'ccc', t));
  x.add(claim(2, 'bbb', t));
  y.add(claim(2, 'bbb', t));
  y.add(claim(2, 'ccc', t));
  assert.equal(x.winners.get(2)?.i, 'bbb');
  assert.equal(y.winners.get(2)?.i, 'bbb');
  assert.equal(x.add(claim(2, 'bbb', t)), 'dup');
});

test('a late earlier claim takes the target over and moves the points', () => {
  const plan = planRound('r4', 2);
  const book = new ClaimBook(plan, IDS);
  const t = plan[3].t + 1;
  assert.equal(book.add(claim(3, 'bbb', t + 0.3)), 'new');
  const before = book.totals().get('bbb')!.score;
  assert.ok(before > 0);
  assert.equal(book.add(claim(3, 'aaa', t)), 'won');
  assert.equal(book.totals().get('bbb')!.score, 0);
  assert.equal(book.totals().get('aaa')!.score, before);
});

test('sanity checks refuse bad claims', () => {
  const plan = planRound('r5', 3);
  const book = new ClaimBook(plan, IDS);
  const ok = plan[6].t + 0.5;
  assert.ok(book.validate(claim(6, 'aaa', ok), ok + 1));
  assert.equal(book.validate(claim(6, 'zzz', ok), ok + 1), null, 'unknown shooter');
  assert.equal(book.validate(claim(9999, 'aaa', ok), ok + 1), null, 'no such target');
  assert.equal(book.validate(claim(6, 'aaa', ok + 60), ok + 100), null, 'after it left');
  assert.equal(book.validate(claim(6, 'aaa', plan[6].t - 5), ok + 1), null, 'before it existed');
  assert.equal(book.validate(claim(6, 'aaa', ok + 5), ok), null, 'from the future');
  assert.equal(book.validate(claim(6, 'aaa', ok, { m: 99 }), ok + 1), null, 'multiplier out of range');
  assert.equal(book.validate(claim(6, 'aaa', ok, { d: 1e6 }), ok + 1), null, 'impossible range');
  assert.equal(book.validate({ n: 6, i: 'aaa', t: NaN, d: 1, b: 0, m: 1 }, ok + 1), null);
  assert.equal(book.validate({ n: 6, i: 'aaa', t: ok, d: 1, b: 2, m: 1 }, ok + 1), null);
  // Rate: with 30 kills already inside one second, the next is refused.
  for (let k = 0; k < 30; k++) book.all.set(`${1000 + k}|bbb`, claim(1000 + k, 'bbb', ok));
  assert.equal(book.validate(claim(6, 'bbb', ok + 0.1), ok + 1), null, 'implausible rate');
  assert.ok(book.validate(claim(6, 'ccc', ok + 0.1), ok + 1), 'other shooters unaffected');
});

test('points: distance, bullseye and multiplier count, flock bonus', () => {
  const plan = planRound('r6', 2);
  const flock = plan.find((e) => e.flock)!;
  const plain = plan.find((e) => !e.flock && e.kind === 'payment')!;
  const base = claimPoints(plain, claim(plain.i, 'aaa', 1, { d: 0 }));
  assert.equal(base, 100);
  assert.equal(claimPoints(plain, claim(plain.i, 'aaa', 1, { d: 90, m: 2, b: 1 })), 600);
  assert.ok(claimPoints(flock, claim(flock.i, 'aaa', 1, { d: 0 })) > base);
});
