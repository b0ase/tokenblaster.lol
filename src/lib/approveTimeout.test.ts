import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVE_TIMEOUT_MS, isPromptNoResponse, raceApproval, retryDecision } from './approveTimeout';

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

for (const [code, status] of [['ERR_PROMPT_NOT_SHOWN', 503], ['ERR_PROMPT_EXPIRED', 408], ['ERR_PROMPT_BUSY', 409]] as const) {
  test(`${code} (${status}) → "didn't respond" at once, Retry checks the chain then re-sends`, async () => {
    const err = Object.assign(new Error('bWalletX: prompt'), { code, status });
    const t0 = Date.now();
    const r = await raceApproval(Promise.reject(err), 10_000);
    assert.ok(Date.now() - t0 < 1000, 'not after our 20 s timer');
    assert.equal(r.kind, 'timeout');
    if (r.kind !== 'timeout') return;
    assert.equal(r.late.state, 'failed');
    let checked = 0;
    const out = await retryDecision(r.late, { paidOnChain: async () => (checked++, false), cancelHung: () => assert.fail('nothing hung') });
    assert.equal(checked, 1);
    assert.equal(out, 'resend');
    // paid on chain anyway → never charged twice
    assert.equal(await retryDecision(r.late, { paidOnChain: async () => true, cancelHung: () => undefined }), 'paid');
  });
  test(`${code} detected from code, status+message or message alone`, () => {
    assert.ok(isPromptNoResponse({ code }));
    assert.ok(isPromptNoResponse(new Error(`createAction failed: ${code}`)));
    assert.ok(isPromptNoResponse({ status, message: 'Prompt not answered' }));
  });
}

test('a real refusal is still thrown, not shown as "didn\'t respond"', async () => {
  assert.equal(isPromptNoResponse(new Error('User denied the request')), false);
  assert.equal(isPromptNoResponse({ status: 503, message: 'service unavailable' }), false);
  await assert.rejects(raceApproval(Promise.reject(new Error('User denied')), 50), /denied/);
});

for (const [code, status] of [
  ['ERR_WALLET_NOT_READY', 503],
  ['ERR_FUNDING_TIMEOUT', 504],
  ['ERR_WALLET_LOCKED_TIMEOUT', 408],
] as const) {
  test(`${code} (${status}) counts as "didn't respond"`, async () => {
    assert.equal(isPromptNoResponse({ code, status }), true);
    assert.equal(isPromptNoResponse(new Error(`createAction failed: ${code}`)), true);
    const r = await raceApproval(Promise.reject({ code, status, message: 'x' }), 5_000);
    assert.equal(r.kind, 'timeout');
    if (r.kind === 'timeout') {
      assert.equal(r.late.state, 'failed');
      // Retry keeps the paid-check: a chain payment means no re-send.
      assert.equal(await retryDecision(r.late, { paidOnChain: async () => true, cancelHung: () => undefined }), 'paid');
      assert.equal(await retryDecision(r.late, { paidOnChain: async () => false, cancelHung: () => undefined }), 'resend');
    }
  });
}

test('an unrelated 504 is still a failure', () => assert.equal(isPromptNoResponse({ status: 504, message: 'gateway' }), false));
