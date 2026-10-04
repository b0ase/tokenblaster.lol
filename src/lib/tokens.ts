/** BSV-20/21 token data from the GorillaPool ordinals API (CORS-enabled, no key). */
import type { WalletInterface } from '@bsv/sdk';
const API = 'https://ordinals.gorillapool.io/api';

export type Token = { id: string; sym: string; icon: string | null; dec: number; balance?: number };

/** Featured: the $BLASTER token already on chain. */
export const BLASTER_ID = '429bf19906897c0444a53bdf236473b1b3965a95a03f20863de640f49241d929_0';

export const iconUrl = (icon: string | null) =>
  !icon ? null : /^https?:/.test(icon) ? icon : `https://ordfs.network/${icon}`;

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

/**
 * The tokens actually in the player's wallet. bWallet/bWalletX keep BSV-21 token outputs in a
 * `bsv21` basket, tagged `bsv21:<tokenId>`; each output's amount is in its inscription. Falls back
 * to the GorillaPool index for the wallet's address (wallets that don't use baskets).
 */
export async function walletTokens(w: { client: WalletInterface; address: string }): Promise<Token[]> {
  const sums = new Map<string, bigint>();
  try {
    const r = await w.client.listOutputs({ basket: 'bsv21', include: 'locking scripts', includeTags: true, includeCustomInstructions: true, limit: 10000 });
    for (const o of r.outputs) {
      const ins = inscriptionJson(o.lockingScript ?? '');
      let id = o.tags?.find((t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy' && t !== 'bsv21:auth')?.slice(6) ?? ins?.id;
      if (!id) {
        try {
          id = (JSON.parse(o.customInstructions ?? '{}') as { id?: string }).id;
        } catch {
          /* no instructions */
        }
      }
      if (!id && ins?.op === 'deploy+mint') id = o.outpoint.replace('.', '_');
      if (!id || !ins?.amt) continue;
      sums.set(id, (sums.get(id) ?? BigInt(0)) + BigInt(ins.amt));
    }
  } catch {
    /* wallet has no baskets (or refused): use the index */
  }
  if (!sums.size) return tokensHeld(w.address).catch(() => []);
  const out = await Promise.all(
    [...sums].map(async ([id, amt]) => {
      const t = await tokenById(id).catch(() => ({ id, sym: id.slice(0, 8), icon: null, dec: 0 }) as Token);
      return { ...t, balance: Number(amt) / 10 ** t.dec };
    }),
  );
  return out.filter((t) => (t.balance ?? 0) > 0).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
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
