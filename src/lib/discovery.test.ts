import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldProbeLocal } from './discovery';

test('local wallet probe: skipped when a browser wallet is injected and no CLI wallet was ever seen', () => {
  assert.equal(shouldProbeLocal({ seen: false, query: '', injected: true }), false);
});
test('local wallet probe: runs once a CLI wallet was seen, on ?wallet=cli, or with no injected wallet', () => {
  assert.equal(shouldProbeLocal({ seen: true, query: '', injected: true }), true);
  assert.equal(shouldProbeLocal({ seen: false, query: '?wallet=cli', injected: true }), true);
  assert.equal(shouldProbeLocal({ seen: false, query: '?x=1&wallet=cli', injected: true }), true);
  assert.equal(shouldProbeLocal({ seen: false, query: '?wallet=yours', injected: true }), false);
  assert.equal(shouldProbeLocal({ seen: false, query: '', injected: false }), true);
});
