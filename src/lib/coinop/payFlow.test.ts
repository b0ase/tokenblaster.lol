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

// ONE payment dialog (owner, 31 Oct 2026: two dialogs, and "approve in your wallet" before the wallet was asked).
import { payDialogView, payStep, showWaitingCard, type PayStep } from './payFlow';

test('the step follows the payment: check → connect → approve → paid, approve only once the request is sent', () => {
  const w = (step?: 'check' | 'connect' | 'approve' | 'paid') => ({ text: 'x', since: 0, kind: 'pay' as const, step });
  assert.equal(payStep(null, null), 'prepare');
  assert.equal(payStep(w('check'), 'prepare'), 'check');
  assert.equal(payStep(w('connect'), 'check'), 'connect');
  assert.equal(payStep(w('approve'), 'connect'), 'approve');
  assert.equal(payStep(w('paid'), 'approve'), 'paid');
  // The gap between the wallet's answer and the game starting stays "Paid", never back to "getting ready".
  assert.equal(payStep(null, 'paid'), 'paid');
  // A connect wait is not a payment step.
  assert.equal(payStep({ text: 'x', since: 0, kind: 'connect' }, null), 'prepare');
});

test('wallet words ("approve") appear only in the approve step', () => {
  const steps: PayStep[] = ['prepare', 'check', 'connect', 'approve', 'paid'];
  for (const s of steps) {
    const v = payDialogView(s, 'bWalletX');
    const asks = /approve/i.test(v.title + v.body);
    assert.equal(asks, s === 'approve', `step ${s}: ${v.title} / ${v.body}`);
  }
  assert.equal(payDialogView('check', 'bWalletX').body, 'Checking your last payment… so you are never charged twice.');
  assert.match(payDialogView('check', 'bWalletX').note ?? '', /If bWalletX already paid, your money is in your game credit: you won't be charged twice/);
  assert.equal(payDialogView('paid', 'bWalletX').body, 'Paid. Loading your gun…');
  assert.equal(payDialogView('paid', 'bWalletX').cancel, false, 'no Cancel once paid');
});

test('exactly one payment surface: the bottom card hides while the cabinet dialog shows a payment', () => {
  for (const step of ['check', 'connect', 'approve', 'paid'] as const) {
    const pay = { text: 'x', since: 0, kind: 'pay' as const, step };
    assert.equal(showWaitingCard(pay, 1), false, `${step}: dialog open, card hidden`);
    assert.equal(showWaitingCard(pay, 0), true, `${step}: no dialog on the page, the card is the one surface`);
  }
  // Connect / discovery waits are not payments: still shown.
  assert.equal(showWaitingCard({ text: 'x', since: 0, kind: 'connect' }, 1), true);
  assert.equal(showWaitingCard(null, 0), false);
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
