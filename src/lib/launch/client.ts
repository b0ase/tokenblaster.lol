/**
 * Browser side of the launchpad: launching a coin and trading on its curve with the player's
 * BRC-100 wallet. Before anything is signed, the plan the server proposes is checked against the
 * player's own quote (same curve code), and the wallet shows every output in its approval prompt.
 */
import { Beef, P2PKH, PublicKey, Transaction, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk';
import { BSV21 } from '@1sat/templates';
import { inscriptionScript } from '../inscribe';
import { ONESAT, noteFor, tokenSpends } from '../tokenLoad';
import { tokenCoins } from '../tokens';
import type { Wallet } from '../wallet';
import { LAUNCH_FEE, quoteBuy, quoteSell } from './curve';
import { matchesPlan, type Route, type TradePlan } from './shape';

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `Server answered ${r.status}.` }));
  if (!r.ok || j.error) throw Object.assign(new Error(j.error ?? `Server answered ${r.status}.`), { status: r.status });
  return j as T;
}

const sha256hex = async (data: Uint8Array) => Utils.toHex(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))));

async function freshTokenKey(wallet: WalletInterface, id: string) {
  const keyID = `${id}-${Date.now()}`; // the 1Sat wallets' own key pattern for token coins
  const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
  return { keyID, address: PublicKey.fromString(publicKey).toAddress() };
}

export type LaunchForm = { sym: string; name: string; description: string; route: Route; image: { bytes: Uint8Array; type: string } };

