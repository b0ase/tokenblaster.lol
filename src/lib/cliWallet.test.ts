import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliFetch, parsePairStream } from './cliWallet';

test('pair stream: code first, token only once approved', () => {
  assert.deepEqual(parsePairStream('{"code":"12345678"'), { code: '12345678', approved: false, token: undefined });
  assert.deepEqual(parsePairStream('{"code":"12345678","approved":true,"token":"abc"}'), { code: '12345678', approved: true, token: 'abc' });
});

test('cliFetch: a 401 drops the token, pairs, and retries with the Bearer header', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  store.set('tb.cliWalletToken', 'old');
  const seen: (string | null)[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/pair')) return new Response('{"code":"87654321","approved":true,"token":"new"}');
    const auth = new Headers(init?.headers).get('Authorization');
    seen.push(auth);
    return new Response('{}', { status: auth === 'Bearer new' ? 200 : 401 });
  }) as typeof fetch;
  const r = await cliFetch(fake)('http://localhost:3321/getPublicKey', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, ['Bearer old', 'Bearer new']);
  assert.equal(store.get('tb.cliWalletToken'), 'new');
});
