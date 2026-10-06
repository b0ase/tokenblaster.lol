/**
 * The fee vaults (server only). Each coin whose 0.30% does not go to its creator collects it in a
 * vault address; a job (POST /api/launch/vault, run every ~10 minutes by worker/vault.ts) spends
 * only confirmed vault coins:
 *   split:   pays each wallet its share once the smallest share is worth 600 sats
 *   holders: credits what's there to wallets holding ≥100,000 tokens, pro rata; they claim it
 *   buyback: once it holds 100,000 sats, buys the coin on its own curve (≤2% price move) and
 *            sends the tokens to the burn address
 */
import 'server-only';
import { Beef, P2PKH, SatoshisPerKilobyte, Script, Transaction, type PrivateKey } from '@bsv/sdk';
import { BURN_ADDRESS } from '../gun';
import { INDEX_FEE, SUPPLY, quoteBuy } from './curve';
import { p2pkh, tokenOut } from './shape';
import { HOUSE, broadcast, compactBeef, fundAddressOf, poolKey, rpc, type CoinRow } from './server';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const FEE_RATE = 100;
export const HOLDER_MIN = 100_000;
const SPLIT_MIN = 600;
const BUYBACK_MIN = 100_000;

type Utxo = { txid: string; vout: number; sats: number; tx: Transaction };

/** Confirmed coins at an address, with their source transactions. */
export async function confirmedUtxos(address: string, skip = new Set<string>()): Promise<Utxo[]> {
  const r = await fetch(`${WOC}/address/${address}/confirmed/unspent`, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = (await r.json()) as { result?: { tx_hash: string; tx_pos: number; value: number }[] } | { tx_hash: string; tx_pos: number; value: number }[];
  const list = Array.isArray(j) ? j : (j.result ?? []);
  const out: Utxo[] = [];
  for (const u of list.slice(0, 200)) {
    if (skip.has(`${u.tx_hash}_${u.tx_pos}`) || u.value < 2) continue; // 1-sat outputs may be ordinals/tokens: never spend them
    const hex = await fetch(`${WOC}/tx/${u.tx_hash}/hex`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : ''));
    if (!hex) continue;
    out.push({ txid: u.tx_hash, vout: u.tx_pos, sats: u.value, tx: Transaction.fromHex(hex.trim()) });
  }
  return out;
}

/** Spend `coins` (all locked to `key`) to `outputs`, change back to `changeTo`. */
export async function spend(coins: Utxo[], key: PrivateKey, outputs: { address: string; sats: number }[], changeTo: string) {
  const tx = new Transaction();
  for (const c of coins) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
  for (const o of outputs) tx.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
  tx.addOutput({ lockingScript: new P2PKH().lock(changeTo), change: true });
  await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
  await tx.sign();
  await broadcast(tx);
  return tx;
}

/**
 * Forward a coin's launch index money (held at its 'index' address) to the token's GorillaPool fund.
 * Unconfirmed coins are fine. No-op until the indexer knows the token (it then publishes the fund address).
 */
export async function forwardIndexFund(slot: string, tokenId: string): Promise<number> {
  const from = poolKey(slot, 'index').toAddress();
  const r = await fetch(`${WOC}/address/${from}/unspent/all`, { cache: 'no-store' });
  if (!r.ok) return 0;
  const list = ((await r.json()) as { result?: { tx_hash: string; tx_pos: number; value: number }[] }).result ?? [];
  const coins: Utxo[] = [];
  for (const u of list) {
    if (u.value < 2) continue;
    const hex = await fetch(`${WOC}/tx/${u.tx_hash}/hex`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : ''));
    if (hex) coins.push({ txid: u.tx_hash, vout: u.tx_pos, sats: u.value, tx: Transaction.fromHex(hex.trim()) });
  }
  if (!coins.length) return 0;
  const fund = await fundAddressOf(tokenId);
  if (!fund) return 0;
  const tx = await spend(coins, poolKey(slot, 'index'), [], fund); // everything, less the network fee, to the fund
  return tx.outputs.reduce((n, o) => n + (o.satoshis ?? 0), 0);
}

