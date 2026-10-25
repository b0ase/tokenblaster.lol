/**
 * Load the gun with the player's own BSV-21 tokens, from any BRC-100 wallet that keeps tokens the
 * 1Sat way (Yours v5, bWallet, bWalletX): token coins sit in a `bsv21` basket and each records the
 * key it is locked to in customInstructions ({ protocolID, keyID }). We build the transfer, the
 * wallet adds fee inputs, and we ask the wallet to sign the token inputs with that key
 * (createSignature). bWalletX instead signs its own token coins itself (src/lib/siteTokens.ts).
 * One approval prompt; the wallet broadcasts.
 */
import { Beef, Hash, P2PKH, Transaction, TransactionSignature, UnlockingScript, Utils, type SignableTransaction, type WalletInterface, type WalletProtocol } from '@bsv/sdk';
import { bsv21 } from './gun';
import { tokenCoins } from './tokens';
import { ONESAT, listedTokenCoins, receiveKey, receiveNote, siteCoins } from './siteTokens';

export { ONESAT };


/** Where the gun lives, said plainly next to the gun balance and in the load step. */
export const GUN_KEY_NOTE = 'Your gun lives in this browser. Clearing site data loses anything still in it. Unload before you clear.';

/** The note the 1Sat wallets write on a token coin (bsv21 basket): the wallet counts it from this. */
export const noteFor = (id: string, amt: bigint, sym: string, dec: number | undefined, keyID: string, icon?: string | null, protocolID: WalletProtocol = ONESAT) =>
  JSON.stringify({
    id,
    amt: amt.toString(),
    op: 'transfer',
    sym,
    ...(dec !== undefined ? { dec: String(dec) } : {}),
    ...(icon ? { icon } : {}), // the wallet draws the token's icon from this
    protocolID,
    keyID,
    counterparty: 'self',
  });

/**
 * The 1Sat wallets tag every basket output `id:<actionId>_<index>` and only sign token inputs that carry
 * it (@1sat/actions stampManagedOutputIds / sendBsv21). Without it bWalletX can't list or send the coin.
 */
const randomActionId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
export function stampIds<T extends { basket?: string; tags?: string[] }>(outputs: T[] | undefined, actionId = randomActionId()): T[] | undefined {
  outputs?.forEach((o, i) => {
    if (o.basket) o.tags = [...(o.tags ?? []).filter((t) => !t.startsWith('id:')), `id:${actionId}_${i}`];
  });
  return outputs;
}

/** A token coin to spend. `walletSigns`: bWalletX signs it itself after its sheet (no spends from us). */
export type Coin = { outpoint: string; amt: bigint; protocolID: WalletProtocol; keyID: string; walletSigns?: boolean };

/**
 * Coins of `id` covering `amount`: the wallet's own `bsv21` basket first (wallets that let a site
 * read it and sign with the coin's key), else the coins on the receive keys bWalletX gave us.
 */
export async function pickCoins(wallet: WalletInterface, id: string, amount: bigint, filter: (c: { noted: boolean }) => boolean = (c) => c.noted) {
  const { coins: all, beef } = await tokenCoins(wallet, true).catch(() => ({ coins: [], beef: undefined }));
  const pick = (coins: Coin[]) => {
    const use: Coin[] = [];
    let sum = BigInt(0);
    for (const c of [...coins].sort((a, b) => (b.amt > a.amt ? 1 : -1))) {
      if (sum >= amount) break;
      use.push(c);
      sum += c.amt;
    }
    return { use, sum };
  };
  const own = pick(all.filter((c) => c.id === id && c.keyID && filter(c)).map((c) => ({ outpoint: c.outpoint, amt: c.amt, protocolID: c.protocolID ?? ONESAT, keyID: c.keyID! })));
  if (own.sum >= amount) return { ...own, beef };
  // bWalletX: its one-token listing (#128), else the receive addresses it gave us (token index).
  const listed = await listedTokenCoins(wallet, id);
  const site = pick((listed ?? (await siteCoins(id))).map((c) => ({ outpoint: c.outpoint.replace('_', '.'), amt: c.amt, protocolID: ONESAT, keyID: '', walletSigns: true })));
  if (site.sum > own.sum) return { ...site, beef: undefined };
  return { ...own, beef };
}
const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;

