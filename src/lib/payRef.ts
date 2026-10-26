import { LockingScript, OP, Utils, type Transaction } from '@bsv/sdk';

/**
 * Payment id (26 Oct 2026): every LOCK & LOAD payment carries a client payment id in a 0-sat OP_RETURN output
 * ("tokenblaster.lol" "pay:<id>"), so a retry can tell from the chain whether THIS payment landed, never from a
 * balance difference (a slow balance read made an old coin look like a new payment).
 */
export const PAY_REF_PREFIX = 'pay:';
export const newPayRef = () => Utils.toHex(Array.from(crypto.getRandomValues(new Uint8Array(8))));
export const payRefScript = (ref: string) =>
  new LockingScript([
    { op: OP.OP_FALSE },
    { op: OP.OP_RETURN },
    { op: 16, data: Utils.toArray('tokenblaster.lol', 'utf8') },
    { op: PAY_REF_PREFIX.length + ref.length, data: Utils.toArray(PAY_REF_PREFIX + ref, 'utf8') },
  ]);
/** True when `tx` carries payment id `ref`. */
export const hasPayRef = (tx: Transaction, ref: string) => {
  const want = payRefScript(ref).toHex();
  return tx.outputs.some((o) => o.lockingScript.toHex() === want);
};
