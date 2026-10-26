import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleRelease, PAUSE_RELEASE_MS, HIDDEN_RELEASE_MS } from './gun';

test('a paused storm releases the gun after PAUSE_RELEASE_MS', () => {
  const idle = idleRelease();
  assert.equal(idle(true, false, 1000), false);
  assert.equal(idle(true, false, 1000 + PAUSE_RELEASE_MS - 1), false);
  assert.equal(idle(true, false, 1000 + PAUSE_RELEASE_MS), true);
});

test('firing again resets the idle clock', () => {
  const idle = idleRelease();
  idle(true, false, 0);
  assert.equal(idle(false, false, PAUSE_RELEASE_MS - 10), false);
  assert.equal(idle(true, false, PAUSE_RELEASE_MS), false);
});

test('a hidden tab releases quickly once paused, never while still sending', () => {
  const idle = idleRelease();
  assert.equal(idle(false, true, 0), false);
  assert.equal(idle(false, true, 60_000), false);
  assert.equal(idle(true, true, 60_000), false);
  assert.equal(idle(true, true, 60_000 + HIDDEN_RELEASE_MS), true);
});