/** Send `amount` base units of token `id` from the wallet to `to`. Returns the txid. */
export async function loadTokens(
  wallet: WalletInterface,
  id: string,
  amount: bigint,
  to: string,
  sym = 'tokens',
  shown = amount.toString(),
  fuelSats = 0,
  dec?: number,
  icon?: string | null,
): Promise<Transaction> {
  // Only coins the wallet itself counts (noted), or the ones bWalletX holds on our receive keys.
  const { use, sum, beef } = await pickCoins(wallet, id, amount);
  if (sum < amount) throw new Error(`Your wallet has only ${sum} base units of $${sym} it can spend here.`);

  // Change goes back to the wallet under a fresh key it can find again (same 1Sat convention).
  const change = sum - amount;
  const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = [
    { lockingScript: bsv21(id, amount, to).toHex(), satoshis: 1, outputDescription: `${shown} $${sym} into your gun` },
  ];
  // Fuel: the sats to pay each bullet's fee, in the same transaction (one approval for both).
  if (fuelSats > 0) outputs.push({ lockingScript: new P2PKH().lock(to).toHex(), satoshis: fuelSats, outputDescription: `Fuel to fire them (${fuelSats.toLocaleString()} sats)` });
  if (change > BigInt(0)) outputs.push(await tokenChange(wallet, id, change, sym, dec, icon));

  const created = await wallet.createAction({
    description: `Load ${shown} $${sym} into your TokenBlaster gun as ammunition${fuelSats ? `, plus ${fuelSats.toLocaleString()} sats to fire them` : ''}`,
    inputBEEF: beef,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${sym}` })),
    outputs: stampIds(outputs),
    labels: ['tokenblaster'],
    // signAndProcess: false = hand us the unsigned tx so we can add the token signatures; without it
    // the wallet's permission layer may finish the action itself and our signAction finds it gone.
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
  });
  const signable = created.signableTransaction;
  if (!signable) throw new Error('The wallet did not return a transaction to sign.');
  try {
    return await signAndSend(wallet, signable, use);
  } catch (e) {
    // Release the token coins the half-built action reserved, so the wallet can spend them again.
    await wallet.abortAction({ reference: signable.reference }).catch(() => undefined);
    throw e;
  }
}

/** Token change back to the wallet on a fresh receive key (bWalletX: `{ keyID }` only). */
export async function tokenChange(wallet: WalletInterface, id: string, amt: bigint, sym: string, dec?: number, icon?: string | null, what = `The rest of your $${sym}, back to your wallet`) {
  const k = await receiveKey(wallet, id);
  return {
    lockingScript: bsv21(id, amt, k.address).toHex(),
    satoshis: 1,
    outputDescription: what,
    basket: 'bsv21',
    ...(k.walletSigns ? {} : { tags: [`bsv21:${id}`] }),
    // Other wallets: the notes the 1Sat wallets write (BRC-163 style): token fields + the key.
    customInstructions: receiveNote(k, () => noteFor(id, amt, sym, dec, k.keyID, icon, k.protocolID)),
  };
}

/** Our unlocking scripts for the coins we sign; bWalletX's own coins are left to the wallet. */
export const ourSpends = (wallet: WalletInterface, tx: Transaction, coins: Coin[], base = 0) =>
  tokenSpends(wallet, tx, coins.flatMap((c, k) => (c.walletSigns ? [] : [{ index: base + k, protocolID: c.protocolID, keyID: c.keyID }])));

async function signAndSend(wallet: WalletInterface, signable: SignableTransaction, use: Coin[]): Promise<Transaction> {
  const tx = Transaction.fromAtomicBEEF(signable.tx);
  const spends = await ourSpends(wallet, tx, use);
  const done = await wallet.signAction({ reference: signable.reference, spends });
  if (done.tx) return Transaction.fromAtomicBEEF(done.tx);
  if (use.some((c) => c.walletSigns)) throw new Error('The wallet signed but returned no transaction.');
  tx.inputs.forEach((inp, i) => spends[i] && (inp.unlockingScript = UnlockingScript.fromHex(spends[i].unlockingScript)));
  return tx; // wallet sent it but returned no tx: ours is the same one, now with the token signatures
}

/** Unlocking scripts for the wallet's own token coins at the given input indexes (createSignature). */
export async function tokenSpends(
  wallet: WalletInterface,
  tx: Transaction,
  use: { index: number; protocolID: WalletProtocol; keyID: string }[],
): Promise<Record<number, { unlockingScript: string }>> {
  const spends: Record<number, { unlockingScript: string }> = {};
  const keys = new Map<string, string>(); // one getPublicKey per key, not per coin
  for (const u of use) {
    const i = u.index;
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
    const digest = Hash.sha256(Hash.sha256(preimage));
    const { signature } = await wallet.createSignature({ hashToDirectlySign: digest, protocolID: u.protocolID, keyID: u.keyID, counterparty: 'self' });
    const k = JSON.stringify([u.protocolID, u.keyID]);
    if (!keys.has(k)) keys.set(k, (await wallet.getPublicKey({ protocolID: u.protocolID, keyID: u.keyID, counterparty: 'self' })).publicKey);
    const publicKey = keys.get(k)!;
    const sig = [...signature, SIGHASH];
    const pub = Utils.toArray(publicKey, 'hex');
    spends[i] = {
      unlockingScript: new UnlockingScript([
        { op: sig.length, data: sig },
        { op: pub.length, data: pub },
      ]).toHex(),
    };
  }
  return spends;
}

/**
 * Re-note coins of `id` the wallet holds but can't see: spend them to one fresh coin in the
 * wallet, with the note the wallet counts. One approval; afterwards the wallet shows them.
 */
export async function reNoteTokens(wallet: WalletInterface, id: string, sym: string, dec?: number, icon?: string | null): Promise<Transaction> {
  const { coins, beef } = await tokenCoins(wallet, true);
  const use: Coin[] = coins
    .filter((c) => c.id === id && c.keyID && (!c.noted || !c.tagged || (icon && !c.icon)))
    .map((c) => ({ outpoint: c.outpoint, amt: c.amt, protocolID: c.protocolID ?? ONESAT, keyID: c.keyID! }));
  const total = use.reduce((n, c) => n + c.amt, BigInt(0));
  if (!total) throw new Error('Nothing to fix.');
  const k = await receiveKey(wallet, id);
  const created = await wallet.createAction({
    description: `Show ${total.toLocaleString()} $${sym} in your wallet again (re-save the coin TokenBlaster returned without its note)`,
    inputBEEF: beef,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${sym}` })),
    outputs: [
      {
        lockingScript: bsv21(id, total, k.address).toHex(),
        satoshis: 1,
        outputDescription: `Your $${sym}, back in your wallet`,
        basket: 'bsv21',
        tags: [`bsv21:${id}`, `id:${randomActionId()}_0`],
        customInstructions: receiveNote(k, () => noteFor(id, total, sym, dec, k.keyID, icon, k.protocolID)),
      },
    ],
    labels: ['tokenblaster'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false, signAndProcess: false },
  });
  const signable = created.signableTransaction;
  if (!signable) throw new Error('The wallet did not return a transaction to sign.');
  try {
    return await signAndSend(wallet, signable, use);
  } catch (e) {
    await wallet.abortAction({ reference: signable.reference }).catch(() => undefined);
    throw e;
  }
}

