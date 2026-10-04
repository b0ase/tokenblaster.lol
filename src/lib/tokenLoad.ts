/**
 * Load the gun with the player's own BSV-21 tokens, from any BRC-100 wallet that keeps tokens the
 * 1Sat way (Yours v5, bWallet, bWalletX): token coins sit in a `bsv21` basket and each records the
 * key it is locked to in customInstructions ({ protocolID, keyID }). We build the transfer, the
 * wallet adds fee inputs, and we ask the wallet to sign the token inputs with that key
 * (createSignature). One approval prompt; the wallet broadcasts.
 */
import { Hash, PublicKey, Transaction, TransactionSignature, UnlockingScript, Utils, type WalletInterface, type WalletProtocol } from '@bsv/sdk';
import { bsv21 } from './gun';

type Coin = { outpoint: string; amt: bigint; protocolID: WalletProtocol; keyID: string };
const ONESAT: WalletProtocol = [0, 'onesat'];
const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;

const amtOf = (hex: string): { id?: string; amt?: string; op?: string } | null => {
  let text = '';
  for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  const m = text.match(/\{"p":"bsv-20"[^}]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

/** Send `amount` base units of token `id` from the wallet to `to`. Returns the txid. */
export async function loadTokens(wallet: WalletInterface, id: string, amount: bigint, to: string, sym = 'tokens'): Promise<string> {
  const listed = await wallet.listOutputs({
    basket: 'bsv21',
    include: 'entire transactions',
    includeTags: true,
    includeCustomInstructions: true,
    limit: 10000,
  });
  // The wallet's coins of this token, with the key each is locked to.
  const coins: Coin[] = [];
  for (const o of listed.outputs) {
    if (!o.spendable) continue;
    const ins = amtOf(o.lockingScript ?? '');
    const tagId = o.tags?.find((t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy' && t !== 'bsv21:auth')?.slice(6);
    const coinId = tagId ?? ins?.id ?? (ins?.op === 'deploy+mint' ? o.outpoint.replace('.', '_') : undefined);
    if (coinId !== id || !ins?.amt) continue;
    let ci: { protocolID?: WalletProtocol; keyID?: string } = {};
    try {
      ci = JSON.parse(o.customInstructions ?? '{}');
    } catch {
      /* none */
    }
    if (!ci.keyID) continue; // can't ask the wallet to sign without knowing the key
    coins.push({ outpoint: o.outpoint, amt: BigInt(ins.amt), protocolID: ci.protocolID ?? ONESAT, keyID: ci.keyID });
  }
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
    { lockingScript: bsv21(id, amount, to).toHex(), satoshis: 1, outputDescription: `Load gun: ${sym}` },
  ];
  if (change > BigInt(0)) {
    const keyID = `tokenblaster-${Date.now()}`;
    const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
    outputs.push({
      lockingScript: bsv21(id, change, PublicKey.fromString(publicKey).toAddress()).toHex(),
      satoshis: 1,
      outputDescription: `${sym} change`,
      basket: 'bsv21',
      tags: [`bsv21:${id}`],
      customInstructions: JSON.stringify({ protocolID: ONESAT, keyID }),
    });
  }

  const created = await wallet.createAction({
    description: `TokenBlaster: load ${amount} $${sym} into your gun`,
    inputBEEF: listed.BEEF,
    inputs: use.map((c) => ({ outpoint: c.outpoint, unlockingScriptLength: 108, inputDescription: `$${sym}` })),
    outputs,
    labels: ['tokenblaster'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  const signable = created.signableTransaction;
  if (!signable) throw new Error('The wallet did not return a transaction to sign.');
  const tx = Transaction.fromAtomicBEEF(signable.tx);

  // Sign each token input with the wallet key it is locked to.
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
    const digest = Hash.sha256(Hash.sha256(preimage));
    const { signature } = await wallet.createSignature({ hashToDirectlySign: digest, protocolID: use[i].protocolID, keyID: use[i].keyID, counterparty: 'self' });
    const { publicKey } = await wallet.getPublicKey({ protocolID: use[i].protocolID, keyID: use[i].keyID, counterparty: 'self' });
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
  return done.txid ?? (done.tx ? Transaction.fromAtomicBEEF(done.tx).id('hex') : '');
}
