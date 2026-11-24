/**
 * TERRORNODE takes no payment while its revenue split can't be paid (24 Nov 2026: the split was checked only after the
 * wallet had paid, so a player could pay and get "Payments temporarily unavailable"). The cabinet's payment path
 * (useCabinet doPay) asks `canPay` before it connects or bills the wallet, and the gallery passes the split check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cabinet = readFileSync(new URL('../components/coinop/useCabinet.ts', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../components/gallery/ShootingGallery.tsx', import.meta.url), 'utf8');

test('the cabinet asks canPay before it connects or bills the wallet', () => {
  const pay = cabinet.slice(cabinet.indexOf('const doPay = useCallback'));
  const check = pay.indexOf('canPay()');
  assert.ok(check > 0, 'doPay never calls canPay');
  assert.ok(check < pay.indexOf('b.connectWallet()'), 'canPay must come before connecting');
  assert.ok(check < pay.indexOf('b.load('), 'canPay must come before the payment');
});

test('TERRORNODE solo gates payment on the revenue split, and never promises free practice', () => {
  assert.match(gallery, /useCabinet\(b, 'TerrorNode', \{ dry, canPay: splitAvailable \}\)/);
  assert.doesNotMatch(gallery, /free practice still works/i);
});
