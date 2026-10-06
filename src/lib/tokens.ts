/** BSV-20/21 token data from the GorillaPool ordinals API (CORS-enabled, no key). */
import { Beef, type WalletInterface } from '@bsv/sdk';
const API = 'https://ordinals.gorillapool.io/api';

export type Token = { id: string; sym: string; icon: string | null; dec: number; balance?: number };


export const iconUrl = (icon: string | null) =>
  !icon ? null : /^(https?:|data:)/.test(icon) ? icon : `https://ordfs.network/${icon.replace(/^ord:\/\//, '').replace('.', '_')}`;

type Raw = { id?: string; tick?: string; sym?: string; icon?: string | null; dec?: number; all?: { confirmed: string; pending: string } };

const toToken = (r: Raw): Token | null => {
  const id = r.id ?? r.tick;
  if (!id) return null;
  const dec = Number(r.dec ?? 0);
  const t: Token = { id, sym: r.sym ?? r.tick ?? id.slice(0, 8), icon: r.icon ?? null, dec };
  if (r.all) t.balance = (Number(r.all.confirmed) + Number(r.all.pending)) / 10 ** dec;
  return t;
};

/** Tokens an address holds, largest balance first. */
export async function tokensHeld(address: string): Promise<Token[]> {
  const r = await fetch(`${API}/bsv20/${address}/balance`);
  if (!r.ok) throw new Error(`GorillaPool ${r.status}`);
  return ((await r.json()) as Raw[])
    .map(toToken)
    .filter((t): t is Token => Boolean(t))
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
}

/** One BSV-21 token by id (`<txid>_<vout>`). */
export async function tokenById(id: string): Promise<Token> {
  const r = await fetch(`${API}/bsv20/id/${id}`);
  if (!r.ok) throw new Error(`No BSV-21 token with id ${id}`);
  const t = toToken((await r.json()) as Raw);
  if (!t) throw new Error(`No BSV-21 token with id ${id}`);
  return t;
}

/** One BSV-21 coin in a 1Sat-style wallet (Yours v5, bWallet, bWalletX). */
export type TokenCoin = {
  outpoint: string;
  id: string;
  amt: bigint;
  sym?: string;
  dec?: number;
  icon?: string;
  protocolID?: [0 | 1 | 2, string];
  keyID?: string;
  lockingScript?: string;
  /** The coin's note carries its amount: the wallet counts it. Without, the wallet can't see it. */
  noted: boolean;
  /** Carries the 1Sat `id:` tag: without it bWalletX can't list or send the coin. */
  tagged: boolean;
};

const norm = (op: string) => op.replace('.', '_');

/**
 * Every spendable token coin in the wallet, read the way the 1Sat wallets read them: the `bsv21`
 * basket (and its legacy name), 500 at a time; token id and amount from each coin's
 * customInstructions, then its tags, then the deploy outpoint, then the inscription itself.
 */
