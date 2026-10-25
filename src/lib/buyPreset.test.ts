import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBuyUsd, presetBsv } from './buyPreset';

test('parseBuyUsd: plain dollar amounts', () => {
  assert.equal(parseBuyUsd('5'), 5);
  assert.equal(parseBuyUsd('$10'), 10);
  assert.equal(parseBuyUsd('12.50'), 12.5);
  assert.equal(parseBuyUsd(['50', '100']), 50);
});

test('parseBuyUsd: junk, zero and huge are ignored', () => {
  for (const v of [null, undefined, '', '0', '-5', 'abc', '1e3', '5.555', '20000']) assert.equal(parseBuyUsd(v as string), null, String(v));
});

test('presetBsv: converts at the rate and clamps to one buy', () => {
  assert.equal(presetBsv(10, 50), '0.2');
  assert.equal(presetBsv(5, 40), '0.125');
  assert.equal(presetBsv(0.001, 50), '0.0001'); // MIN_BUY
  assert.equal(presetBsv(5000, 1), '20'); // MAX_BUY
  assert.equal(presetBsv(10, 0), null);
});
