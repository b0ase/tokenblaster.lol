/**
 * Load the gun with the player's own BSV-21 tokens, from any BRC-100 wallet that keeps tokens the
 * 1Sat way (Yours v5, bWallet, bWalletX): token coins sit in a `bsv21` basket and each records the
 * key it is locked to in customInstructions ({ protocolID, keyID }). We build the transfer, the
 * wallet adds fee inputs, and we ask the wallet to sign the token inputs with that key
 * (createSignature). One approval prompt; the wallet broadcasts.
 */
import { Beef, Hash, P2PKH, PublicKey, Transaction, TransactionSignature, UnlockingScript, Utils, type SignableTransaction, type WalletInterface, type WalletProtocol } from '@bsv/sdk';
import { bsv21 } from './gun';
import { tokenCoins } from './tokens';

export const ONESAT: WalletProtocol = [0, 'onesat'];

/** The note the 1Sat wallets write on a token coin (bsv21 basket): the wallet counts it from this. */
export const noteFor = (id: string, amt: bigint, sym: string, dec: number | undefined, keyID: string, icon?: string | null) =>
  JSON.stringify({
    id,
    amt: amt.toString(),
    op: 'transfer',
    sym,
    ...(dec !== undefined ? { dec: String(dec) } : {}),
    ...(icon ? { icon } : {}), // the wallet draws the token's icon from this
    protocolID: ONESAT,
    keyID,
    counterparty: 'self',
  });

type Coin = { outpoint: string; amt: bigint; protocolID: WalletProtocol; keyID: string };
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
  const { coins: all, beef } = await tokenCoins(wallet, true);
  // This token's coins whose key the wallet recorded (needed to ask it to sign).
  const coins: Coin[] = all
    .filter((c) => c.id === id && c.keyID && c.noted) // only coins the wallet itself counts
    .map((c) => ({ outpoint: c.outpoint, amt: c.amt, protocolID: c.protocolID ?? ONESAT, keyID: c.keyID! }));
  coins.sort((a, b) => (b.amt > a.amt ? 1 : -1));
  const use: Coin[] = [];
  let sum = BigInt(0);
  for (const c of coins) {
    if (sum >= amount) break;
    use.push(c);
    sum += c.amt;
  }
  if (sum < amount) throw new Error(`Your wallet has only ${sum} base units of $${sym} it can spend here.`);

  // Change goes back to the wallet under a fresh key it can find again (same 1Sat convention).
  const change = sum - amount;
  const outputs: Parameters<WalletInterface['createAction']>[0]['outputs'] = [
    { lockingScript: bsv21(id, amount, to).toHex(), satoshis: 1, outputDescription: `${shown} $${sym} into your gun` },
  ];
  // Fuel: the sats to pay each bullet's fee, in the same transaction (one approval for both).
  if (fuelSats > 0) outputs.push({ lockingScript: new P2PKH().lock(to).toHex(), satoshis: fuelSats, outputDescription: `Fuel to fire them (${fuelSats.toLocaleString()} sats)` });
  if (change > BigInt(0)) {
    const keyID = `${id}-${Date.now()}`; // the 1Sat wallets' own change key pattern
    const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
    outputs.push({
      lockingScript: bsv21(id, change, PublicKey.fromString(publicKey).toAddress()).toHex(),
      satoshis: 1,
      outputDescription: `The rest of your $${sym}, back to your wallet`,
      basket: 'bsv21',
      tags: [`bsv21:${id}`],
      // Same notes the 1Sat wallets write (BRC-163 style): token fields + the key it's locked to.
      customInstructions: noteFor(id, change, sym, dec, keyID, icon),
    });
  }

  const created = await wallet.createAction({
    description: `Load ${shown} $${sym} into your TokenBlaster gun as ammunition${fuelSats ? `, plus ${fuelSats.toLocaleString()} sats to fire them` : ''}`,
    inputBEEF: beef,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${sym}` })),
    outputs,
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

async function signAndSend(wallet: WalletInterface, signable: SignableTransaction, use: Coin[]): Promise<Transaction> {
  const tx = Transaction.fromAtomicBEEF(signable.tx);
  const spends = await tokenSpends(wallet, tx, use.map((c, i) => ({ ...c, index: i })));
  const done = await wallet.signAction({ reference: signable.reference, spends });
  if (done.tx) return Transaction.fromAtomicBEEF(done.tx);
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
    .filter((c) => c.id === id && c.keyID && (!c.noted || (icon && !c.icon)))
    .map((c) => ({ outpoint: c.outpoint, amt: c.amt, protocolID: c.protocolID ?? ONESAT, keyID: c.keyID! }));
  const total = use.reduce((n, c) => n + c.amt, BigInt(0));
  if (!total) throw new Error('Nothing to fix.');
  const keyID = `${id}-${Date.now()}`;
  const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
  const created = await wallet.createAction({
    description: `Show ${total.toLocaleString()} $${sym} in your wallet again (re-save the coin TokenBlaster returned without its note)`,
    inputBEEF: beef,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${sym}` })),
    outputs: [
      {
        lockingScript: bsv21(id, total, PublicKey.fromString(publicKey).toAddress()).toHex(),
        satoshis: 1,
        outputDescription: `Your $${sym}, back in your wallet`,
        basket: 'bsv21',
        tags: [`bsv21:${id}`],
        customInstructions: noteFor(id, total, sym, dec, keyID, icon),
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
  const keyID = `${t.id}-${Date.now()}`;
  const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
  const { tx, amt } = await gun.unloadTokens(t.id, PublicKey.fromString(publicKey).toAddress());
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
        insertionRemittance: { basket: 'bsv21', tags: [`bsv21:${t.id}`], customInstructions: noteFor(t.id, amt, t.sym, t.dec, keyID, t.icon) },
      },
    ],
    description: `Unload ${amt.toLocaleString()} $${t.sym} from your TokenBlaster gun back to your wallet`,
    labels: ['tokenblaster'],
  });
  return { txid, amt };
}
