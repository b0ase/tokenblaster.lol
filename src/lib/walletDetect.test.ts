import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBwalletxOrigin, walletPresence, type DetectSignals } from './walletDetect';

const none: DetectSignals = { cwi: false, announced: false, inAppUa: false, appFrame: false, bwalletxParent: false, phone: false };

test('desktop with nothing injected: none (GET bWALLET)', () => assert.equal(walletPresence(none), 'none'));
test('phone with nothing: unknown (Sign in + Get link)', () => assert.equal(walletPresence({ ...none, phone: true }), 'unknown'));
test('any wallet signal: installed', () => {
  for (const k of ['cwi', 'announced', 'inAppUa', 'appFrame', 'bwalletxParent'] as const) {
    assert.equal(walletPresence({ ...none, phone: true, [k]: true }), 'installed', k);
    assert.equal(walletPresence({ ...none, [k]: true }), 'installed', k);
  }
});
test('bwalletx origins', () => {
  assert.ok(isBwalletxOrigin('https://web.bwalletx.com'));
  assert.ok(isBwalletxOrigin('https://bwalletx.com/'));
  assert.ok(!isBwalletxOrigin('https://bwalletx.com.evil.io'));
  assert.ok(!isBwalletxOrigin('http://web.bwalletx.com'));
});
