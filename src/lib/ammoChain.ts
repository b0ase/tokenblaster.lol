'use client';

/**
 * Ammo on chain, all through the CONNECTED BRC-100 wallet (no server key, nothing signed here
 * except by asking the wallet):
 *  - owner: inscribe an ammo icon, deploy+mint the BSV-21 ammo token, list packs for sale as
 *    OrdLock v2 marketplace listings that pay the house address;
 *  - player: buy a listing (OrdLock v2 purchase path) and receive the tokens in the wallet's
 *    `bsv21` basket, noted the way the 1Sat wallets count them.
 */
import { Beef, Hash, LockingScript, P2PKH, PublicKey, Transaction, TransactionSignature, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk';
import { BSV21, OrdLockV2 } from '@1sat/templates';
import { inscriptionScript } from './inscribe';
import { ONESAT, noteFor, stampIds } from './tokenLoad';
import { tokenCoins } from './tokens';
import type { AmmoDef } from './ammo';

export const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU'; // bCorp's receiving address (public, not a key)
const API = 'https://api.1sat.app/1sat';
const GP = 'https://ordinals.gorillapool.io/api';
const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;

const txidOf = (r: { txid?: string; tx?: Parameters<typeof Transaction.fromAtomicBEEF>[0] }) => r.txid ?? (r.tx ? Transaction.fromAtomicBEEF(r.tx).id('hex') : '');

async function freshAddress(wallet: WalletInterface, keyID: string) {
  const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
  return PublicKey.fromString(publicKey).toAddress();
}

/** Overlay processing fee some BSV-21 tokens need per output so the 1Sat overlay indexes it. */
async function overlayFee(tokenId: string): Promise<{ lockingScript: string; satoshis: number; outputDescription: string } | null> {
  try {
    const r = await fetch(`${API}/bsv21/${tokenId}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: { is_active?: boolean; fee_address?: string; fee_per_output?: number } };
    const s = j.status;
    if (!s?.is_active || !s.fee_address || !s.fee_per_output) return null;
    return { lockingScript: new P2PKH().lock(s.fee_address).toHex(), satoshis: s.fee_per_output, outputDescription: 'Overlay processing fee' };
  } catch {
    return null;
  }
}

// ── Owner: icon + deploy ────────────────────────────────────────────────────

/** Inscribe the ammo icon (PNG) to the owner's wallet. Returns its outpoint, used as the token icon. */
export async function inscribeAmmoIcon(wallet: WalletInterface, def: AmmoDef): Promise<string> {
  const png = def.icon.replace(/\.svg$/, '.png');
  const res = await fetch(png);
  if (!res.ok) throw new Error(`Could not load ${png}`);
  const data = Array.from(new Uint8Array(await res.arrayBuffer()));
  const keyID = `ammo-icon-${def.sym}`;
  const to = await freshAddress(wallet, keyID);
  const r = await wallet.createAction({
    description: `Inscribe the $${def.sym} ammo icon`,
    outputs: [
      {
        lockingScript: inscriptionScript(to, { contentType: 'image/png', data }, { app: 'tokenblaster.lol', type: 'ord', name: `${def.sym} icon` }).toHex(),
        satoshis: 1,
        outputDescription: `$${def.sym} icon`,
        basket: '1sat',
        customInstructions: JSON.stringify({ protocolID: ONESAT, keyID, counterparty: 'self' }),
        tags: ['ammo', `ammo:${def.sym}`],
      },
    ],
    labels: ['tokenblaster', 'ammo'],
    options: { randomizeOutputs: false },
  });
  const txid = txidOf(r);
  if (!txid) throw new Error('The wallet did not report a txid.');
  return `${txid}_0`;
}

/** Deploy+mint the ammo token with its whole supply to the owner's wallet. Returns the token id. */
export async function deployAmmo(wallet: WalletInterface, def: AmmoDef, iconOutpoint: string): Promise<string> {
  const keyID = `ammo-${def.sym}-${Date.now()}`;
  const to = await freshAddress(wallet, keyID);
  const lock = BSV21.deployMint(def.sym, def.supply, def.dec, iconOutpoint || undefined).lock(new P2PKH().lock(to));
  const r = await wallet.createAction({
    description: `Deploy the $${def.sym} ammo token (${def.supply.toLocaleString()} rounds) to your wallet`,
    outputs: [
      {
        lockingScript: lock.toHex(),
        satoshis: 1,
        outputDescription: `$${def.sym} ammo: deploy+mint`,
        basket: 'bsv21',
        // The id is this output's own outpoint, unknown until the txid exists: the wallet note is
        // written after (reNote below if the wallet needs it). tokenCoins also reads deploy outputs.
        customInstructions: JSON.stringify({ op: 'deploy+mint', sym: def.sym, amt: def.supply.toString(), dec: String(def.dec), icon: iconOutpoint, protocolID: ONESAT, keyID, counterparty: 'self' }),
        tags: ['ammo', `ammo:${def.sym}`],
      },
    ],
    labels: ['tokenblaster', 'ammo'],
    options: { randomizeOutputs: false },
  });
  const txid = txidOf(r);
  if (!txid) throw new Error('The wallet did not report a txid.');
  return `${txid}_0`;
}

// ── Owner: list a pack ──────────────────────────────────────────────────────

/**
 * List `pack` rounds of `tokenId` for `priceSats`, as an OrdLock v2 listing. The buyer's payment
 * goes to the house address; the listing can be cancelled with the owner's wallet key.
 * Spends the owner's token coins, returns the rest to the wallet.
 */
export async function listAmmoPack(wallet: WalletInterface, def: AmmoDef, tokenId: string, pack: bigint, priceSats: number): Promise<string> {
  if (pack <= BigInt(0) || priceSats < 1) throw new Error('Pack size and price must be positive.');
  const { coins, beef } = await tokenCoins(wallet, true);
  const mine = coins.filter((c) => c.id === tokenId && c.keyID).sort((a, b) => (b.amt > a.amt ? 1 : -1));
  const use: typeof mine = [];
  let sum = BigInt(0);
  for (const c of mine) {
    if (sum >= pack) break;
    use.push(c);
    sum += c.amt;
  }
  if (sum < pack) throw new Error(`Your wallet holds only ${sum} $${def.sym} it can spend here.`);

  const cancelKey = `ammo-listing-${def.sym}-${Date.now()}`;
  const cancelAddress = await freshAddress(wallet, cancelKey);
  const listing = BSV21.transfer(tokenId, pack).lock(LockingScript.fromHex(OrdLockV2.lock(cancelAddress, HOUSE, priceSats).toHex()));
  const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = [
    {
      lockingScript: listing.toHex(),
      satoshis: 1,
      outputDescription: `Listing: ${pack} $${def.sym} for ${priceSats.toLocaleString()} sats`,
      basket: 'ammo listings',
      customInstructions: JSON.stringify({ protocolID: ONESAT, keyID: cancelKey, counterparty: 'self', tokenId, amt: pack.toString(), price: priceSats }),
      tags: ['ammo', `ammo:${def.sym}`, 'listing'],
    },
  ];
  const change = sum - pack;
  if (change > BigInt(0)) {
    const keyID = `${tokenId}-${Date.now()}`;
    outputs.push({
      lockingScript: BSV21.transfer(tokenId, change).lock(new P2PKH().lock(await freshAddress(wallet, keyID))).toHex(),
      satoshis: 1,
      outputDescription: `The rest of your $${def.sym}`,
      basket: 'bsv21',
      tags: [`bsv21:${tokenId}`],
      customInstructions: noteFor(tokenId, change, def.sym, def.dec, keyID),
    });
  }
  const fee = await overlayFee(tokenId);
  if (fee) outputs.push(fee);

  const created = await wallet.createAction({
    description: `List ${pack} $${def.sym} ammo for ${priceSats.toLocaleString()} sats on the 1Sat market`,
    inputBEEF: beef,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${def.sym}` })),
    outputs: stampIds(outputs),
    labels: ['tokenblaster', 'ammo'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
  });
  const signable = created.signableTransaction;
  if (!signable) throw new Error('The wallet did not return a transaction to sign.');
  try {
    const tx = Transaction.fromAtomicBEEF(signable.tx);
    const spends: Record<number, { unlockingScript: string }> = {};
    for (let i = 0; i < use.length; i++) {
      const input = tx.inputs[i];
      const src = input.sourceTransaction!.outputs[input.sourceOutputIndex];
      const preimage = TransactionSignature.format({
        sourceTXID: input.sourceTXID ?? input.sourceTransaction!.id('hex'),
        sourceOutputIndex: input.sourceOutputIndex,
        sourceSatoshis: src.satoshis ?? 1,
        transactionVersion: tx.version,
        otherInputs: tx.inputs.filter((_, j) => j !== i),
        inputIndex: i,
        outputs: tx.outputs,
        inputSequence: input.sequence ?? 0xffffffff,
        subscript: src.lockingScript,
        lockTime: tx.lockTime,
        scope: SIGHASH,
      });
      const protocolID = use[i].protocolID ?? ONESAT;
      const { signature } = await wallet.createSignature({ hashToDirectlySign: Hash.sha256(Hash.sha256(preimage)), protocolID, keyID: use[i].keyID!, counterparty: 'self' });
      const { publicKey } = await wallet.getPublicKey({ protocolID, keyID: use[i].keyID!, counterparty: 'self' });
      const sig = [...signature, SIGHASH];
      const pub = Utils.toArray(publicKey, 'hex');
      spends[i] = { unlockingScript: new UnlockingScript([{ op: sig.length, data: sig }, { op: pub.length, data: pub }]).toHex() };
    }
    const done = await wallet.signAction({ reference: signable.reference, spends });
    return done.txid ?? (done.tx ? Transaction.fromAtomicBEEF(done.tx).id('hex') : tx.id('hex'));
  } catch (e) {
    await wallet.abortAction({ reference: signable.reference }).catch(() => undefined);
    throw e;
  }
}

