/** bWalletX site themes (public/.well-known/bwalletx-theme*.json): the wallet's rules, docs/wallet-theme.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const KEYS = ['v', 'name', 'mode', 'accent', 'accentHi', 'bg', 'surface', 'text', 'logo', 'cardArt'];

for (const file of ['bwalletx-theme.json', 'bwalletx-theme.assault.json']) {
  test(`wallet theme ${file}: schema, sizes, contrast`, () => {
    const path = `public/.well-known/${file}`;
    assert.ok(statSync(path).size <= 8 * 1024, 'file <= 8 KB');
    const t = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string | number>;
    for (const k of Object.keys(t)) assert.ok(KEYS.includes(k), `no extra key ${k}`);
    assert.equal(t.v, 2);
    assert.match(String(t.name), /^[A-Za-z0-9 ]{1,32}$/);
    assert.ok(t.mode === 'dark' || t.mode === 'light');
    for (const k of ['accent', 'accentHi', 'bg', 'surface', 'text']) assert.match(String(t[k]), /^#[0-9A-Fa-f]{6}$/, k);
    const [text, bg, surface, accent] = [t.text, t.bg, t.surface, t.accent].map(String);
    assert.ok(ratio(text, bg) >= 4.5, 'text on bg');
    assert.ok(ratio(text, surface) >= 4.5, 'text on surface');
    assert.ok(ratio(accent, bg) >= 3, 'accent on bg');
    assert.ok(statSync(`public${t.logo}`).size <= 64 * 1024, 'logo <= 64 KB');
    assert.ok(statSync(`public${t.cardArt}`).size <= 256 * 1024, 'cardArt <= 256 KB');
  });
}
