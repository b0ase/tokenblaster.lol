/**
 * Proof of reserves maths, shared by /api/launch/coin and the token page (pure, tested in src/lib/reserves.test.ts).
 *
 * The pool starts with the whole supply. Tokens leave it two ways:
 *  - sold on the curve (`sold`, with BSV coming in: poolSats(sold));
 *  - paid to players as $TERRORNODE shot receipts (`receipts`, from the receipts ledger, db/022
 *    tokenblaster_receipts_issued). Those receipts were paid for in BSV that went to the revenue split, not the pool.
 * So the pool should hold SUPPLY − sold − receipts tokens. Anything else is a real mismatch and stays an alarm.
 */
export type Side = { bsv: number; tokens: number };
export type Reserves = {
  expected: Side;
  ledger: Side;
  chain: { bsv: number | null; tokens: number | null; checkedAt: number };
  /** Tokens paid out of the pool to players as receipts (play-to-earn coins only). */
  receipts?: { tokens: number } | null;
};

/** What the pool should hold: the curve's side, minus the receipts already paid to players. */
export function expectedReserves(supply: number, sold: number, curveSats: number, receiptsPaid = 0): Side {
  return { bsv: curveSats, tokens: supply - sold - receiptsPaid };
}

export type LedgerCheck = { ok: true } | { ok: false; why: string };

/** Does the ledger match what the curve (and the receipts) say the pool should hold? */
export function ledgerCheck(r: Pick<Reserves, 'expected' | 'ledger'>): LedgerCheck {
  if (r.expected.bsv !== r.ledger.bsv) return { ok: false, why: `BSV: the ledger has ${r.ledger.bsv} sats, the curve owes ${r.expected.bsv}.` };
  if (r.expected.tokens !== r.ledger.tokens) return { ok: false, why: `Tokens: the ledger has ${r.ledger.tokens}, expected ${r.expected.tokens}.` };
  return { ok: true };
}
