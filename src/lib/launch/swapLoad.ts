/**
 * Swap on load (owner, 25 Oct 2026): at LOCK & LOAD, ONE wallet approval buys an ammo coin on its BlastPad
 * curve with the tokens delivered straight to the GUN's address, plus the BSV gunpowder for the burns in
 * the same transaction. Same three steps as any BlastPad trade (docs/launchpad.md): prepare (lease + plan),
 * the wallet createActions around the plan, the server signs the pool's inputs, the wallet signs its own and broadcasts, commit books it.
 *
 * Before the wallet sees anything the plan is checked against our own quote: the tokens go to the gun,
 * no fewer than the slippage floor, and the wallet's share is no more than the player agreed to pay.
 */
import { Beef, P2PKH, Transaction, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk';
import type { AmmoCoin, SwapLoadQuote } from './ammoCoins';
import { INDEX_FEE } from './curve';
import { matchesPlan, tokenOut, type TradePlan } from './shape';

export type Post = <T>(url: string, body: unknown) => Promise<T>;

const defaultPost: Post = async <T,>(url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `Server answered ${r.status}.` }));
  if (!r.ok || j.error) throw Object.assign(new Error(j.error ?? `Server answered ${r.status}.`), { status: r.status });
  return j as T;
};

export type SwapLoadResult = { txid: string; tx: Transaction; tokens: bigint; fuelVout: number | null };

/** What the wallet itself funds for a plan: the fixed outputs minus the pool inputs it does not own. */
export const walletShare = (plan: Pick<TradePlan, 'inputs' | 'outputs'>) => plan.outputs.reduce((n, o) => n + o.sats, 0) - plan.inputs.reduce((n, i) => n + i.sats, 0);

/** How long to keep asking while another trade holds the coin (its lease is 90 s). */
export const BUSY_WAIT_MS = 95_000;

/**
 * Check a prepared plan against the quote before the wallet sees it. Returns why it is refused, or null.
 * `maxWalletSats` is what the player agreed to pay for the tokens (tokenSats) plus the index fee allowance.
 */
export function checkSwapPlan(plan: TradePlan, o: { tokenId: string; gun: string; minTokens: bigint; maxWalletSats: number }): string | null {
  if (plan.side !== 'buy' || plan.tokenId !== o.tokenId) return 'Not the buy we asked for.';
  const tokens = BigInt(plan.quote.tokens);
  if (tokens < o.minTokens) return 'The price moved past your slippage limit.';
  if (plan.outputs[0]?.script !== tokenOut(o.tokenId, tokens, o.gun) || plan.outputs[0].sats !== 1) return 'The tokens are not going to your gun. Refusing.';
  const share = walletShare(plan);
  if (share > o.maxWalletSats) return `The trade asks ${share.toLocaleString()} sats, more than the ${o.maxWalletSats.toLocaleString()} quoted.`;
  return null;
}