// ── Market ──────────────────────────────────────────────────────────────────

export type AmmoListing = { outpoint: string; txid: string; vout: number; amt: bigint; price: number; seller: string; id: string; sym: string; dec: number };

/** Open listings for a token, cheapest per round first (GorillaPool market index). */
export async function ammoListings(tokenId: string, limit = 20): Promise<AmmoListing[]> {
  const r = await fetch(`${GP}/bsv20/market?id=${encodeURIComponent(tokenId)}&sort=price_per_token&dir=asc&limit=${limit}`);
  if (!r.ok) throw new Error(`Market ${r.status}`);
  const rows = (await r.json()) as { txid: string; vout: number; outpoint: string; amt: string; price: string; owner: string; id: string; sym: string; dec: number; spend?: string; listing?: boolean }[];
  return rows
    .filter((x) => x.listing !== false && !x.spend && x.id === tokenId)
    .map((x) => ({ outpoint: x.outpoint, txid: x.txid, vout: x.vout, amt: BigInt(x.amt), price: Number(x.price), seller: x.owner, id: x.id, sym: x.sym, dec: Number(x.dec ?? 0) }))
    .sort((a, b) => a.price / Number(a.amt) - b.price / Number(b.amt));
}

// ── Player: buy ─────────────────────────────────────────────────────────────

