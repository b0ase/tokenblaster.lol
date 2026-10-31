/**
 * Reading a game-credit key's balance (31 Oct 2026): a storm leaves thousands of tiny lane ends at the gun, and
 * WhatsOnChain pages its unspent list 1,000 at a time. Reading only page 1 showed the owner 7,000 sats while a
 * 5,792,065-sat coin sat on page 8. Every page is read now, and the credit shown is never lower than any read.
 */
export type Utxo = { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean };
export type UtxoPage = { result?: Utxo[]; nextPageToken?: string } | null;

/** Read pages until there is no next token (or `maxPages`). `complete` is false when it stopped early. */
export async function allUnspent(page: (token?: string) => Promise<UtxoPage>, maxPages = 40, gapMs = 0): Promise<{ coins: Utxo[]; complete: boolean }> {
  const coins: Utxo[] = [];
  let token: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    if (i && gapMs) await new Promise((r) => setTimeout(r, gapMs)); // WhatsOnChain rate-limits bursts
    let p: UtxoPage;
    try {
      p = await page(token);
    } catch (e) {
      if (!i) throw e; // nothing read at all: the caller reports the read as failed
      return { coins, complete: false }; // a later page failed: keep what was read (a lower bound)
    }
    coins.push(...(p?.result ?? []));
    token = p?.nextPageToken || undefined;
    if (!token) return { coins, complete: true };
  }
  return { coins, complete: false };
}

/** Spendable sats: 1-sat outputs hold tokens, and coins already spent in the mempool do not count. */
export const spendableSats = (coins: Utxo[]) => coins.reduce((n, c) => n + (!c.isSpentInMempoolTx && c.value > 1 ? c.value : 0), 0);

/** The credit to show: the highest of the reads that answered (null when none did). Never under-report. */
export function bestCredit(reads: (number | null | undefined)[]): number | null {
  const ok = reads.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0);
  return ok.length ? Math.max(...ok) : null;
}
