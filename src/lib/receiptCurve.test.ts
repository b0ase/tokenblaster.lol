import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptCurveView, receiptPrice } from './launch/receiptCurve';

test('receipt curve: linear 1 → 200 sats across 1B, graduation at 10M', () => {
  const v = receiptCurveView(397_600);
  assert.equal(v.low, 1);
  assert.equal(v.top, 200);
  assert.equal(v.supply, 1_000_000_000);
  assert.equal(v.graduateAt, 10_000_000);
  assert.equal(v.toGraduation, 9_602_400);
  assert.ok(Math.abs(v.progress - 0.03976) < 1e-9);
  assert.equal(v.graduated, false);
  assert.equal(v.nextSats, 2); // 1 + 199 × 397600 / 999999999 ≈ 1.079, rounded up
  assert.equal(receiptPrice(1), 1);
  assert.equal(receiptPrice(1_000_000_000), 200);
  assert.ok(Math.abs(v.priceAtGraduation - 2.99) < 0.001);
});

test('receipt curve: clamps and graduates', () => {
  assert.equal(receiptCurveView(10_000_000).graduated, true);
  assert.equal(receiptCurveView(10_000_000).progress, 1);
  assert.equal(receiptCurveView(0).nextSats, 1);
  assert.equal(receiptCurveView(2e9).nextSats, null);
});