/** Sign a P2PKH input locked to a wallet-derived key (SIGHASH_ALL|FORKID). */
async function signWithWallet(wallet: WalletInterface, tx: Transaction, i: number, keyID: string): Promise<string> {
  const input = tx.inputs[i];
  const src = input.sourceTransaction!.outputs[input.sourceOutputIndex];
  const preimage = TransactionSignature.format({
    sourceTXID: input.sourceTXID ?? input.sourceTransaction!.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: src.satoshis ?? 0,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, j) => j !== i),
    inputIndex: i,
    outputs: tx.outputs,
    inputSequence: input.sequence ?? 0xffffffff,
    subscript: src.lockingScript,
    lockTime: tx.lockTime,
    scope: SIGHASH,
  });
  const { signature } = await wallet.createSignature({ hashToDirectlySign: Hash.sha256(Hash.sha256(preimage)), protocolID: ONESAT, keyID, counterparty: 'self' });
  const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
  const sig = [...signature, SIGHASH];
  const pub = Utils.toArray(publicKey, 'hex');
  return new UnlockingScript([{ op: sig.length, data: sig }, { op: pub.length, data: pub }]).toHex();
}

/**
 * Buy a listing through the player's wallet (OrdLock v2 purchase path: no signature, the
 * contract checks the output at the listing's index pays the seller). Two approvals:
 *  1. front funding: a payment-sized output to a wallet key, which must sit at input 0 so the
 *     listed token's satoshi lands on the buyer's output (first-sat ordering);
 *  2. the purchase itself: front funding, the listing, then the wallet's own fee inputs.
 * Returns the purchase txid.
 */
