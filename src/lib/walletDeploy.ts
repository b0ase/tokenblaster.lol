/**
 * Wallet-side BSV-21 deploys and image ordinals (bWalletX docs/SITE-TOKENS.md step 5, bwallet #128),
 * with the old 1Sat-key path for other wallets. No @1sat/templates here: the scripts are built
 * byte for byte the way bWalletX rebuilds them.
 */
import { P2PKH, Script, Transaction, Utils, type LockingScript, type WalletInterface } from '@bsv/sdk';
import { inscriptionScript } from './inscribe';
import { ONESAT, ordinalOk, walletPickedKey } from './siteTokens';

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

/** BSV-21 deploy+mint inscription + P2PKH, nothing else. JSON: p, op, sym, amt, dec (if > 0), icon (if any). */
export function bsv21Deploy(sym: string, amt: bigint, dec: number, icon: string | undefined, address: string): LockingScript {
  const j: Record<string, string> = { p: 'bsv-20', op: 'deploy+mint', sym, amt: amt.toString() };
  if (dec > 0) j.dec = String(dec);
  if (icon) j.icon = icon;
  return Script.fromASM(`OP_0 OP_IF ${hex('ord')} OP_1 ${hex('application/bsv-20')} OP_0 ${hex(JSON.stringify(j))} OP_ENDIF ${new P2PKH().lock(address).toASM()}`) as LockingScript;
}

const txidOf = (r: { txid?: string; tx?: Parameters<typeof Transaction.fromAtomicBEEF>[0] }) => r.txid ?? (r.tx ? Transaction.fromAtomicBEEF(r.tx).id('hex') : '');

type Fresh = (keyID: string) => Promise<string>;

/** Deploy+mint `supply` to the wallet. Returns the token id (`<txid>_0`). */
export async function deployToWallet(
  wallet: WalletInterface,
  t: { sym: string; supply: bigint; dec: number; icon?: string; description: string; labels: string[]; tags?: string[] },
  oneSatAddress: Fresh,
): Promise<string> {
  const k = await walletPickedKey(wallet, 'deploy');
  const keyID = k?.keyID ?? `ammo-${t.sym}-${Date.now()}`;
  const to = k?.address ?? (await oneSatAddress(keyID));
  const out = { lockingScript: bsv21Deploy(t.sym, t.supply, t.dec, t.icon, to).toHex(), satoshis: 1, outputDescription: `$${t.sym}: deploy+mint` };
  const r = await wallet.createAction({
    description: t.description,
    outputs: [
      k
        ? out // bWalletX: a plain output; it goes into bsv21 with internalizeAction once signed
        : {
            ...out,
            basket: 'bsv21',
            customInstructions: JSON.stringify({ op: 'deploy+mint', sym: t.sym, amt: t.supply.toString(), dec: String(t.dec), icon: t.icon, protocolID: ONESAT, keyID, counterparty: 'self' }),
            tags: t.tags,
          },
    ],
    labels: t.labels,
    options: { randomizeOutputs: false },
  });
  const txid = txidOf(r);
  if (!txid) throw new Error('The wallet did not report a txid.');
  if (k) {
    if (!r.tx) throw new Error('The wallet did not return the deploy transaction.');
    await wallet.internalizeAction({
      tx: r.tx,
      description: `Your new $${t.sym}`,
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'bsv21', customInstructions: JSON.stringify({ keyID }) } }],
      labels: t.labels,
    });
  }
  return `${txid}_0`;
}

/**
 * An image inscription output for the player. bWalletX (#128): a plain inscription to an ordinal key
 * it picked, into '1sat' with { keyID }. Otherwise `fallback()` (the caller's old output).
 */
export async function imageOrdinalOutput<T>(
  wallet: WalletInterface,
  file: { contentType: string; data: number[] },
  what: string,
  fallback: () => Promise<T> | T,
): Promise<T | { lockingScript: string; satoshis: number; outputDescription: string; basket: string; customInstructions: string }> {
  const k = ordinalOk(file.contentType, file.data.length) ? await walletPickedKey(wallet, 'ordinal') : null;
  if (!k) return fallback();
  return { lockingScript: inscriptionScript(k.address, file).toHex(), satoshis: 1, outputDescription: what, basket: '1sat', customInstructions: JSON.stringify({ keyID: k.keyID }) };
}
