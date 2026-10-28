/**
 * The $TERRORNODE receipt curve as the token page shows it (pure, tested in src/lib/receiptCurve.test.ts).
 * Source of truth: src/lib/launch/receipts.ts (price(n) = 1 + (TOP − 1)(n − 1)/(N − 1), TOP = 200, N = 1e9;
 * graduation at GRADUATE_AT receipts issued).
 */
import { GRADUATE_AT, RECEIPT_SUPPLY, RECEIPT_TOP_SATS, priceSats } from './receipts';

const N = Number(RECEIPT_SUPPLY);
const TOP = Number(RECEIPT_TOP_SATS);

/** Exact (unrounded) price of receipt #n in sats. */
export const receiptPrice = (n: number) => 1 + ((TOP - 1) * (Math.min(Math.max(n, 1), N) - 1)) / (N - 1);

export function receiptCurveView(issued: number) {
  const n = Math.max(0, Math.min(issued, N));
  return {
    low: 1,
    top: TOP,
    supply: N,
    graduateAt: GRADUATE_AT,
    issued: n,
    toGraduation: Math.max(0, GRADUATE_AT - n),
    progress: Math.min(1, n / GRADUATE_AT),
    graduated: n >= GRADUATE_AT,
    /** What the next live shot's receipt costs, in whole sats (what the gun pays). */
    nextSats: n >= N ? null : Number(priceSats(n + 1)),
    priceAtGraduation: receiptPrice(GRADUATE_AT),
  };
}
