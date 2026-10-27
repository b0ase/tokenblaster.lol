/** Test fixture: a split quote whose destinations genuinely derive from the pinned NPG Ltd / bCorp keys. */
import { Random, Utils } from '@bsv/sdk';
import { derivedAddress, payeeOf, type PayeeId, type SplitDest, type SplitQuote } from './launch/split';

export function testDest(payee: PayeeId): SplitDest {
  const prefix = Utils.toBase64(Random(16));
  const suffix = Utils.toBase64(Random(16));
  return { payee, prefix, suffix, reference: Utils.toHex(Random(16)), address: derivedAddress(payeeOf(payee).identityKey, prefix, suffix) };
}
export const testQuote = (): SplitQuote => ({ npg: testDest('npg'), bcorp: testDest('bcorp') });
