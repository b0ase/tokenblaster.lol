import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealBlast } from './leaderboard';

test('payment ids and score lines are not blasts', () => {
  assert.equal(isRealBlast('pay:23fe3871d93518d6'), false);
  assert.equal(isRealBlast('terrornode', '155090'), false);
  assert.equal(isRealBlast('sats', 'terrornode'), true);
  assert.equal(isRealBlast('d5ffbbfd_1', null), true);
  assert.equal(isRealBlast('', 'arena'), true);
});
