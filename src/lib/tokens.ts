/** BSV-20/21 token data from the GorillaPool ordinals API (CORS-enabled, no key). */
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