/** Launch a coin. Returns its token id. */
export async function launchCoin(w: Wallet, f: LaunchForm): Promise<string> {
  const imageSha256 = await sha256hex(f.image.bytes);
  const base = { sym: f.sym, name: f.name, description: f.description, route: f.route, creator: w.address, creatorKey: w.publicKey, imageSha256, imageType: f.image.type };
  const p = await post<{ slot: string; tokenAddress: string; message: string; house: string; launchFee: number }>('/api/launch/new', { step: 'prepare', ...base });
  if (p.launchFee !== LAUNCH_FEE) throw new Error('Unexpected launch fee.');

  const { signature } = await w.client.createSignature({ data: Utils.toArray(p.message, 'utf8'), protocolID: [1, 'tokenblaster launch'], keyID: p.slot, counterparty: 'anyone' });
  const deploy = BSV21.deployMint(f.sym, BigInt(1_000_000_000), 0, '_0').lock(new P2PKH().lock(p.tokenAddress));
  const r = await w.client.createAction({
    description: `Launch $${f.sym} on TokenBlaster: 1,000,000,000 tokens into its bonding curve`,
    outputs: [
      { lockingScript: inscriptionScript(w.address, { contentType: f.image.type, data: Array.from(f.image.bytes) }, { app: 'tokenblaster.lol', type: 'launch', sym: f.sym }).toHex(), satoshis: 1, outputDescription: `$${f.sym} image (yours)` },
      { lockingScript: deploy.toHex(), satoshis: 1, outputDescription: `$${f.sym}: 1B supply into the curve` },
      { lockingScript: new P2PKH().lock(p.house).toHex(), satoshis: LAUNCH_FEE, outputDescription: 'TokenBlaster launch fee' },
    ],
    labels: ['tokenblaster', 'launch'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  if (!r.tx) throw new Error('The wallet returned no transaction.');
  const done = await post<{ token: string }>('/api/launch/new', { step: 'commit', ...base, slot: p.slot, signature: Utils.toHex(signature), tx: Utils.toHex(r.tx) });
  return done.token;
}

export type TradeResult = { txid: string; graduated: boolean };

/**
 * Buy with `amount` sats (fees included) or sell `amount` tokens. `slippageBps` limits how much
 * worse than `sold` (the board's view) the fill may be. Retries while another trade holds the pool.
 */
export async function trade(
  w: Wallet,
  coin: { id: string; sym: string; icon?: string | null },
  side: 'buy' | 'sell',
  amount: bigint,
  sold: bigint,
  slippageBps: number,
  onStatus?: (s: string) => void,
): Promise<TradeResult> {
  const expect = side === 'buy' ? quoteBuy(sold, amount) : quoteSell(sold, amount);
  const minTokens = side === 'buy' ? (expect.tokens * BigInt(10_000 - slippageBps)) / BigInt(10_000) : BigInt(0);
  const minSats = side === 'sell' ? (expect.userSats * BigInt(10_000 - slippageBps)) / BigInt(10_000) : BigInt(0);

  let buyKey: { keyID: string; address: string } | null = null;
  const sellCoins: { outpoint: string; amt: bigint; protocolID: [0 | 1 | 2, string]; keyID: string }[] = [];
  let walletBeef: number[] | undefined;
  if (side === 'buy') buyKey = await freshTokenKey(w.client, coin.id);
  else {
    const { coins, beef } = await tokenCoins(w.client, true);
    const mine = coins.filter((c) => c.id === coin.id && c.keyID && c.noted).sort((a, b) => (b.amt > a.amt ? 1 : -1));
    let sum = BigInt(0);
    for (const c of mine) {
      if (sum >= amount) break;
      sellCoins.push({ outpoint: c.outpoint.replace('.', '_'), amt: c.amt, protocolID: c.protocolID ?? ONESAT, keyID: c.keyID! });
      sum += c.amt;
    }
    if (sum < amount) throw new Error(`Your wallet holds ${sum.toLocaleString()} $${coin.sym}.`);
    walletBeef = beef;
  }

  onStatus?.('Quoting…');
  let plan: TradePlan | null = null;
  for (let tries = 0; !plan; tries++) {
    try {
      ({ plan } = await post<{ plan: TradePlan }>('/api/launch/trade', {
        step: 'prepare',
        token: coin.id,
        side,
        amount: amount.toString(),
        trader: w.address,
        to: buyKey?.address,
        coins: sellCoins.map((c) => c.outpoint),
        minTokens: minTokens.toString(),
        minSats: minSats.toString(),
      }));
    } catch (e) {
      if ((e as { status?: number }).status === 409 && tries < 20) {
        onStatus?.('Another trade is settling on this coin. Waiting…');
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }

  try {
    // Check the server's plan against our own quote before the wallet sees it.
    const q = plan.quote;
    if (side === 'buy') {
      if (BigInt(q.tokens) < minTokens) throw new Error('The price moved past your slippage limit.');
      if (!plan.outputs[0].script.endsWith(new P2PKH().lock(buyKey!.address).toHex()))
        throw new Error('The tokens are not going to your wallet. Refusing.');
    } else if (BigInt(q.userSats) < minSats) throw new Error('The price moved past your slippage limit.');

    const beef = Beef.fromString(plan.beef, 'hex');
    if (walletBeef) beef.mergeBeef(walletBeef);
    const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = plan.outputs.map((o, i) => ({
      lockingScript: o.script,
      satoshis: o.sats,
      outputDescription: o.what,
      ...(side === 'buy' && i === 0
        ? { basket: 'bsv21', tags: [`bsv21:${coin.id}`], customInstructions: noteFor(coin.id, BigInt(q.tokens), coin.sym, 0, buyKey!.keyID, coin.icon) }
        : {}),
    }));
    const sellTotal = sellCoins.reduce((n, c) => n + c.amt, BigInt(0));
    if (side === 'sell' && sellTotal > amount) {
      const ch = await freshTokenKey(w.client, coin.id);
      const left = sellTotal - amount;
      const { bsv21 } = await import('../gun');
      outputs.push({
        lockingScript: bsv21(coin.id, left, ch.address).toHex(),
        satoshis: 1,
        outputDescription: `The rest of your $${coin.sym}`,
        basket: 'bsv21',
        tags: [`bsv21:${coin.id}`],
        customInstructions: noteFor(coin.id, left, coin.sym, 0, ch.keyID, coin.icon),
      });
    }
    const n = Number(q.tokens).toLocaleString();
    onStatus?.('Approve in your wallet…');
    const created = await w.client.createAction({
      description:
        side === 'buy'
          ? `Buy ${n} $${coin.sym} on the TokenBlaster curve for ${(Number(q.userSats) / 1e8).toFixed(6)} BSV + fees`
          : `Sell ${n} $${coin.sym} to the TokenBlaster curve for ${(Number(q.userSats) / 1e8).toFixed(6)} BSV`,
      inputBEEF: beef.toBinary(),
      inputs: [
        ...plan.inputs.map((i) => ({ outpoint: i.outpoint.replace('_', '.'), unlockingScriptLength: 108, inputDescription: i.what })),
        ...sellCoins.map((c) => ({ outpoint: c.outpoint.replace('_', '.'), unlockingScriptLength: 108, inputDescription: `your $${coin.sym}` })),
      ],
      outputs,
      labels: ['tokenblaster', 'launch'],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
    });
    const signable = created.signableTransaction;
    if (!signable) throw new Error('The wallet did not return a transaction to sign.');
    let sent = false;
    try {
      const tx = Transaction.fromAtomicBEEF(signable.tx);
      const m = matchesPlan(tx, plan);
      if (!m.ok) throw new Error(`The wallet changed the trade (${m.why}).`);
      onStatus?.('Pool signing…');
      const { spends: pool } = await post<{ spends: Record<number, string> }>('/api/launch/trade', { step: 'sign', lease: plan.lease, tx: Utils.toHex(signable.tx) });
      const spends: Record<number, { unlockingScript: string }> = {};
      for (const [i, s] of Object.entries(pool)) spends[Number(i)] = { unlockingScript: s };
      const base = plan.inputs.length;
      Object.assign(spends, await tokenSpends(w.client, tx, sellCoins.map((c, k) => ({ index: base + k, protocolID: c.protocolID, keyID: c.keyID }))));
      onStatus?.('Sending…');
      const done = await w.client.signAction({ reference: signable.reference, spends });
      sent = true;
      let finalTx: number[];
      if (done.tx) finalTx = Array.from(done.tx);
      else {
        tx.inputs.forEach((inp, i) => spends[i] && (inp.unlockingScript = UnlockingScript.fromHex(spends[i].unlockingScript)));
        finalTx = tx.toAtomicBEEF();
      }
      return await post<TradeResult>('/api/launch/trade', { step: 'commit', lease: plan.lease, tx: Utils.toHex(finalTx) });
    } catch (e) {
      if (!sent) await w.client.abortAction({ reference: signable.reference }).catch(() => undefined);
      // Once the wallet has sent it, the pool books it when the quote expires (reconcile).
      throw e;
    }
  } catch (e) {
    await post('/api/launch/trade', { step: 'cancel', lease: plan.lease }).catch(() => undefined);
    throw e;
  }
}

/** Claim every holder reward owed to this wallet, straight into the wallet as a payment. */
export async function claimRewards(w: Wallet): Promise<{ txid: string; sats: number }> {
  const info = await fetch(`/api/launch/claim?address=${w.address}`).then((r) => r.json() as Promise<{ sender: string | null; error?: string }>);
  if (!info.sender) throw new Error(info.error ?? 'Claims are not open yet.');
  const rand = () => Utils.toBase64(Array.from(crypto.getRandomValues(new Uint8Array(16))));
  const derivationPrefix = rand();
  const derivationSuffix = rand();
  // BRC-29: a fresh key of the wallet's own, derived against the vault's public key.
  const { publicKey } = await w.client.getPublicKey({ protocolID: [2, '3241645161d8'], keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: info.sender, forSelf: true });
  const payTo = PublicKey.fromString(publicKey).toAddress();
  const ts = String(Date.now());
  const message = `TokenBlaster claim\n${w.address}\npay to ${payTo}\n${ts}`;
  const { signature } = await w.client.createSignature({ data: Utils.toArray(message, 'utf8'), protocolID: [1, 'tokenblaster claim'], keyID: ts, counterparty: 'anyone' });
  const r = await post<{ txid: string; beef: string; outputIndex: number; sats: number; sender: string }>('/api/launch/claim', {
    address: w.address,
    identityKey: w.publicKey,
    signature: Utils.toHex(signature),
    ts,
    payTo,
  });
  await w.client.internalizeAction({
    tx: Utils.toArray(r.beef, 'hex'),
    outputs: [{ outputIndex: r.outputIndex, protocol: 'wallet payment', paymentRemittance: { derivationPrefix, derivationSuffix, senderIdentityKey: r.sender } }],
    description: `TokenBlaster holder rewards (${r.sats.toLocaleString()} sats)`,
    labels: ['tokenblaster', 'rewards'],
  });
  return { txid: r.txid, sats: r.sats };
}