export async function tokenCoins(wallet: WalletInterface, withScripts = false): Promise<{ coins: TokenCoin[]; beef?: number[] }> {
  const coins: TokenCoin[] = [];
  const beef = new Beef();
  for (const basket of ['bsv21', 'p 1sat bsv21']) {
    for (let offset = 0; offset < 20000; offset += 500) {
      const r = await wallet
        .listOutputs({ basket, include: withScripts ? 'entire transactions' : 'locking scripts', includeTags: true, includeCustomInstructions: true, limit: 500, offset })
        .catch(() => null);
      if (!r) break;
      if (withScripts && r.BEEF) beef.mergeBeef(Array.from(r.BEEF)); // every page's source txs, for spending
      for (const o of r.outputs) {
        if (o.spendable === false || !o.outpoint) continue;
        let ci: Record<string, unknown> = {};
        try {
          ci = o.customInstructions ? JSON.parse(o.customInstructions) : {};
        } catch {
          /* not JSON */
        }
        const tags = o.tags ?? [];
        const ins = inscriptionJson(o.lockingScript ?? '');
        const tagId = tags.find((t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy' && t !== 'bsv21:auth')?.slice(6);
        const isDeploy = tags.includes('bsv21:deploy') || ins?.op === 'deploy+mint';
        const id = (typeof ci.id === 'string' && ci.id) || tagId || ins?.id || (isDeploy ? o.outpoint : '');
        const amt = (typeof ci.amt === 'string' && ci.amt) || ins?.amt;
        if (!id || tags.includes('bsv21:auth')) continue;
        if (!amt && !withScripts) continue; // whole-tx mode: amount comes from the tx below
        coins.push({
          outpoint: o.outpoint,
          id: norm(id),
          amt: BigInt(amt ?? 0),
          sym: typeof ci.sym === 'string' ? ci.sym : undefined,
          dec: ci.dec !== undefined ? Number(ci.dec) : undefined,
          icon: typeof ci.icon === 'string' ? ci.icon : undefined,
          protocolID: Array.isArray(ci.protocolID) ? (ci.protocolID as [0 | 1 | 2, string]) : undefined,
          keyID: typeof ci.keyID === 'string' ? ci.keyID : undefined,
          lockingScript: o.lockingScript,
          noted: typeof ci.amt === 'string' && ci.amt !== '0',
          tagged: tags.some((t) => t.startsWith('id:')),
        });
      }
      if (r.outputs.length < 500) break;
    }
  }
  // With whole transactions the wallet leaves out lockingScript: read the amount from the tx itself.
  if (withScripts) {
    for (const c of coins) {
      if (c.amt > BigInt(0)) continue;
      const [txid, vout] = c.outpoint.split(/[._]/);
      const script = beef.findTxid(txid)?.tx?.outputs[Number(vout)]?.lockingScript.toHex();
      const ins = script ? inscriptionJson(script) : null;
      if (ins?.amt) c.amt = BigInt(ins.amt);
      if (script) c.lockingScript = script;
    }
  }
  return { coins: coins.filter((c) => c.amt > BigInt(0)), beef: withScripts ? beef.toBinary() : undefined };

}

/**
 * The tokens actually in the player's wallet, with balances. Falls back to the GorillaPool index
 * for the wallet's address (wallets that don't keep token baskets).
 */
export async function walletTokens(w: { client: WalletInterface; address: string }, quick?: (t: Token[]) => void): Promise<Token[]> {
  const { coins: every } = await tokenCoins(w.client).catch(() => ({ coins: [] as TokenCoin[] }));
  // Exactly what the wallet itself counts as yours (the 1Sat rule: the coin's note has its amount).
  const coins = every.filter((c) => c.noted);
  if (!every.length) return tokensHeld(w.address).catch(() => []);
  const byId = new Map<string, { amt: bigint; c: TokenCoin }>();
  for (const c of coins) {
    const cur = byId.get(c.id);
    byId.set(c.id, { amt: (cur?.amt ?? BigInt(0)) + c.amt, c: cur?.c.sym ? cur.c : c });
  }
  const sort = (ts: Token[]) => ts.filter((t) => (t.balance ?? 0) > 0).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  // Show what the wallet itself knows straight away; the index fills in names/icons after.
  quick?.(sort([...byId].map(([id, { amt, c }]) => ({ id, sym: c.sym ?? id.slice(0, 8), icon: c.icon ?? null, dec: c.dec ?? 0, balance: Number(amt) / 10 ** (c.dec ?? 0) }))));
  const out = await Promise.all(
    [...byId].map(async ([id, { amt, c }]) => {
      // Prefer the index for name/decimals/icon; the coin's own notes if the index doesn't know it.
      const t = await tokenById(id).catch(() => ({ id, sym: c.sym ?? id.slice(0, 8), icon: c.icon ?? null, dec: c.dec ?? 0 }) as Token);
      // The wallet's own icon for the coin wins: it's the one the player sees in their wallet.
      return { ...t, icon: c.icon ?? t.icon, balance: Number(amt) / 10 ** t.dec };
    }),
  );
  return sort(out);
}

/** The `{"p":"bsv-20",…}` JSON inside an ordinal inscription locking script (hex). */
function inscriptionJson(hex: string): { op?: string; id?: string; amt?: string } | null {
  if (!hex) return null;
  let text = '';
  for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  const m = text.match(/\{"p":"bsv-20"[^}]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Token coins the wallet holds but can't see (their note lacks the amount): to re-note them. */
export async function strandedCoins(wallet: WalletInterface): Promise<{ id: string; amt: bigint; n: number; why: 'hidden' | 'icon' | 'untagged' }[]> {
  const { coins } = await tokenCoins(wallet).catch(() => ({ coins: [] as TokenCoin[] }));
  const by = new Map<string, { amt: bigint; n: number; why: 'hidden' | 'icon' | 'untagged' }>();
  for (const c of coins) {
    if (!c.keyID) continue;
    // Hidden (no amount in the note), or shown but with a broken icon (no icon in the note) when the token has one.
    let why: 'hidden' | 'icon' | 'untagged' | null = !c.noted ? 'hidden' : null;
    if (!why && !c.icon && c.keyID.startsWith(`${c.id}-`)) {
      const t = await tokenById(c.id).catch(() => null);
      if (t?.icon) why = 'icon';
    }
    if (!why && !c.tagged) why = 'untagged';
    if (!why) continue;
    const cur = by.get(c.id) ?? { amt: BigInt(0), n: 0, why };
    by.set(c.id, { amt: cur.amt + c.amt, n: cur.n + 1, why: cur.why === 'hidden' ? 'hidden' : why });
  }
  return [...by].map(([id, v]) => ({ id, ...v }));
}