/**
 * Unload: the gun sends all its `id` tokens to a fresh key in the wallet (the 1Sat change-key
 * pattern), then the wallet takes the transaction in with the note it counts (internalizeAction,
 * basket insertion), so the tokens show in the wallet straight away.
 */
export async function returnTokens(
  wallet: WalletInterface,
  gun: { unloadTokens: (id: string, to: string) => Promise<{ tx: Transaction; amt: bigint }> },
  t: { id: string; sym: string; dec?: number; icon?: string | null },
): Promise<{ txid: string; amt: bigint }> {
  const k = await receiveKey(wallet, t.id);
  const { tx, amt } = await gun.unloadTokens(t.id, k.address);
  const txid = tx.id('hex');
  // The wallet wants the tx with its history back to mined transactions (BEEF).
  const beef = new Beef();
  for (const src of new Set(tx.inputs.map((i) => i.sourceTXID ?? i.sourceTransaction!.id('hex')))) {
    const hex = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${src}/beef`).then((r) => (r.ok ? r.text() : ''));
    if (hex) beef.mergeBeef(Utils.toArray(hex.trim(), 'hex'));
    else {
      const bin = await fetch(`https://junglebus.gorillapool.io/v1/transaction/beef/${src}`).then((r) => (r.ok ? r.arrayBuffer() : null));
      if (bin) beef.mergeBeef(Array.from(new Uint8Array(bin)));
    }
  }
  beef.mergeTransaction(tx);
  await wallet.internalizeAction({
    tx: beef.toBinaryAtomic(txid),
    outputs: [
      {
        outputIndex: 0,
        protocol: 'basket insertion',
        insertionRemittance: k.walletSigns
          ? { basket: 'bsv21', customInstructions: receiveNote(k, () => '') }
          : { basket: 'bsv21', tags: [`bsv21:${t.id}`, `id:${randomActionId()}_0`], customInstructions: noteFor(t.id, amt, t.sym, t.dec, k.keyID, t.icon, k.protocolID) },
      },
    ],
    description: `Unload ${amt.toLocaleString()} $${t.sym} from your TokenBlaster gun back to your wallet`,
    labels: ['tokenblaster'],
  });
  return { txid, amt };
}
