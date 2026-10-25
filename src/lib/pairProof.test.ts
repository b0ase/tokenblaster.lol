import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { pairProofMessage, pairUrl, parsePairUrl, signPairProof, type PairLink } from './pair/protocol';
import { publishedPairKeys, signPairRequest } from './pair/origin-proof';

// Reference verifier: verifyPairProof copied from bitcoin-corp/bwallet src/pair/protocol.ts (PR #162),
// so these tests check the site's signature exactly the way the phone does.
async function walletVerify(link: PairLink, keys: string[]): Promise<boolean> {
  if (!link.s) return false;
  try {
    const sig = Signature.fromDER(link.s, 'hex');
    const msg = pairProofMessage(link);
    return keys
      .slice(0, 8)
      .some((k) => typeof k === 'string' && /^0[23][0-9a-f]{64}$/i.test(k) && PublicKey.fromString(k).verify(msg, sig));
  } catch {
    return false;
  }
}

// Fixed test vector (throwaway key 0x…01, never used anywhere real).
const TEST_KEY_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const O = 'https://www.example.test';
const NOW = 1_800_000_000;
const base = (): PairLink => ({
  v: '1', r: 'relay.bwallet.space', c: 'AAAAAAAAAAAAAAAAAAAAAA',
  k: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', o: O, e: NOW + 100,
});
const env = { BWALLETX_PAIR_SIGNING_KEY: TEST_KEY_HEX };

test('message matches the wallet byte-for-byte', () => {
  assert.equal(
    Utils.toUTF8(pairProofMessage(base())),
    'bwallet-pair-v1|proof|AAAAAAAAAAAAAAAAAAAAAA|0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798|https://www.example.test|1800000100',
  );
});

test('server-signed link verifies against the published key and survives the QR round trip', async () => {
  const keys = publishedPairKeys(env);
  assert.deepEqual(keys, ['0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798']);
  const l = base();
  const s = signPairRequest({ c: l.c, k: l.k, o: l.o, e: l.e }, 'www.example.test', O, env, NOW);
  assert.ok(s && s.startsWith('30'));
  l.s = s!;
  const parsed = parsePairUrl(pairUrl(l), NOW);
  assert.equal(parsed.s, s);
  assert.equal(await walletVerify(parsed, keys), true);
  // replay onto another channel fails
  assert.equal(await walletVerify({ ...parsed, c: 'BBBBBBBBBBBBBBBBBBBBBB' }, keys), false);
  // a random key's signature fails
  assert.equal(await walletVerify({ ...l, s: signPairProof(l, PrivateKey.fromRandom()) }, keys), false);
});

test('refuses other origins, cross-site callers and bad expiry; unset key → unsigned', () => {
  const l = base();
  const req = { c: l.c, k: l.k, o: l.o, e: l.e };
  assert.equal(signPairRequest(req, 'evil.test', null, env, NOW), null);
  assert.equal(signPairRequest(req, 'www.example.test', 'https://evil.test', env, NOW), null);
  assert.equal(signPairRequest({ ...req, e: NOW - 1 }, 'www.example.test', O, env, NOW), null);
  assert.equal(signPairRequest({ ...req, e: NOW + 100000 }, 'www.example.test', O, env, NOW), null);
  assert.equal(signPairRequest(req, 'www.example.test', O, {}, NOW), null);
  assert.equal(signPairRequest(req, 'www.example.test', O, { BWALLETX_PAIR_SIGNING_KEY: 'junk' }, NOW), null);
  assert.deepEqual(publishedPairKeys({}), []);
  assert.equal(pairUrl(l).includes('&s='), false);
});
