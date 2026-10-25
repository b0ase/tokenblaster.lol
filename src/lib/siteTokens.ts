/**
 * Site tokens: how TokenBlaster puts BSV-21 tokens into the player's wallet and spends them again,
 * per bWalletX docs/SITE-TOKENS.md (bwallet PR #125).
 *
 * bWalletX reserves `[0,'onesat']` (the wallet's own token keys). Instead a site asks for a fresh
 * receive key under `[1,'bwalletx token receive']` with the token id as keyID; bWalletX answers with
 * the keyID it picked (`<tokenId>-<ms>`). The token output then goes into the `bsv21` basket with
 * customInstructions `{ keyID }` only, and on a sell the site lists the coin as an input and leaves
 * its signature to the wallet (one sheet, no createSignature).
 *
 * Other BRC-100 wallets: the same getPublicKey returns a key with no keyID. Then we write the full
 * note ourselves (protocolID + keyID = token id) and sign token inputs with createSignature, as
 * before. A wallet that refuses the receive protocol falls back to the old 1Sat key `[0,'onesat']`.
 */
import { PublicKey, type WalletInterface, type WalletProtocol } from '@bsv/sdk';

export const RECEIVE: WalletProtocol = [1, 'bwalletx token receive'];
export const ONESAT: WalletProtocol = [0, 'onesat'];

export type ReceiveKey = {
  protocolID: WalletProtocol;
  keyID: string;
  address: string;
  publicKey: string;
  /** bWalletX: the wallet keeps the record and signs the coin itself. */
  walletSigns: boolean;
};

/** A fresh key in the player's wallet for receiving `tokenId` (buy, change, unload). */
export async function receiveKey(wallet: WalletInterface, tokenId: string): Promise<ReceiveKey> {
  let first: unknown;
  try {
    const r = (await wallet.getPublicKey({ protocolID: RECEIVE, keyID: tokenId, counterparty: 'self' })) as { publicKey: string; keyID?: string };
    const address = PublicKey.fromString(r.publicKey).toAddress();
    if (typeof r.keyID === 'string' && r.keyID) {
      rememberReceive(tokenId, address);
      return { protocolID: RECEIVE, keyID: r.keyID, address, publicKey: r.publicKey, walletSigns: true };
    }
    return { protocolID: RECEIVE, keyID: tokenId, address, publicKey: r.publicKey, walletSigns: false };
  } catch (e) {
    first = e;
  }
  // Older wallets that refuse the receive protocol but still allow the 1Sat key.
  try {
    const keyID = `${tokenId}-${Date.now()}`;
    const { publicKey } = await wallet.getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' });
    return { protocolID: ONESAT, keyID, address: PublicKey.fromString(publicKey).toAddress(), publicKey, walletSigns: false };
  } catch {
    throw first;
  }
}

/** customInstructions for a token output to `k`: just `{ keyID }` for bWalletX, the full note otherwise. */
export function receiveNote(k: ReceiveKey, fullNote: () => string): string {
  return k.walletSigns ? JSON.stringify({ keyID: k.keyID }) : fullNote();
}

// ── Coins bWalletX holds for us (it refuses listOutputs on `bsv21`) ─────────

const STORE = 'tb:receive-addresses';
const memory = new Map<string, string[]>();

function readStore(): Record<string, string[]> {
  try {
    const s = globalThis.localStorage?.getItem(STORE);
    return s ? (JSON.parse(s) as Record<string, string[]>) : {};
  } catch {
    return Object.fromEntries(memory);
  }
}

/** Remember the receive addresses bWalletX gave us per token, so we can find the coins to sell. */
export function rememberReceive(tokenId: string, address: string) {
  const all = readStore();
  const list = [...new Set([...(all[tokenId] ?? []), address])].slice(-200);
  all[tokenId] = list;
  memory.set(tokenId, list);
  try {
    globalThis.localStorage?.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private window: memory only */
  }
}

export const receiveAddresses = (tokenId: string): string[] => readStore()[tokenId] ?? memory.get(tokenId) ?? [];

const GP = 'https://ordinals.gorillapool.io/api';

export type SiteCoin = { outpoint: string; amt: bigint };

/** The player's coins of `tokenId` on the receive keys bWalletX gave this site (token index). */
export async function siteCoins(tokenId: string, fetcher: typeof fetch = fetch): Promise<SiteCoin[]> {
  const out: SiteCoin[] = [];
  for (const a of receiveAddresses(tokenId)) {
    const r = await fetcher(`${GP}/bsv20/${a}/id/${tokenId}`).catch(() => null);
    if (!r?.ok) continue;
    const list = (await r.json().catch(() => [])) as { outpoint: string; amt: string | number; status?: number; spend?: string }[];
    for (const c of list) if (!c.spend && c.status !== -1 && BigInt(c.amt) > BigInt(0)) out.push({ outpoint: c.outpoint.replace('.', '_'), amt: BigInt(c.amt) });
  }
  return out.sort((a, b) => (b.amt > a.amt ? 1 : -1));
}
