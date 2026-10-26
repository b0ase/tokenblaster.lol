import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVE_TIMEOUT_MS, raceApproval, retryDecision } from './approveTimeout';

const later = <T,>() => {
  let ok!: (v: T) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => ((ok = a), (no = b)));
  return { p, ok, no };
};

test('approval wait is 20 s', () => assert.equal(APPROVE_TIMEOUT_MS, 20_000));

test('an answer in time is returned as paid', async () => {
  const r = await raceApproval(Promise.resolve('tx'), 50);
  assert.deepEqual(r, { kind: 'paid', value: 'tx' });
});

test('a refusal in time is thrown', async () => {
  await assert.rejects(raceApproval(Promise.reject(new Error('cancelled')), 50), /cancelled/);
});

test('timeout → retry: first request never paid → cancel it, then re-send', async () => {
  const req = later<string>();
  const r = await raceApproval(req.p, 10);
  assert.equal(r.kind, 'timeout');
  if (r.kind !== 'timeout') return;
  let cancelled = 0;
  const out = await retryDecision(r.late, {
    paidOnChain: async () => false,
    cancelHung: () => {
      cancelled++;
      req.no(new Error('WALLET_TIMEOUT'));
    },
  });
  assert.equal(cancelled, 1);
  assert.equal(out, 'resend');
});

test('late resolution after timeout → honoured, retry sends nothing (no second charge)', async () => {
  const req = later<string>();
  const late: string[] = [];
  const r = await raceApproval(req.p, 10, (v) => late.push(v));
  assert.equal(r.kind, 'timeout');
  if (r.kind !== 'timeout') return;
  req.ok('tx-late');
  await r.late.done;
  assert.deepEqual(late, ['tx-late']);
  let chainReads = 0;
  let cancels = 0;
  const out = await retryDecision(r.late, { paidOnChain: async () => (chainReads++, false), cancelHung: () => cancels++ });
  assert.equal(out, 'paid');
  assert.equal(chainReads, 0);
  assert.equal(cancels, 0);
});

test('retry: chain shows the first payment landed → paid, no re-send', async () => {
  const req = later<string>();
  const r = await raceApproval(req.p, 10);
  if (r.kind !== 'timeout') return assert.fail('expected timeout');
  let cancels = 0;
  const out = await retryDecision(r.late, { paidOnChain: async () => true, cancelHung: () => cancels++ });
  assert.equal(out, 'paid');
  assert.equal(cancels, 1);
});

test('retry: balance unreadable → unknown, never re-sends', async () => {
  const req = later<string>();
  const r = await raceApproval(req.p, 10);
  if (r.kind !== 'timeout') return assert.fail('expected timeout');
  let cancels = 0;
  const out = await retryDecision(r.late, { paidOnChain: async () => null, cancelHung: () => cancels++ });
  assert.equal(out, 'unknown');
  assert.equal(cancels, 0);
});

test('retry: request pays in the instant it is cancelled → paid, no re-send', async () => {
  const req = later<string>();
  const r = await raceApproval(req.p, 10);
  if (r.kind !== 'timeout') return assert.fail('expected timeout');
  const out = await retryDecision(r.late, { paidOnChain: async () => false, cancelHung: () => req.ok('tx') });
  assert.equal(out, 'paid');
});
