/**
 * One trade on a coin's curve, in three steps (docs/launchpad.md):
 *   prepare: lease the pool, quote, and propose the pool's inputs + fixed outputs
 *   sign:    the wallet built the tx around them; check it and sign the pool's inputs
 *   commit:  the wallet signed its own inputs; check again, broadcast, move the pool
 * One coin trades one at a time: a lease lasts LEASE_SECS or until commit/cancel.
 */
import { NextResponse } from 'next/server';
import { Beef, Transaction } from '@bsv/sdk';
import { GRAD_SOLD, INDEX_FEE, MAX_BUY, MIN_BUY, quoteBuy, quoteSell } from '@/lib/launch/curve';
import { bsv20Json, matchesPlan, p2pkh, tokenOut, type OutSpec, type TradePlan } from '@/lib/launch/shape';
import { HOUSE, broadcast, compactBeef, configured, fundAddressOf, indexedTokenAmt, poolKey, rpc, signInput, spentBy, type CoinRow } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';
const LEASE_SECS = 90;

type Stored = TradePlan & {
  trader: string;
  roles: { poolToken: number | null; reserve: number };
  tokenAmtAfter: string;
  reserveAfter: string;
  routeAccrued: string;
  fundOwedAfter: number;
  fundAddress: string | null;
  sellerCoins: string[];
  allowedTokenOut: string; // tokens of this id the extra outputs may carry (seller's change)
  signed?: boolean;
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
const isOutpoint = (o: unknown): o is string => typeof o === 'string' && /^[0-9a-f]{64}_\d+$/.test(o);

export async function POST(req: Request) {
  if (!configured()) return bad('The launchpad is not open yet.', 503);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('Bad request.');
  }
  try {
    if (body.step === 'prepare') return await prepare(body);
    if (body.step === 'sign') return await sign(body);
    if (body.step === 'commit') return await commit(body);
    if (body.step === 'cancel') return await cancel(body);
    return bad('Unknown step.');
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

/** A previous trade was signed but never committed: if it reached the chain anyway, book it. */
async function reconcile(token: string) {
  const [row] = await rpc<CoinRow[]>('tokenblaster_launch_get', { p_token: token });
  if (!row?.lease_id || !row.lease_quote || !(row.lease_quote as Stored).signed) return;
  if (row.lease_until && new Date(row.lease_until).getTime() > Date.now()) return;
  const plan = row.lease_quote as unknown as Stored;
  const spender = row.token_utxo ? await spentBy(row.token_utxo) : null;
  if (spender) {
    const hex = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${spender}/hex`).then((r) => (r.ok ? r.text() : ''));
    if (hex) {
      const tx = Transaction.fromHex(hex.trim());
      if (matchesPlan(tx, plan).ok) {
        await book(row.lease_id, plan, tx, row.beef ?? '');
        return;
      }
    }
  }
  await rpc('tokenblaster_launch_release', { p_lease: row.lease_id });
}

async function prepare(b: Record<string, unknown>) {
  const token = String(b.token ?? '');
  const side = b.side === 'sell' ? 'sell' : 'buy';
  const trader = b.trader;
  if (!isOutpoint(token) || !isAddr(trader)) return bad('Bad coin or wallet address.');
  await reconcile(token);
  const lease = crypto.randomUUID();
  const [row] = await rpc<CoinRow[]>('tokenblaster_launch_lease', { p_token: token, p_lease: lease, p_secs: LEASE_SECS });
  if (!row) return bad('Someone else is trading this coin right now. Trying again in a moment…', 409);
  try {
    if (!row.token_utxo || !row.beef) throw new Error('This coin’s pool is not ready yet.');
    const sold = BigInt(row.sold);
    const tokenAmt = BigInt(row.token_amt);
    const reserve = BigInt(row.reserve_sats);
    const fundAddress = row.fund_address ?? (await fundAddressOf(token));
    const routeTo = row.route.kind === 'creator' ? (row.route.address ?? row.creator) : row.vault_address;

    const inputs: TradePlan['inputs'] = [{ outpoint: row.token_utxo, sats: 1, what: 'pool tokens' }];
    if (row.reserve_utxo) inputs.push({ outpoint: row.reserve_utxo, sats: Number(reserve), what: 'pool BSV' });
    const outputs: OutSpec[] = [];
    let roles: Stored['roles'];
    let tokenAmtAfter: bigint;
    let reserveAfter: bigint;
    let tokenOuts: number;
    let sellerCoins: string[] = [];
    let allowed = BigInt(0);
    let q;

    if (side === 'buy') {
      const to = b.to;
      if (!isAddr(to)) throw new Error('Bad address for your tokens.');
      const spend = BigInt(Math.floor(Number(b.amount)));
      if (!(spend >= BigInt(MIN_BUY) && spend <= BigInt(MAX_BUY))) throw new Error('A buy is between 0.0001 and 20 BSV.');
      q = quoteBuy(sold, spend);
      if (q.tokens <= BigInt(0)) throw new Error('The curve is sold out.');
      tokenAmtAfter = tokenAmt - q.tokens;
      reserveAfter = reserve + q.curveSats;
      outputs.push({ script: tokenOut(token, q.tokens, to), sats: 1, what: `${q.tokens} tokens to you` });
      roles = { poolToken: null, reserve: 0 };
      if (tokenAmtAfter > BigInt(0)) {
        roles.poolToken = outputs.length;
        outputs.push({ script: tokenOut(token, tokenAmtAfter, row.token_address), sats: 1, what: 'the rest back to the pool' });
      }
      roles.reserve = outputs.length;
      outputs.push({ script: p2pkh(row.reserve_address), sats: Number(reserveAfter), what: 'BSV into the pool' });
      tokenOuts = tokenAmtAfter > BigInt(0) ? 2 : 1;
    } else {
      if (!row.reserve_utxo) throw new Error('Nothing has been bought on this curve yet.');
      const tokens = BigInt(Math.floor(Number(b.amount)));
      if (tokens <= BigInt(0)) throw new Error('Sell how many?');
      const coins = Array.isArray(b.coins) ? b.coins.filter(isOutpoint).slice(0, 20) : [];
      let have = BigInt(0);
      for (const c of coins) {
        const amt = await indexedTokenAmt(c, token);
        if (amt === null) throw new Error('One of your token coins is not confirmed by the token index yet. Try again in a minute.');
        have += amt;
      }
      if (have < tokens) throw new Error(`Your wallet has ${have} of these tokens confirmed by the index.`);
      sellerCoins = coins;
      allowed = have - tokens;
      q = quoteSell(sold, tokens);
      if (q.curveSats <= BigInt(0)) throw new Error('Too small to sell.');
      tokenAmtAfter = tokenAmt + tokens;
      reserveAfter = reserve - q.curveSats;
      roles = { poolToken: 0, reserve: 1 };
      outputs.push({ script: tokenOut(token, tokenAmtAfter, row.token_address), sats: 1, what: 'your tokens into the pool' });
      outputs.push({ script: p2pkh(row.reserve_address), sats: Number(reserveAfter), what: 'the pool’s BSV after paying you' });
      tokenOuts = 1 + (allowed > BigInt(0) ? 1 : 0);
    }
    if (q.houseFee > BigInt(0)) outputs.push({ script: p2pkh(HOUSE), sats: Number(q.houseFee), what: 'TokenBlaster fee (0.70%)' });
    if (q.routeFee > BigInt(0)) outputs.push({ script: p2pkh(routeTo), sats: Number(q.routeFee), what: row.route.kind === 'creator' ? 'creator fee (0.30%)' : 'coin vault (0.30%)' });
    let indexFee = 0;
    let fundOwedAfter = Number(row.fund_owed) + tokenOuts * INDEX_FEE;
    if (fundAddress) {
      indexFee = Math.min(fundOwedAfter, 5 * INDEX_FEE);
      fundOwedAfter -= indexFee;
      outputs.push({ script: p2pkh(fundAddress), sats: indexFee, what: 'token index fund' });
    }

    // Slippage: the client says what it expects; refuse if the curve has moved too far.
    const minTokens = b.minTokens ? BigInt(String(b.minTokens)) : BigInt(0);
    const minSats = b.minSats ? BigInt(String(b.minSats)) : BigInt(0);
    if (side === 'buy' && q.tokens < minTokens) throw new Error('The price moved past your slippage limit. Quote again.');
    if (side === 'sell' && q.userSats < minSats) throw new Error('The price moved past your slippage limit. Quote again.');

    const plan: Stored = {
      lease,
      side,
      tokenId: token,
      sym: row.sym,
      inputs,
      outputs,
      beef: row.beef,
      quote: {
        tokens: q.tokens.toString(),
        curveSats: q.curveSats.toString(),
        houseFee: q.houseFee.toString(),
        routeFee: q.routeFee.toString(),
        userSats: q.userSats.toString(),
        soldAfter: q.soldAfter.toString(),
        indexFee,
      },
      expires: Date.now() + LEASE_SECS * 1000,
      trader,
      roles,
      tokenAmtAfter: tokenAmtAfter.toString(),
      reserveAfter: reserveAfter.toString(),
      routeAccrued: row.route.kind === 'creator' ? '0' : q.routeFee.toString(),
      fundOwedAfter,
      fundAddress,
      sellerCoins,
      allowedTokenOut: allowed.toString(),
    };
    const { beef: _omit, ...toStore } = plan;
    void _omit;
    await rpc('tokenblaster_launch_set_quote', { p_lease: lease, p_quote: toStore });
    return NextResponse.json({ plan: { ...plan, trader: undefined, roles: undefined } });
  } catch (e) {
    await rpc('tokenblaster_launch_release', { p_lease: lease }).catch(() => undefined);
    throw e;
  }
}

async function leased(lease: unknown): Promise<{ row: CoinRow; plan: Stored }> {
  if (typeof lease !== 'string') throw new Error('No trade in progress.');
  const [row] = await rpc<CoinRow[]>('tokenblaster_launch_by_lease', { p_lease: lease });
  if (!row?.lease_quote) throw new Error('This quote expired. Quote again.');
  return { row, plan: row.lease_quote as unknown as Stored };
}

/** Every extra input/output must leave this coin's tokens alone (except the seller's own). */
function checkTokens(tx: Transaction, plan: Stored): string | null {
  for (let i = plan.inputs.length; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const src = inp.sourceTransaction?.outputs[inp.sourceOutputIndex];
    const op = `${inp.sourceTXID ?? inp.sourceTransaction?.id('hex')}_${inp.sourceOutputIndex}`;
    const j = src ? bsv20Json(src.lockingScript.toHex()) : null;
    const carries = j && (j.id === plan.tokenId || (j.op === 'deploy+mint' && op === plan.tokenId));
    if (carries && !plan.sellerCoins.includes(op)) return 'The transaction spends tokens it was not quoted for.';
    if (!src && plan.sellerCoins.includes(op)) return 'Missing history for your token coin.';
  }
  let extra = BigInt(0);
  for (let i = plan.outputs.length; i < tx.outputs.length; i++) {
    const j = bsv20Json(tx.outputs[i].lockingScript.toHex());
    if (j?.id === plan.tokenId) extra += BigInt(j.amt ?? 0);
  }
  if (extra > BigInt(plan.allowedTokenOut)) return 'The transaction sends more of this coin than it spends.';
  if (plan.side === 'sell') {
    const spent = plan.sellerCoins.filter((c) => tx.inputs.some((inp) => `${inp.sourceTXID ?? inp.sourceTransaction?.id('hex')}_${inp.sourceOutputIndex}` === c));
    if (spent.length !== plan.sellerCoins.length) return 'Your token coins are missing from the transaction.';
  }
  return null;
}

async function sign(b: Record<string, unknown>) {
  const { row, plan } = await leased(b.lease);
  if (plan.expires < Date.now()) throw new Error('This quote expired. Quote again.');
  const tx = Transaction.fromAtomicBEEF(Array.from(Buffer.from(String(b.tx ?? ''), 'hex')));
  const m = matchesPlan(tx, plan);
  if (!m.ok) throw new Error(`Refusing to sign: ${m.why}.`);
  const why = checkTokens(tx, plan);
  if (why) throw new Error(`Refusing to sign: ${why}`);
  const beef = Beef.fromString(row.beef!, 'hex');
  const spends: Record<number, string> = {};
  for (let i = 0; i < plan.inputs.length; i++) {
    const [txid] = plan.inputs[i].outpoint.split('_');
    const src = beef.findTxid(txid)?.tx;
    if (!src) throw new Error('Pool history is missing; try again.');
    const key = poolKey(row.slot, i === 0 ? 'token' : 'reserve');
    spends[i] = await signInput(tx, i, key, src);
  }
  await rpc('tokenblaster_launch_set_quote', { p_lease: plan.lease, p_quote: { ...plan, beef: undefined, signed: true } });
  return NextResponse.json({ spends });
}

async function book(lease: string, plan: Stored, tx: Transaction, oldBeef: string, newBeef?: Beef) {
  const txid = tx.id('hex');
  const beef = newBeef ?? Beef.fromString(oldBeef, 'hex');
  if (!newBeef) beef.mergeTransaction(tx);
  const beefHex = await compactBeef(beef.toHex(), [txid]);
  const q = plan.quote;
  await rpc('tokenblaster_launch_commit', {
    p_lease: lease,
    p_t: {
      txid,
      side: plan.side,
      trader: plan.trader,
      tokens: q.tokens,
      curve_sats: q.curveSats,
      house_fee: q.houseFee,
      route_fee: q.routeFee,
      user_sats: q.userSats,
      sold_after: q.soldAfter,
      reserve_sats: plan.reserveAfter,
      token_utxo: plan.roles.poolToken === null ? null : `${txid}_${plan.roles.poolToken}`,
      token_amt: plan.tokenAmtAfter,
      reserve_utxo: `${txid}_${plan.roles.reserve}`,
      beef: beefHex,
      fund_address: plan.fundAddress,
      fund_owed: plan.fundOwedAfter,
      route_accrued: plan.routeAccrued,
    },
  });
  return txid;
}

async function commit(b: Record<string, unknown>) {
  const { row, plan } = await leased(b.lease);
  const bytes = Array.from(Buffer.from(String(b.tx ?? ''), 'hex'));
  let tx: Transaction;
  let beef: Beef | undefined;
  try {
    tx = Transaction.fromAtomicBEEF(bytes);
    beef = Beef.fromBinary(bytes);
    beef.mergeBeef(Beef.fromString(row.beef!, 'hex'));
  } catch {
    tx = Transaction.fromHex(String(b.tx ?? ''));
  }
  const m = matchesPlan(tx, plan);
  if (!m.ok) throw new Error(`Refusing: ${m.why}.`);
  if (tx.inputs.some((i) => !i.unlockingScript)) throw new Error('The transaction is not fully signed.');
  await broadcast(tx);
  const txid = await book(plan.lease, plan, tx, row.beef!, beef);
  return NextResponse.json({ txid, graduated: BigInt(plan.quote.soldAfter) >= GRAD_SOLD });
}

async function cancel(b: Record<string, unknown>) {
  const { plan } = await leased(b.lease).catch(() => ({ plan: null as Stored | null }));
  // A signed quote can still reach the chain: leave it for reconcile() once it expires.
  if (plan && !plan.signed) await rpc('tokenblaster_launch_release', { p_lease: plan.lease });
  return NextResponse.json({ ok: true });
}