type Trade = { trader: string; side: string; tokens: number };
async function holdersOf(token: string) {
  const trades = await rpc<Trade[]>('tokenblaster_launch_trades_for', { p_token: token, p_trader: null, p_limit: 1000 }, false);
  const m = new Map<string, number>();
  for (const t of trades) if (t.side === 'buy' || t.side === 'sell') m.set(t.trader, (m.get(t.trader) ?? 0) + (t.side === 'buy' ? t.tokens : -t.tokens));
  return [...m].filter(([, n]) => n >= HOLDER_MIN);
}

type VaultCoin = { slot: string; token_id: string; sym: string; route: { kind: string; to?: { address: string; bps: number }[] }; vault_address: string; owed: number };

export async function runVaults() {
  const log: string[] = [];
  // Launch index money still waiting for the indexer to publish the fund address.
  const all = await rpc<{ slot: string; token_id: string; sym: string }[]>('tokenblaster_launch_board', {}, false).catch(() => []);
  for (const c of all) {
    const sent = await forwardIndexFund(c.slot, c.token_id).catch(() => 0);
    if (sent) log.push(`${c.sym}: ${sent} sats to its index fund`);
  }
  const coins = await rpc<VaultCoin[]>('tokenblaster_launch_vault_coins', {});
  for (const c of coins) {
    try {
      const key = poolKey(c.slot, 'vault');
      const utxos = await confirmedUtxos(c.vault_address);
      const balance = utxos.reduce((n, u) => n + u.sats, 0);
      const free = balance - Number(c.owed) - 500; // keep what holders are owed, plus a fee margin
      if (free <= 0) continue;

      if (c.route.kind === 'split' && c.route.to) {
        const minBps = Math.min(...c.route.to.map((t) => t.bps));
        if ((free * minBps) / 10_000 < SPLIT_MIN) continue;
        const outs = c.route.to.map((t) => ({ address: t.address, sats: Math.floor((free * t.bps) / 10_000) }));
        const tx = await spend(utxos, key, outs, c.vault_address);
        await rpc('tokenblaster_launch_payout', { p_txid: tx.id('hex'), p_slot: c.slot, p_kind: 'split', p_sats: outs.reduce((n, o) => n + o.sats, 0), p_tokens: 0, p_detail: { outs } });
        log.push(`${c.sym}: split ${free}`);
      } else if (c.route.kind === 'holders') {
        if (free < 1_000) continue;
        const hs = await holdersOf(c.token_id);
        const total = hs.reduce((n, [, t]) => n + t, 0);
        if (!total) continue;
        const rows = hs.map(([address, t]) => ({ address, sats: Math.floor((free * t) / total) })).filter((r) => r.sats > 0);
        await rpc('tokenblaster_launch_owe', { p_slot: c.slot, p_rows: rows });
        await rpc('tokenblaster_launch_payout', { p_txid: `credit-${Date.now()}`, p_slot: c.slot, p_kind: 'holders', p_sats: rows.reduce((n, r) => n + r.sats, 0), p_tokens: 0, p_detail: { holders: rows.length } });
        log.push(`${c.sym}: credited ${free} to ${rows.length} holders`);
      } else if (c.route.kind === 'buyback' && free >= BUYBACK_MIN) {
        const r = await buyback(c, utxos, key, free);
        if (r) log.push(`${c.sym}: bought back and burned ${r.tokens} for ${r.sats} sats`);
      }
    } catch (e) {
      log.push(`${c.sym}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return log;
}

/** The vault buys its own coin on the curve and burns it, as one transaction, at most a 2% move. */
async function buyback(c: VaultCoin, utxos: Utxo[], vaultKey: PrivateKey, free: number) {
  const lease = crypto.randomUUID();
  const [row] = await rpc<CoinRow[]>('tokenblaster_launch_lease', { p_token: c.token_id, p_lease: lease, p_secs: 60 });
  if (!row) return null; // someone is trading: next run
  try {
    if (!row.token_utxo || !row.beef) return null;
    const sold = BigInt(row.sold);
    const v = Number(BigInt(100_000_000) + BigInt(row.reserve_sats));
    const maxNet = Math.floor(v * 0.00995); // price ∝ V², so +0.995% of V ≈ +2% price
    const spendSats = Math.min(free - 2_000, Math.floor(maxNet / 0.99));
    if (spendSats < 10_000) return null;
    const q = quoteBuy(sold, BigInt(spendSats));
    if (q.tokens <= BigInt(0)) return null;
    const beef = Beef.fromString(row.beef, 'hex');
    const src = (op: string) => beef.findTxid(op.split('_')[0])!.tx!;
    const fundAddress = row.fund_address ?? (await fundAddressOf(c.token_id));
    const tokenAfter = BigInt(row.token_amt) - q.tokens;
    const reserveAfter = BigInt(row.reserve_sats) + q.curveSats;

    const tx = new Transaction();
    const tokenKey = poolKey(row.slot, 'token');
    const reserveKey = poolKey(row.slot, 'reserve');
    tx.addInput({ sourceTransaction: src(row.token_utxo), sourceOutputIndex: Number(row.token_utxo.split('_')[1]), unlockingScriptTemplate: new P2PKH().unlock(tokenKey) });
    if (row.reserve_utxo) tx.addInput({ sourceTransaction: src(row.reserve_utxo), sourceOutputIndex: Number(row.reserve_utxo.split('_')[1]), unlockingScriptTemplate: new P2PKH().unlock(reserveKey) });
    for (const u of utxos) tx.addInput({ sourceTransaction: u.tx, sourceOutputIndex: u.vout, unlockingScriptTemplate: new P2PKH().unlock(vaultKey) });
    tx.addOutput({ lockingScript: Script.fromHex(tokenOut(c.token_id, q.tokens, BURN_ADDRESS)), satoshis: 1 });
    let poolTokenIdx: number | null = null;
    if (tokenAfter > BigInt(0)) {
      poolTokenIdx = tx.outputs.length;
      tx.addOutput({ lockingScript: Script.fromHex(tokenOut(c.token_id, tokenAfter, row.token_address)), satoshis: 1 });
    }
    const reserveIdx = tx.outputs.length;
    tx.addOutput({ lockingScript: Script.fromHex(p2pkh(row.reserve_address)), satoshis: Number(reserveAfter) });
    if (q.houseFee > BigInt(0)) tx.addOutput({ lockingScript: Script.fromHex(p2pkh(HOUSE)), satoshis: Number(q.houseFee) });
    let fundOwed = Number(row.fund_owed) + (tokenAfter > BigInt(0) ? 2 : 1) * INDEX_FEE;
    if (fundAddress) {
      const pay = Math.min(fundOwed, 5 * INDEX_FEE);
      fundOwed -= pay;
      tx.addOutput({ lockingScript: Script.fromHex(p2pkh(fundAddress)), satoshis: pay });
    }
    // No route fee on a buyback (it would only come back to this vault): the 0.30% stays in the curve's favour.
    tx.addOutput({ lockingScript: new P2PKH().lock(c.vault_address), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();
    await broadcast(tx);
    const txid = tx.id('hex');
    beef.mergeTransaction(tx);
    await rpc('tokenblaster_launch_commit', {
      p_lease: lease,
      p_t: {
        txid,
        side: 'burn',
        trader: c.vault_address,
        tokens: q.tokens.toString(),
        curve_sats: q.curveSats.toString(),
        house_fee: q.houseFee.toString(),
        route_fee: '0',
        user_sats: (q.curveSats + q.houseFee).toString(),
        sold_after: q.soldAfter.toString(),
        reserve_sats: reserveAfter.toString(),
        token_utxo: poolTokenIdx === null ? null : `${txid}_${poolTokenIdx}`,
        token_amt: tokenAfter.toString(),
        reserve_utxo: `${txid}_${reserveIdx}`,
        beef: await compactBeef(beef.toHex(), [txid]),
        fund_address: fundAddress,
        fund_owed: fundOwed,
        route_accrued: '0',
        mm: true,
      },
    });
    await rpc('tokenblaster_launch_payout', { p_txid: txid, p_slot: c.slot, p_kind: 'buyback', p_sats: Number(q.curveSats + q.houseFee), p_tokens: Number(q.tokens), p_detail: { supplyLeft: Number(SUPPLY) } });
    return { tokens: Number(q.tokens), sats: Number(q.curveSats) };
  } catch (e) {
    await rpc('tokenblaster_launch_release', { p_lease: lease }).catch(() => undefined);
    throw e;
  }
}
