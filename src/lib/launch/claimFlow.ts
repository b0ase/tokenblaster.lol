/**
 * Holder-reward claim, with its chain and ledger injected (the route wires the real ones, the tests a mock).
 * Fixes the double-payout race from the 28 Oct signing audit:
 *   1. a signature is single-use (its { to, ts } is recorded on the payout and checked first)
 *   2. every coin the claim draws on is LEASED first (tokenblaster_launch_lease: an atomic conditional update on
 *      lease_id / lease_until), so two claims, or a claim and a trade/buyback, can never build on the same vault
 *   3. the owed rows are re-read UNDER the lease, and marked with the payout txid BEFORE it is broadcast
 *      (mark_claimed only touches rows still unclaimed), so nothing can pay them twice, even after a crash
 *   4. a payout the network refused is re-credited (same amounts, via tokenblaster_launch_owe) only when none of
 *      its inputs was spent and the tx is unknown; otherwise the rows stay marked for a manual look
 *   5. the daily vault outflow cap is checked before signing
 */
import { P2PKH, SatoshisPerKilobyte, Transaction, type PrivateKey } from '@bsv/sdk';

export type OwedRow = { id: number; slot: string; sats: number };
export type Utxo = { txid: string; vout: number; sats: number; tx: Transaction };

export type ClaimDeps = {
  signatureUsed(address: string, ts: string): Promise<boolean>;
  owedRows(address: string): Promise<OwedRow[]>;
  coin(slot: string): Promise<{ token_id: string; vault_address: string } | null>;
  /** Atomic: take this coin's lease, false if someone holds it. */
  lease(tokenId: string, lease: string): Promise<boolean>;
  release(lease: string): Promise<void>;
  utxos(address: string): Promise<Utxo[]>;
  vaultKey(slot: string): PrivateKey;
  markClaimed(address: string, ids: number[], txid: string): Promise<void>;
  reowe(slot: string, address: string, sats: number): Promise<void>;
  broadcast(tx: Transaction): Promise<string>;
  /** Is this outpoint spent (by anything)? */
  spentBy(outpoint: string): Promise<string | null>;
  txKnown(txid: string): Promise<boolean>;
  payout(txid: string, slot: string, sats: number, detail: Record<string, unknown>): Promise<void>;
  vaultOutflowToday(): Promise<number>;
  vaultCap: number;
  newLease(): string;
};

export type ClaimResult =
  | { ok: true; txid: string; tx: Transaction; outputIndex: number; sats: number }
  | { ok: false; why: string; status: number };

export async function runClaim(a: { address: string; payTo: string; ts: string }, d: ClaimDeps): Promise<ClaimResult> {
  if (await d.signatureUsed(a.address, a.ts)) return { ok: false, why: 'This claim signature was already used. Sign a new claim.', status: 409 };
  const first = await d.owedRows(a.address);
  if (!first.length) return { ok: false, why: 'Nothing to claim.', status: 400 };

  const lease = d.newLease();
  const slots = [...new Set(first.map((r) => r.slot))].sort();
  const coins = new Map<string, { token_id: string; vault_address: string }>();
  for (const slot of slots) {
    const c = await d.coin(slot);
    if (!c || !(await d.lease(c.token_id, lease))) {
      await d.release(lease).catch(() => undefined);
      return { ok: false, why: 'A vault is busy with another payout or trade; try again in a moment.', status: 409 };
    }
    coins.set(slot, c);
  }

  let marked: { ids: number[]; txid: string; bySlot: Map<string, number>; tx: Transaction } | null = null;
  try {
    // Re-read under the lease: a claim that finished while we waited has already marked these.
    const rows = (await d.owedRows(a.address)).filter((r) => coins.has(r.slot));
    if (!rows.length) return { ok: false, why: 'Nothing to claim.', status: 400 };
    const bySlot = new Map<string, number>();
    for (const r of rows) bySlot.set(r.slot, (bySlot.get(r.slot) ?? 0) + Number(r.sats));
    const total = [...bySlot.values()].reduce((n, s) => n + s, 0);
    if (total < 1_000) return { ok: false, why: 'Rewards are paid out from 1,000 sats.', status: 400 };
    if (total > d.vaultCap - (await d.vaultOutflowToday()))
      return { ok: false, why: 'Reward payouts have hit today’s limit. Your rewards are safe; claim again tomorrow.', status: 503 };

    // Take from each vault exactly what it owes this wallet; change goes back to that vault.
    const tx = new Transaction();
    for (const [slot, sats] of bySlot) {
      const c = coins.get(slot)!;
      const key = d.vaultKey(slot); // throws while the kill switch is on
      const utxos = await d.utxos(c.vault_address);
      let got = 0;
      for (const u of utxos) {
        if (got >= sats + 200) break;
        tx.addInput({ sourceTransaction: u.tx, sourceOutputIndex: u.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
        got += u.sats;
      }
      if (got < sats) return { ok: false, why: 'A vault is waiting for a block before it can pay; try again in a few minutes.', status: 409 };
      if (got - sats > 0) tx.addOutput({ lockingScript: new P2PKH().lock(c.vault_address), satoshis: got - sats });
    }
    // The network fee comes out of the payout.
    tx.addOutput({ lockingScript: new P2PKH().lock(a.payTo), change: true });
    await tx.fee(new SatoshisPerKilobyte(100));
    await tx.sign();
    const payIdx = tx.outputs.length - 1;
    const paid = tx.outputs[payIdx].satoshis ?? 0;
    if (paid <= 0) return { ok: false, why: 'Too small to pay out after the network fee.', status: 400 };
    const txid = tx.id('hex');

    // Mark BEFORE broadcasting: from here these rows can never be paid by another tx.
    await d.markClaimed(a.address, rows.map((r) => r.id), txid);
    marked = { ids: rows.map((r) => r.id), txid, bySlot, tx };
    await d.broadcast(tx);
    for (const [slot, sats] of bySlot) await d.payout(txid, slot, sats, { to: a.address, ts: a.ts });
    return { ok: true, txid, tx, outputIndex: payIdx, sats: paid };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (marked) {
      // Refused by the network: re-credit only if provably nothing moved.
      const ins = marked.tx.inputs.map((i) => `${i.sourceTXID ?? i.sourceTransaction!.id('hex')}_${i.sourceOutputIndex}`);
      const anySpent = (await Promise.all(ins.map((o) => d.spentBy(o).catch(() => 'unknown')))).some(Boolean);
      const known = await d.txKnown(marked.txid).catch(() => true);
      if (!anySpent && !known) {
        for (const [slot, sats] of marked.bySlot) await d.reowe(slot, a.address, sats);
        return { ok: false, why: `${why} Your rewards were put back; try again.`, status: 502 };
      }
      return { ok: false, why: `${why} The payout may still confirm (${marked.txid}); it will not be paid twice.`, status: 502 };
    }
    return { ok: false, why, status: 500 };
  } finally {
    await d.release(lease).catch(() => undefined);
  }
}
