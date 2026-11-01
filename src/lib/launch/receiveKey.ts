/**
 * Where $TERRORNODE receipts go (bWalletX session, 1 Nov 2026; bWalletX docs/SITE-TOKENS.md "Site tokens").
 * Receipts used to go to PublicKey(identityKey).toAddress(). The wallet never derives that plain key, so its token
 * view never showed them (owner's 393,486 sat at 1PWp… unseen). Now: the wallet hands out a receive key for this
 * token (protocol "bwalletx token receive", keyID = token id), the server pays that address, and once the transfer
 * is mined the page gives it to the wallet (internalizeAction, basket "bsv21", customInstructions { keyID }).
 */
import { PublicKey, Utils, type WalletInterface } from '@bsv/sdk';
import { TERRORNODE_ID } from './receipts';

export const RECEIVE_PROTOCOL: [1, string] = [1, 'bwalletx token receive'];

export type ReceiveKey = { address: string; keyID: string };

/** A fresh receive key for $TERRORNODE. bWalletX returns the keyID it chose (`<tokenId>-<ms>`); others echo ours. */
export async function receiveKey(client: WalletInterface, tokenId = TERRORNODE_ID): Promise<ReceiveKey> {
  const r = (await client.getPublicKey({ protocolID: RECEIVE_PROTOCOL, keyID: tokenId, counterparty: 'self' })) as { publicKey: string; keyID?: string };
  return { address: PublicKey.fromString(r.publicKey).toAddress(), keyID: r.keyID ?? tokenId };
}

/** A mined transfer handed to the wallet: its token output goes into the bsv21 basket under the receive key. */
export async function internalizeReceipt(client: WalletInterface, a: { beef: string; outputIndex: number; keyID: string; count: number }) {
  await client.internalizeAction({
    tx: Utils.toArray(a.beef, 'hex'),
    description: 'Your $TERRORNODE',
    labels: ['tokenblaster', 'terrornode'],
    outputs: [{ outputIndex: a.outputIndex, protocol: 'basket insertion', insertionRemittance: { basket: 'bsv21', customInstructions: JSON.stringify({ keyID: a.keyID }) } }],
  });
}

/** Transfers paid but not yet in the wallet (needs the block first): kept in this browser and retried. */
export type PendingReceive = { transfer: string; keyID: string; count: number; at: number };
export const PENDING_RECEIVE_KEY = 'tokenblaster.receipts.receive';

