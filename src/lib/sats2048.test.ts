import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMove, move, type Tile } from './sats2048';

const t = (id: number, r: number, c: number, v: number): Tile => ({ id, r, c, v });
const none = () => 0.99; // deterministic spawn: last empty cell, value 4

test('slides to the wall and merges once per pair', () => {
  const r = move([t(1, 0, 0, 2), t(2, 0, 1, 2), t(3, 0, 2, 2), t(4, 0, 3, 2)], 'left', none);
  const live = r.tiles.filter((x) => !x.gone && !x.fresh).sort((a, b) => a.c - b.c);
  assert.deepEqual(live.map((x) => [x.c, x.v]), [[0, 4], [1, 4]]);
  assert.equal(r.gained, 8);
  assert.equal(r.tiles.filter((x) => x.gone).length, 2);
});

test('merge chain is not recursive (2,2,4 -> 4,4 not 8)', () => {
  const r = move([t(1, 0, 0, 2), t(2, 0, 1, 2), t(3, 0, 2, 4)], 'left', none);
  const live = r.tiles.filter((x) => !x.gone && !x.fresh).sort((a, b) => a.c - b.c);
  assert.deepEqual(live.map((x) => x.v), [4, 4]);
});

test('no move leaves the board untouched', () => {
  const tiles = [t(1, 0, 0, 2)];
  const r = move(tiles, 'left', none);
  assert.equal(r.moved, false);
  assert.equal(r.tiles, tiles);
});

test('down and right directions', () => {
  const d = move([t(1, 0, 1, 8), t(2, 1, 1, 8)], 'down', none);
  assert.deepEqual(d.tiles.filter((x) => !x.gone && !x.fresh).map((x) => [x.r, x.c, x.v]), [[3, 1, 16]]);
  const r = move([t(1, 2, 0, 2), t(2, 2, 1, 4)], 'right', none);
  assert.deepEqual(r.tiles.filter((x) => !x.fresh).map((x) => [x.c, x.v]).sort(), [[2, 2], [3, 4]]);
});

test('canMove detects a dead board', () => {
  const vals = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  const dead = vals.map((v, i) => t(i, Math.floor(i / 4), i % 4, v));
  assert.equal(canMove(dead), false);
  dead[15].v = 4;
  assert.equal(canMove(dead), true);
});

test('winning tile flagged', () => {
  const r = move([t(1, 0, 0, 1024), t(2, 0, 1, 1024)], 'left', none);
  assert.equal(r.won, true);
});
