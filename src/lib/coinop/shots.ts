/**
 * How many shots a dollar amount buys in ASSAULT ON TERRORNODE (owner, 25 Oct 2026: every "buys N shots" figure,
 * the coin labels, the receipt banner and LOCK & LOAD must agree). Pure, tested in shots.test.ts.
 *
 * One shot = the BSV round (`feeSats`: its network fee, plus the platform fee when there is one) + 1 $TERRORNODE
 * receipt at the curve price (src/lib/launch/receipts.ts; it rises as receipts sell). A load also holds back the
 * storm's lane overhead (overheadSats) and, with receipts on, the settlement's gas + fee.
 * Units: $0.30 at BSV $17.29 is 1,735,108 sats (1 BSV = 100,000,000 sats), so at ~31 sats a shot it buys ~55k shots.
 */
import { RECEIPT_GAS, shotsFor } from '../launch/receipts';
import { overheadSats, roundsFor } from '../gallery';
import { usdToSats } from './credit';

/** The settlement tx's own network fee margin, held back from a load (with RECEIPT_GAS). */
export const SETTLE_FEE = 300;

/** The live receipt curve position: receipts issued so far and 1 US penny in sats. null: receipts off. */
export type ReceiptCurve = { issued: number; pennySats: number } | null;

/** "1 sat", "30 sats". */
export const satsWord = (n: number) => `${n.toLocaleString('en-US')} sat${n === 1 ? '' : 's'}`;

/** Shots `sats` buys now, after the load overhead (and the receipts settlement, when receipts are on). */
export function shotsForSats(sats: number, feeSats: number, receipt: ReceiptCurve): number {
  if (!(sats > 0) || !(feeSats > 0)) return 0;
  const n = (s: number) => (receipt ? shotsFor(s - RECEIPT_GAS - SETTLE_FEE, feeSats, receipt.issued, receipt.pennySats) : roundsFor(s, feeSats));
  const first = n(sats);
  return n(Math.max(0, sats - overheadSats(first)));
}

/** Shots `usd` buys at `bsvUsd`. null while there is no price. */
export function shotsForUsd(usd: number, bsvUsd: number | null | undefined, feeSats: number, receipt: ReceiptCurve): number | null {
  if (!bsvUsd || !(bsvUsd > 0)) return null;
  if (!(usd > 0)) return 0;
  return shotsForSats(usdToSats(usd, bsvUsd) ?? 0, feeSats, receipt);
}
