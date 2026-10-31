import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_SECONDS, demoChipText, demoInit, demoMayPay, demoReduce, playDecision } from './demo';

test('the clock waits for the run to start, then counts down to over', () => {
  let s = demoInit(3);
  s = demoReduce(s, 'tick');
  assert.equal(s.phase, 'waiting');
  assert.equal(s.left, 3, 'menus and intros do not eat the demo');
  assert.match(demoChipText(s), /starts when you play/);
  s = demoReduce(s, 'play');
  assert.equal(s.phase, 'running');
  s = demoReduce(demoReduce(s, 'tick'), 'tick');
  assert.equal(demoChipText(s), 'DEMO · 1s');
  s = demoReduce(s, 'tick');
  assert.equal(s.phase, 'over');
  assert.equal(demoReduce(s, 'tick').left, 0);
  assert.equal(demoReduce(s, 'play').phase, 'over', 'a late PLAY does not restart it');
});

test('"Try the demo again" resets to a fresh waiting demo', () => {
  const s = demoReduce(demoReduce(demoInit(), 'play'), 'tick');
  assert.deepEqual(demoReduce(s, 'again'), demoInit(DEMO_SECONDS));
});

test('a demo run never pays: PLAY is unpaid even with paid plays waiting', () => {
  assert.equal(playDecision({ demo: true, prepaid: 0 }), 'demo');
  assert.equal(playDecision({ demo: true, prepaid: 3 }), 'demo');
  assert.equal(playDecision({ demo: false, prepaid: 1 }), 'prepaid');
  assert.equal(playDecision({ demo: false, prepaid: 0 }), 'pay');
  assert.equal(demoMayPay(true), false);
  assert.equal(demoMayPay(false), true);
});

test('demo mode keeps its no-pay / no-score guards wired in', () => {
  const insert = readFileSync(new URL('../../components/InsertCoin.tsx', import.meta.url), 'utf8');
  assert.match(insert, /playDecision\(/);
  assert.match(insert, /demoMayPay\(coinStore\.demo\(\)\)/);
  const scores = readFileSync(new URL('../../components/HighScores.tsx', import.meta.url), 'utf8');
  assert.match(scores, /if \(demo \|\| !props\.live\)/);
});

test('the demo overlay never freezes the page or blocks page-wide input', () => {
  const src = readFileSync(new URL('../../components/coinop/DemoOverlay.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /window\.requestAnimationFrame\s*=/);
  assert.doesNotMatch(src, /capture:\s*true/);
  assert.doesNotMatch(src, /stopImmediatePropagation/);
});
