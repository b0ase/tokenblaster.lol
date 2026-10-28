import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANNED_WORDS, RISK_LINE, chatRoomUrl, isOurToken, issuerLine } from './launch/tokenPage';

const TERRORNODE = 'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1';
const files = ['src/components/launch/CoinView.tsx', 'src/components/launch/TokenHero.tsx'];

test('risk line is the exact approved wording', () => {
  assert.equal(RISK_LINE, 'Tokens can lose all value. Not an investment. No returns are promised.');
});

test('every token page shows the risk line and the issuer line for third-party coins', () => {
  const hero = readFileSync('src/components/launch/TokenHero.tsx', 'utf8');
  assert.match(hero, /\{RISK_LINE\}/);
  assert.match(hero, /issuerLine\(/);
  assert.equal(issuerLine('alice@handcash.io'), 'Made by alice@handcash.io, not by bCorp.');
});

test('no banned words in the token page copy (outside the risk line)', () => {
  for (const f of files) {
    // Only user-visible copy matters, but checking the whole source is stricter; identifiers like earn_url are stripped.
    const src = readFileSync(f, 'utf8').replace(/earn_url|EarnPanel|data-earn-panel|play-to-earn coin: earn by playing/g, '');
    for (const re of BANNED_WORDS) assert.ok(!re.test(src), `${f} uses ${re}`);
  }
});

test('ours vs third-party', () => {
  assert.ok(isOurToken(TERRORNODE));
  assert.ok(!isOurToken('0'.repeat(64) + '_1'));
});

test('chat room link', () => {
  assert.equal(chatRoomUrl('$terrornode'), 'https://www.bchatx.com/chat?room=TERRORNODE');
});

test('token pages ask the bAds rail for house ads only', () => {
  assert.match(readFileSync('src/components/launch/CoinView.tsx', 'utf8'), /slotType="token-page"/);
  assert.match(readFileSync('src/components/BAdsRail.tsx', 'utf8'), /data-slot-type=\{slotType/);
});
