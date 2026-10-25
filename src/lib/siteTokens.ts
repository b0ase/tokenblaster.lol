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

// ── bWalletX #128: one token's coins, deploy and icon keys ─────────────────

/**
 * The player's coins of one token as bWalletX lists them to a site: `listOutputs` on `bsv21` with
 * exactly one `bsv21:<id>` tag (one sheet per site per token). Returns null when the wallet does
 * not answer that way (other wallets return full outputs without `amount`, or refuse).
 * Throws when the player says no, so the caller can tell them.
 */
export async function listedTokenCoins(wallet: WalletInterface, tokenId: string): Promise<SiteCoin[] | null> {
  const out: SiteCoin[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    let r: { outputs: { outpoint: string; spendable?: boolean; amount?: string }[] };
    try {
      r = (await wallet.listOutputs({ basket: 'bsv21', tags: [`bsv21:${tokenId}`], limit: 1000, offset })) as never;
    } catch (e) {
      if (/You said no/i.test(String((e as Error)?.message ?? e))) throw e;
      return offset ? out : null;
    }
    if (r.outputs.length && r.outputs.some((o) => typeof o.amount !== 'string')) return null; // not the bWalletX shape
    for (const o of r.outputs) if (o.spendable !== false && BigInt(o.amount!) > BigInt(0)) out.push({ outpoint: o.outpoint.replace('.', '_'), amt: BigInt(o.amount!) });
    if (r.outputs.length < 1000) break;
  }
  return out.sort((a, b) => (b.amt > a.amt ? 1 : -1));
}

export const ORDINAL_RECEIVE: WalletProtocol = [1, 'bwalletx ordinal receive'];

/** The image types bWalletX takes into `1sat` as an ordinal (1 byte to 1 MB). */
export const ORDINAL_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];
export const ordinalOk = (contentType: string, size: number) => ORDINAL_TYPES.includes(contentType) && size >= 1 && size <= 1_000_000;

/**
 * A wallet-picked key for a deploy ('deploy') or an image ordinal ('ordinal'). Returns null for
 * wallets that do not pick keyIDs (callers keep their old path).
 */
export async function walletPickedKey(wallet: WalletInterface, kind: 'deploy' | 'ordinal'): Promise<{ keyID: string; address: string } | null> {
  try {
    const r = (await wallet.getPublicKey({ protocolID: kind === 'deploy' ? RECEIVE : ORDINAL_RECEIVE, keyID: kind, counterparty: 'self' })) as { publicKey: string; keyID?: string };
    if (typeof r.keyID !== 'string' || !r.keyID.startsWith(`${kind}-`)) return null;
    return { keyID: r.keyID, address: PublicKey.fromString(r.publicKey).toAddress() };
  } catch {
    return null;
  }
}
