import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectAttemptOver, earlierPayCovers } from './payFlow';
import { playButton } from './playButton';
import { usdToSats } from './credit';

test('pay-after-connect survives while the connect is still running', () => {
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: true, busy: false, waiting: false }), false);
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: true, waiting: false }), false);
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: false, waiting: true }), false);
});

test('a connected wallet is not "over": the cabinet pays', () => {
  assert.equal(connectAttemptOver({ hasWallet: true, chooserOpen: false, busy: false, waiting: false }), false);
});

test('chooser closed, cancelled or failed with no wallet: the pay intent is dropped', () => {
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: false, waiting: false }), true);
});

test('the amount picked is the amount asked: an open $0.10 payment never stands in for a $1.00 press', () => {
  const bsv = 17.1;
  const dime = usdToSats(0.1, bsv)!;
  const dollar = usdToSats(1, bsv)!;
  assert.equal(earlierPayCovers(dime, dollar), false);
  assert.equal(earlierPayCovers(dollar, dime), false);
  assert.equal(earlierPayCovers(null, dollar), false);
});

test('a Retry of the same dollar amount after the price moved is the same request (never charged twice)', () => {
  const a = usdToSats(1, 17.1)!;
  const b = usdToSats(1, 17.3)!;
  assert.equal(earlierPayCovers(a, b), true);
  assert.equal(earlierPayCovers(a, a), true);
});

test('LOCK & LOAD says the exact amount once, with the rounds it buys; no "+ credit" sum', () => {
  const pb = playButton(0.1, 1, 0.1, 170_057);
  assert.equal(pb.label, 'LOCK & LOAD $1.00');
  assert.equal(pb.sub, 'about 170,000 rounds');
  assert.ok(!/credit/.test(`${pb.label} ${pb.sub}`));
});