export async function swapLoad(
  wallet: WalletInterface,
  gun: string,
  trader: string,
  coin: Pick<AmmoCoin, 'tokenId' | 'sym'>,
  q: SwapLoadQuote,
  onStatus?: (s: string) => void,
  deps: { post?: Post; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<SwapLoadResult> {
  const post = deps.post ?? defaultPost;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  onStatus?.('Quoting…');
  let plan: TradePlan | null = null;
  const t0 = now();
  for (let tries = 0; !plan; tries++) {
    try {
      ({ plan } = await post<{ plan: TradePlan }>('/api/launch/trade?step=prepare', {
        step: 'prepare',
        purpose: 'ammo',
        token: coin.tokenId,
        side: 'buy',
        amount: q.gross.toString(),
        trader,
        to: gun,
        minTokens: q.minTokens.toString(),
      }));
    } catch (e) {
      // One trade at a time per coin: wait politely (backing off) for up to one lease, then give up.
      if ((e as { status?: number }).status === 409 && now() - t0 < BUSY_WAIT_MS) {
        onStatus?.(`$${coin.sym} busy, retrying…`);
        await sleep(Math.min(5_000, 1_000 + tries * 500));
        continue;
      }
      throw e;
    }
  }

  try {
    // The wallet pays the tokens at the plain curve price and the index fee (at most 5 × INDEX_FEE).
    const why = checkSwapPlan(plan, { tokenId: coin.tokenId, gun, minTokens: q.minTokens, maxWalletSats: Number(q.tokenSats) + 1 + 5 * INDEX_FEE });
    if (why) throw new Error(why);
    const tokens = BigInt(plan.quote.tokens);
    const beef = Beef.fromString(plan.beef, 'hex');
    const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = plan.outputs.map((o) => ({ lockingScript: o.script, satoshis: o.sats, outputDescription: o.what }));
    const fuelVout = q.fuelSats > 0 ? outputs.length : null;
    if (q.fuelSats > 0) outputs.push({ lockingScript: new P2PKH().lock(gun).toHex(), satoshis: q.fuelSats, outputDescription: `Gunpowder: ${q.fuelSats.toLocaleString()} sats to fire ${q.rounds.toLocaleString()} rounds` });
    onStatus?.('Approve in your wallet (one approval: buy + load)…');
    const created = await wallet.createAction({
      description: `Buy ${tokens.toLocaleString()} $${coin.sym} on BlastPad straight into your TokenBlaster gun (${q.rounds.toLocaleString()} rounds)${q.fuelSats ? ` + ${q.fuelSats.toLocaleString()} sats gunpowder` : ''}`,
      inputBEEF: beef.toBinary(),
      inputs: plan.inputs.map((i) => ({ outpoint: i.outpoint.replace('_', '.'), unlockingScriptLength: 108, inputDescription: i.what })),
      outputs,
      labels: ['tokenblaster', 'launch', 'ammo'],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
    });
    const signable = created.signableTransaction;
    if (!signable) throw new Error('The wallet did not return a transaction to sign.');
    let sent = false;
    try {
      const tx = Transaction.fromAtomicBEEF(signable.tx);
      const m = matchesPlan(tx, plan);
      if (!m.ok) throw new Error(`The wallet changed the trade (${m.why}).`);
      if (fuelVout !== null && (tx.outputs[fuelVout]?.lockingScript.toHex() !== new P2PKH().lock(gun).toHex() || tx.outputs[fuelVout].satoshis !== q.fuelSats)) throw new Error('The wallet moved the gunpowder output.');
      onStatus?.('Pool signing…');
      const { spends: pool } = await post<{ spends: Record<number, string> }>('/api/launch/trade', { step: 'sign', lease: plan.lease, tx: Utils.toHex(signable.tx) });
      const spends: Record<number, { unlockingScript: string }> = {};
      for (const [i, s] of Object.entries(pool)) spends[Number(i)] = { unlockingScript: s };
      onStatus?.('Sending…');
      const done = await wallet.signAction({ reference: signable.reference, spends });
      sent = true;
      let finalTx: Transaction;
      if (done.tx) finalTx = Transaction.fromAtomicBEEF(Array.from(done.tx));
      else {
        tx.inputs.forEach((inp, i) => spends[i] && (inp.unlockingScript = UnlockingScript.fromHex(spends[i].unlockingScript)));
        finalTx = tx;
      }
      const r = await post<{ txid: string }>('/api/launch/trade', { step: 'commit', lease: plan.lease, tx: Utils.toHex(finalTx.toAtomicBEEF()) });
      return { txid: r.txid, tx: finalTx, tokens, fuelVout };
    } catch (e) {
      if (!sent) await wallet.abortAction({ reference: signable.reference }).catch(() => undefined);
      throw e;
    }
  } catch (e) {
    await post('/api/launch/trade', { step: 'cancel', lease: plan.lease }).catch(() => undefined);
    throw e;
  }
}
