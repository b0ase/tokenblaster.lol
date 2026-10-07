import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProof, PROOF_WINDOW_MIN, proofMinute, proofSession, readProof, VERIFY_WINDOW_DAYS, verifySession } from './xproof';

const key = '02' + 'ab'.repeat(32);
const sig = Array.from({ length: 71 }, (_, i) => i);

test('a proof is bound to kind, game, what was submitted and a minute', () => {
  assert.equal(proofSession('score', 'snake', '120-33.5', 7), 'tb:score:snake:120-33.5:7');
  assert.notEqual(proofSession('score', 'snake', '120-33.5', 7), proofSession('score', 'snake', '121-33.5', 7));
  assert.notEqual(proofSession('score', 'snake', 'x', 7), proofSession('tx', 'snake', 'x', 7));
});

test('readProof accepts only well-formed proofs', () => {
  assert.deepEqual(readProof({ k: key, s: sig, m: 5 }), { k: key, s: sig, m: 5 });
  assert.equal(readProof(null), null);
  assert.equal(readProof({ k: 'nope', s: sig, m: 5 }), null);
  assert.equal(readProof({ k: key, s: [1, 999], m: 5 }), null);
  assert.equal(readProof({ k: key, s: sig, m: 1.5 }), null);
  assert.equal(readProof({ k: key, s: new Array(81).fill(1), m: 5 }), null);
});

test('checkProof refuses stale, future, malformed and handle-less proofs before any network call', async () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  const m = proofMinute(now);
  assert.equal(await checkProof('alice', { k: key, s: sig, m: m - PROOF_WINDOW_MIN - 1 }, 'score', 'snake', '1-2', now), false);
  assert.equal(await checkProof('alice', { k: key, s: sig, m: m + PROOF_WINDOW_MIN + 1 }, 'score', 'snake', '1-2', now), false);
  assert.equal(await checkProof('not a handle', { k: key, s: sig, m }, 'score', 'snake', '1-2', now), false);
  assert.equal(await checkProof('alice', undefined, 'score', 'snake', '1-2', now), false);
});

test('a cached VERIFY proof (v: 1) is handle-only and lasts VERIFY_WINDOW_DAYS', async () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  const m = proofMinute(now);
  assert.equal(verifySession(7), 'tb:id:7');
  assert.deepEqual(readProof({ k: key, s: sig, m, v: 1 }), { k: key, s: sig, m, v: 1 });
  const tooOld = m - VERIFY_WINDOW_DAYS * 24 * 60 - 1;
  assert.equal(await checkProof('alice', { k: key, s: sig, m: tooOld, v: 1 }, 'score', 'snake', '1-2', now), false);
  assert.equal(await checkProof('alice', { k: key, s: sig, m: m + PROOF_WINDOW_MIN + 1, v: 1 }, 'score', 'snake', '1-2', now), false);
});
