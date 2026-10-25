/** "Launched by": paymail lookup for a launch key, and verifying a client-claimed paymail (src/lib/launch/launchedBy.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey } from '@bsv/sdk';
import { PAYMAIL_LOOKUP, addressOf, launchPaymail, launchedBy, paymailsForKey, withLaunchedBy, type Fetch } from './launch/launchedBy';

const KEY = PrivateKey.fromRandom().toPublicKey().toString();
const json = (status: number, body: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status });
const mock = (res: Response | Error, seen: string[] = []): Fetch => async (url) => {
  seen.push(url);
  if (res instanceof Error) throw res;
  return res.clone();
};
const NAMES = { names: [{ paymail: 'alt@bwallet.space', kind: 'opns' }, { paymail: 'Rich@bwallet.space', kind: 'plain' }] };

test('looks up by key on pay.bwallet.space; main (plain) name first, lowercased', async () => {
  const seen: string[] = [];
  assert.deepEqual(await paymailsForKey(KEY, mock(json(200, NAMES), seen)), ['rich@bwallet.space', 'alt@bwallet.space']);
  assert.equal(seen[0], `${PAYMAIL_LOOKUP}?key=${KEY}`);
  assert.deepEqual(await paymailsForKey(KEY, mock(json(200, { paymail: 'top@x.io', ...NAMES }))), ['top@x.io', 'rich@bwallet.space', 'alt@bwallet.space']);
});

test('no name yet → [] (stored as null); server error or network failure → null', async () => {
  assert.deepEqual(await paymailsForKey(KEY, mock(json(404, { error: 'none' }))), []);
  assert.deepEqual(await paymailsForKey(KEY, mock(json(200, { names: [] }))), []);
  assert.equal(await paymailsForKey(KEY, mock(json(500, {}))), null);
  assert.equal(await paymailsForKey(KEY, mock(new Error('offline'))), null);
  assert.equal(await launchPaymail(KEY, undefined, mock(json(404, {}))), null);
  assert.equal(await launchPaymail(KEY, 'rich@bwallet.space', mock(json(500, {}))), null);
});

test('a bad key is never sent to the service', async () => {
  const seen: string[] = [];
  assert.deepEqual(await paymailsForKey('nope', mock(json(200, NAMES), seen)), []);
  assert.equal(seen.length, 0);
});

test('claimed paymail is kept only if the key lists it; otherwise the main name', async () => {
  const f = mock(json(200, NAMES));
  assert.equal(await launchPaymail(KEY, 'ALT@bwallet.space', f), 'alt@bwallet.space');
  assert.equal(await launchPaymail(KEY, 'someone-else@bwallet.space', f), 'rich@bwallet.space');
  assert.equal(await launchPaymail(KEY, 'not a paymail', f), 'rich@bwallet.space');
  assert.equal(await launchPaymail(KEY, undefined, f), 'rich@bwallet.space');
  // a claim cannot create a paymail the key doesn't have
  assert.equal(await launchPaymail(KEY, 'rich@bwallet.space', mock(json(404, {}))), null);
});

test('launched_by: paymail or null, the key and its address', () => {
  const addr = addressOf(KEY);
  assert.match(addr, /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
  assert.deepEqual(launchedBy({ creator_key: KEY, launch_paymail: 'rich@bwallet.space' }), { paymail: 'rich@bwallet.space', key: KEY, address: addr });
  assert.deepEqual(launchedBy({ creator_key: KEY, launch_paymail: null }), { paymail: null, key: KEY, address: addr });
  assert.deepEqual(launchedBy({ creator: '1Fallback', creator_key: null }), { paymail: null, key: '', address: '1Fallback' });
  const row = withLaunchedBy({ token_id: 't', creator_key: KEY, launch_paymail: 'rich@bwallet.space' });
  assert.equal('launch_paymail' in row, false);
  assert.equal(row.launched_by.paymail, 'rich@bwallet.space');
});
