import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnBlastpad, tokenHref } from './tokenLinks';
import { GAME_COINS } from './gameCoins';
import { OUR_TOKENS, ourTokenByTicker } from './ourTokens';

const TN = 'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1';

test('BlastPad coins link to /launch, not 1sat.market', () => {
  assert.deepEqual(tokenHref(GAME_COINS.arena.id), { href: `/launch/${GAME_COINS.arena.id}`, external: false });
  learnBlastpad([TN]);
  assert.equal(tokenHref(TN).href, `/launch/${TN}`);
});

test('other b0ase tokens link to /token', () => {
  const t = OUR_TOKENS[0];
  assert.equal(tokenHref(t.id).href, `/token/${t.id}`);
});

test('anyone else keeps the 1Sat market link', () => {
  const id = 'f'.repeat(64) + '_0';
  assert.deepEqual(tokenHref(id), { href: `https://1sat.market/market/bsv21/${id}`, external: true });
  assert.equal(tokenHref('PEPE').href, 'https://1sat.market/market/bsv20/PEPE');
});

test('our token tickers resolve, any case and with $', () => {
  assert.equal(ourTokenByTicker('npg')?.sym, '$NINJAPUNKGIRLS');
  assert.equal(ourTokenByTicker('%24boase')?.sym, '$BOASE');
  assert.equal(ourTokenByTicker('htm')?.sym, '402');
  assert.equal(ourTokenByTicker('nope'), null);
});

test('our token list holds only well-formed deploy outpoints, no duplicates', () => {
  const ids = OUR_TOKENS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{64}_\d+$/);
});

import { share, units } from './gpToken';
test('units and share are bigint-safe', () => {
  assert.equal(units('2100000000000000', 8), '21,000,000');
  assert.equal(units('150', 2), '1.5');
  assert.equal(share('75477999900', '100000000000'), '75.48%');
  assert.equal(share('1', '0'), '');
});
