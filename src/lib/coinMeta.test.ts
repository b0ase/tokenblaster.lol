/** Per-coin extras for the bWalletX Exchange (src/lib/launch/coinMeta.ts): schema, sizes, contrast, and the API shape. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { COIN_META, SITE, coinExtras } from './launch/coinMeta';
import { price } from './launch/curve';
import { MAX_TOKEN_LOAD_ROUNDS } from './tokenLoad';

const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const THEME_KEYS = ['v', 'name', 'mode', 'accent', 'accentHi', 'bg', 'surface', 'text', 'logo', 'cardArt'];

for (const [id, m] of Object.entries(COIN_META)) {
  test(`coin meta ${id.slice(0, 8)}: schema, sizes, contrast`, () => {
    assert.match(id, /^[0-9a-f]{64}_\d+$/);
    for (const k of Object.keys(m)) assert.ok(['theme', 'room', 'merch_url'].includes(k), `no extra key ${k}`);
    if (m.room !== undefined) assert.match(m.room, /^[A-Z0-9]{1,20}$/);
    if (m.merch_url !== undefined) assert.equal(new URL(m.merch_url).protocol, 'https:');
    const t = m.theme;
    if (!t) return;
    for (const k of Object.keys(t)) assert.ok(THEME_KEYS.includes(k), `no extra theme key ${k}`);
    assert.equal(t.v, 2);
    assert.match(t.name, /^[A-Za-z0-9 ]{1,32}$/);
    assert.ok(t.mode === 'dark' || t.mode === 'light');
    for (const k of ['accent', 'accentHi', 'bg', 'surface', 'text'] as const) assert.match(t[k], /^#[0-9A-Fa-f]{6}$/, k);
    assert.ok(ratio(t.text, t.bg) >= 4.5, 'text on bg');
    assert.ok(ratio(t.text, t.surface) >= 4.5, 'text on surface');
    assert.ok(ratio(t.accent, t.bg) >= 3, 'accent on bg');
    for (const k of ['logo', 'cardArt'] as const) assert.match(t[k], /^\/[A-Za-z0-9/_.-]+$/, `${k} is a same-origin path`);
    assert.ok(statSync(`public${t.logo}`).size <= 64 * 1024, 'logo <= 64 KB');
    assert.ok(statSync(`public${t.cardArt}`).size <= 256 * 1024, 'cardArt <= 256 KB');
  });
}

test('coinExtras: price from the curve, absolute same-origin images, nothing for unknown coins', () => {
  const id = Object.keys(COIN_META)[0];
  const x = coinExtras({ token_id: id, sold: 1000 });
  assert.equal(x.price_sats, price(BigInt(1000)));
  assert.ok(x.theme?.logo.startsWith(`${SITE}/`));
  assert.deepEqual(Object.keys(coinExtras({ token_id: 'nope', sold: 0 })), ['price_sats']);
});

test('token load cap is a sane constant', () => {
  assert.ok(Number.isInteger(MAX_TOKEN_LOAD_ROUNDS) && MAX_TOKEN_LOAD_ROUNDS > 0 && MAX_TOKEN_LOAD_ROUNDS <= 10_000);
});
