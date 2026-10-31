import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGame, corsHeaders, gameTags, parseQuery, parseTime, toItem } from './blastsRecent';

const q = (s: string) => parseQuery(new URLSearchParams(s));

test('limit defaults to 50, caps at 200, ignores junk', () => {
  assert.equal(q('').limit, 50);
  assert.equal(q('limit=10').limit, 10);
  assert.equal(q('limit=999').limit, 200);
  assert.equal(q('limit=0').limit, 50);
  assert.equal(q('limit=abc').limit, 50);
});

test('since/before accept ISO or epoch ms, else null', () => {
  assert.equal(parseTime('1761868800000'), '2025-10-31T00:00:00.000Z');
  assert.equal(parseTime('2026-10-31T12:00:00Z'), '2026-10-31T12:00:00.000Z');
  assert.equal(parseTime('nope'), null);
  assert.equal(q('since=2026-10-31T12:00:00Z').since, '2026-10-31T12:00:00.000Z');
});

test('game filter is lowercased and validated', () => {
  assert.equal(q('game=TerrorNode').game, 'terrornode');
  assert.equal(q("game=x';drop").game, null);
  assert.equal(q('').game, null);
});

test('legacy gallery maps to terrornode both ways', () => {
  assert.equal(canonicalGame('gallery'), 'terrornode');
  assert.equal(canonicalGame('snake'), 'snake');
  assert.deepEqual(gameTags('terrornode'), ['terrornode', 'gallery']);
  assert.deepEqual(gameTags('snake'), ['snake']);
  assert.equal(gameTags(null), null);
  const it = toItem({ txid: 'ab', token: 'sats', n: 3, game: 'gallery', seen_at: '2026-10-31T12:00:00.123456+00:00', block_height: null });
  assert.deepEqual(it, { txid: 'ab', game: 'terrornode', ammo: 'sats', n: 3, player: null, seenAt: '2026-10-31T12:00:00.123Z', blockHeight: null });
});

test('CORS only for bChatX and tokenblaster origins', () => {
  for (const o of ['https://www.bchatx.com', 'https://bchatx.com', 'https://www.tokenblaster.lol'])
    assert.equal(corsHeaders(o)['Access-Control-Allow-Origin'], o);
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders(null)['Access-Control-Allow-Origin'], undefined);
});
