/** Read-only token facts from GorillaPool's ordinals index (server side, cached a few minutes). */
const API = 'https://ordinals.gorillapool.io/api';

export type GpToken = {
  id: string;
  txid: string;
  sym: string;
  icon: string | null;
  amt: string;
  dec: number;
  accounts: number | null;
  height: number | null;
};
export type GpHolder = { address: string; amt: string };

export async function gpToken(id: string): Promise<GpToken | null> {
  try {
    const r = await fetch(`${API}/bsv20/id/${id}`, { next: { revalidate: 300 } });
    if (!r.ok) return null;
    const d = (await r.json()) as Partial<GpToken> & { amt?: string | number; dec?: number | string; accounts?: number; height?: number };
    if (!d.sym) return null;
    return {
      id,
      txid: d.txid ?? id.split('_')[0],
      sym: d.sym,
      icon: d.icon ?? null,
      amt: String(d.amt ?? '0'),
      dec: Number(d.dec ?? 0),
      accounts: typeof d.accounts === 'number' ? d.accounts : null,
      height: typeof d.height === 'number' ? d.height : null,
    };
  } catch {
    return null;
  }
}

export async function gpHolders(id: string, limit = 10): Promise<GpHolder[]> {
  try {
    const r = await fetch(`${API}/bsv20/id/${id}/holders?limit=${limit}`, { next: { revalidate: 300 } });
    if (!r.ok) return [];
    const d = (await r.json()) as GpHolder[];
    return Array.isArray(d) ? d.filter((h) => h && h.address && h.amt) : [];
  } catch {
    return [];
  }
}

/** Whole tokens from base units (string, may exceed 2^53), for display. */
export function units(amt: string, dec: number): string {
  let n: bigint;
  try {
    n = BigInt(amt);
  } catch {
    return amt;
  }
  const base = BigInt(10) ** BigInt(dec);
  const whole = (n / base).toLocaleString('en-US');
  const frac = dec ? (n % base).toString().padStart(dec, '0').replace(/0+$/, '') : '';
  return frac ? `${whole}.${frac}` : whole;
}

/** a / b as a percentage string, bigint-safe. */
export function share(a: string, b: string): string {
  try {
    const bb = BigInt(b);
    if (bb === BigInt(0)) return '';
    const bp = Number((BigInt(a) * BigInt(1_000_000)) / bb) / 10_000;
    return `${bp < 0.01 ? '<0.01' : bp.toFixed(2)}%`;
  } catch {
    return '';
  }
}

export const ordfs = (outpoint: string) => `https://ordfs.network/${outpoint.replace('.', '_')}`;
