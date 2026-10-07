import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsLoaded, createActionQueue, SAT_COST } from './actionPay';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('practice: every action allowed, nothing fired', async () => {
  let fired = 0;
  const q = createActionQueue(
    'g',
    async (_t, _n, b) => {
      fired += b.length;
      return b.map(() => 'x');
    },
    { onSent: () => {}, onError: () => {}, onNeed: () => {} },
    () => 'out',
  );
  for (let i = 0; i < 100; i++) assert.equal(q.ask(['jump']), true);
  await tick();
  assert.equal(fired, 0);
});

test('live: one tx per action, batched, refused when out of ammo', async () => {
  const batches: string[][][] = [];
  let sent = 0;
  let need = false;
  const q = createActionQueue(
    'g',
    async (_t, _n, b) => {
      batches.push(b);
      return b.map((_, i) => `t${i}`);
    },
    { onSent: (n) => (sent = n), onError: () => {}, onNeed: (n) => (need = n) },
    () => 'out',
  );
  q.st.live = true;
  q.st.sats = SAT_COST * 50;
  let ok = 0;
  for (let i = 0; i < 60; i++) if (q.ask(['ping', String(i)])) ok++;
  assert.equal(ok, 50);
  assert.equal(need, true);
  await tick();
  assert.equal(sent, 50);
  assert.deepEqual(batches[0][0], ['g', 'ping', '0']);
  assert.equal(actionsLoaded({ tokens: true, sats: 1000, tokenAmmo: 3 }), 3);
});

test('live: a failed broadcast halts until resume', async () => {
  let err = '';
  const q = createActionQueue('g', async () => Promise.reject(new Error('arc down')), { onSent: () => {}, onError: (m) => (err = m), onNeed: () => {} }, () => 'out');
  q.st.live = true;
  q.st.sats = SAT_COST * 10;
  assert.equal(q.ask(['a']), true);
  await tick();
  assert.equal(err, 'arc down');
  assert.equal(q.ask(['a']), false);
  q.resume();
  assert.equal(q.ask(['a']), true);
});