export async function buyAmmo(wallet: WalletInterface, l: AmmoListing, icon?: string | null): Promise<string> {
  const br = await fetch(`${API}/beef/${l.txid}`);
  if (!br.ok) throw new Error('Could not load the listing transaction.');
  const listingBeef = Beef.fromBinary(Array.from(new Uint8Array(await br.arrayBuffer())));
  const srcTx = listingBeef.findTxid(l.txid)?.tx;
  const src = srcTx?.outputs[l.vout];
  if (!srcTx || !src) throw new Error('Listing output not found.');
  if (!OrdLockV2.decode(src.lockingScript)) throw new Error('This listing uses an old marketplace lock this store does not buy. Try another pack.');
  const payout = OrdLockV2.payoutOutput(src.lockingScript);
  const paySats = payout.satoshis ?? 0;

  // 1. Front funding, exactly the payout (no cushion: its slot becomes a 0-sat filler).
  const fundKey = `ammo-front-${Date.now()}`;
  const fundAddr = await freshAddress(wallet, fundKey);
  const prep = await wallet.createAction({
    description: `Set aside ${paySats.toLocaleString()} sats to buy ${l.amt} $${l.sym} ammo`,
    outputs: [
      {
        lockingScript: new P2PKH().lock(fundAddr).toHex(),
        satoshis: paySats,
        outputDescription: `Payment for $${l.sym} ammo`,
        basket: 'ammo funding',
        customInstructions: JSON.stringify({ protocolID: ONESAT, keyID: fundKey, counterparty: 'self' }),
        tags: ['ammo', 'funding'],
      },
    ],
    labels: ['tokenblaster', 'ammo'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  if (!prep.tx) throw new Error('The wallet did not return the funding transaction.');
  const prepTx = Transaction.fromAtomicBEEF(prep.tx);
  const prepTxid = prepTx.id('hex');

  // 2. The purchase, laid out by the template: [filler] [payout] [receive], then wallet change.
  const keyID = `${l.id}-${Date.now()}`;
  const receive = {
    lockingScript: BSV21.transfer(l.id, l.amt).lock(new P2PKH().lock(await freshAddress(wallet, keyID))),
    satoshis: 1,
  };
  const plan = OrdLockV2.planPurchase({ frontSatoshis: [paySats], listings: [src.lockingScript], receives: [receive as never], cushionScript: new P2PKH().lock(fundAddr) });
  const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = plan.outputs.map((o, i) =>
    i === plan.receiveVouts[0]
      ? { lockingScript: o.lockingScript.toHex(), satoshis: 1, outputDescription: `${l.amt} $${l.sym} ammo`, basket: 'bsv21', tags: [`bsv21:${l.id}`], customInstructions: noteFor(l.id, l.amt, l.sym, l.dec, keyID, icon) }
      : { lockingScript: o.lockingScript.toHex(), satoshis: o.satoshis ?? 0, outputDescription: i === plan.payoutVouts[0] ? 'Payment to the seller (TokenBlaster)' : 'Layout filler' },
  );
  const fee = await overlayFee(l.id);
  if (fee) outputs.push(fee);

  const beef = new Beef();
  beef.mergeBeef(listingBeef);
  beef.mergeBeef(Beef.fromBinary(Array.from(prep.tx)));
  const created = await wallet.createAction({
    description: `Buy ${l.amt} $${l.sym} ammo for ${paySats.toLocaleString()} sats`,
    inputBEEF: beef.toBinary(),
    inputs: [
      { outpoint: `${prepTxid}.0`, unlockingScriptLength: 108, inputDescription: 'Ammo payment' },
      { outpoint: `${l.txid}.${l.vout}`, unlockingScriptLength: OrdLockV2.estimatePurchaseUnlockLength(src.lockingScript), inputDescription: `$${l.sym} listing` },
    ],
    outputs: stampIds(outputs),
    labels: ['tokenblaster', 'ammo'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
  });
  const signable = created.signableTransaction;
  if (!signable) throw new Error('The wallet did not return a transaction to sign.');
  try {
    const tx = Transaction.fromAtomicBEEF(signable.tx);
    tx.inputs[0].sourceTransaction ??= prepTx;
    tx.inputs[1].sourceTransaction ??= srcTx;
    const unlock = await OrdLockV2.purchaseListing(src.satoshis ?? 1, src.lockingScript, { deliveries: [{ vout: plan.receiveVouts[0], lockingScript: receive.lockingScript }] } as never).sign(tx, 1);
    const spends = { 0: { unlockingScript: await signWithWallet(wallet, tx, 0, fundKey) }, 1: { unlockingScript: unlock.toHex() } };
    const done = await wallet.signAction({ reference: signable.reference, spends });
    return done.txid ?? (done.tx ? Transaction.fromAtomicBEEF(done.tx).id('hex') : tx.id('hex'));
  } catch (e) {
    await wallet.abortAction({ reference: signable.reference }).catch(() => undefined);
    throw e;
  }
}
