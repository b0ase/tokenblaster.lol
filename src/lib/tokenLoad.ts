/**
 * Load the gun with the player's own BSV-21 tokens, from any BRC-100 wallet that keeps tokens the
 * 1Sat way (Yours v5, bWallet, bWalletX): token coins sit in a `bsv21` basket and each records the
 * key it is locked to in customInstructions ({ protocolID, keyID }). We build the transfer, the
 * wallet adds fee inputs, and we ask the wallet to sign the token inputs with that key
 * (createSignature). One approval prompt; the wallet broadcasts.
 */
import { Hash, P2PKH, PublicKey, Transaction, TransactionSignature, UnlockingScript, Utils, type SignableTransaction, type WalletInterface, type WalletProtocol } from '@bsv/sdk';
import { bsv21 } from './gun';
import { tokenCoins } from './tokens';

type Coin = { outpoint: string; amt: bigint; protocolID: WalletProtocol; keyID: string };
const ONESAT: WalletProtocol = [0, 'onesat'];
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
): Promise<Transaction> {
  const { coins: all, beef } = await tokenCoins(wallet, true);
  // This token's coins whose key the wallet recorded (needed to ask it to sign).
  const coins: Coin[] = all
    .filter((c) => c.id === id && c.keyID)
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
    const keyID = `tokenblaster-${Date.now()}`;
    const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
    outputs.push({
      lockingScript: bsv21(id, change, PublicKey.fromString(publicKey).toAddress()).toHex(),
      satoshis: 1,
      outputDescription: `The rest of your $${sym}, back to your wallet`,
      basket: 'bsv21',
      tags: [`bsv21:${id}`],
      // Same notes the 1Sat wallets write (BRC-163 style): token fields + the key it's locked to.
      customInstructions: JSON.stringify({ id, amt: change.toString(), sym, ...(dec !== undefined ? { dec: String(dec) } : {}), protocolID: ONESAT, keyID }),
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

  // Sign each token input with the wallet key it is locked to.
  const spends: Record<number, { unlockingScript: string }> = {};
  const keys = new Map<string, string>(); // one getPublicKey per key, not per coin
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
    const digest = Hash.sha256(Hash.sha256(preimage));
    const { signature } = await wallet.createSignature({ hashToDirectlySign: digest, protocolID: use[i].protocolID, keyID: use[i].keyID, counterparty: 'self' });
    const k = JSON.stringify([use[i].protocolID, use[i].keyID]);
    if (!keys.has(k)) keys.set(k, (await wallet.getPublicKey({ protocolID: use[i].protocolID, keyID: use[i].keyID, counterparty: 'self' })).publicKey);
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
  const done = await wallet.signAction({ reference: signable.reference, spends });
  if (done.tx) return Transaction.fromAtomicBEEF(done.tx);
  tx.inputs.forEach((inp, i) => spends[i] && (inp.unlockingScript = UnlockingScript.fromHex(spends[i].unlockingScript)));
  return tx; // wallet sent it but returned no tx: ours is the same one, now with the token signatures
}
