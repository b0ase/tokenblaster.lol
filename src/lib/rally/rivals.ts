/**
 * Rivals are live chain transactions: the biggest recent moves from the feed become rival cars,
 * labelled with what they carry, faster the bigger the move. Falls back to idle mempool entries.
 */
import type { FeedTx, TxKind } from '@/lib/feed';
import { KINDS } from '@/lib/feed';
import { rng } from './noise';

export type RivalSpec = {
  id: string;
  tx: string | null;
  token: string | null;
  kind: TxKind;
  /** 0..1: how big the move was. */
  power: number;
  skill: number;
  model: 'hatch' | 'coupe' | 'sedan' | 'wagon';
  /** Mutable label parts (a token's ticker arrives later). */
  detail: string;
  color: string;
  live: boolean;
  /** Start grid slot. */
  slot: number;
};

/** Body style per tx kind (see carBuild.ts). */
export const RIVAL_MODEL: Record<TxKind, 'hatch' | 'coupe' | 'sedan' | 'wagon'> = {
  token: 'coupe',
  inscription: 'wagon',
  social: 'hatch',
  data: 'sedan',
  payment: 'hatch',
  blast: 'sedan',
};

/** Paint scheme per tx kind: [base, accent, trim]. */
export const RIVAL_PAINT: Record<TxKind, [string, string, string]> = {
  token: ['#16161b', '#d4a843', '#ffffff'],
  inscription: ['#c4161c', '#ffffff', '#101010'],
  social: ['#d33d8c', '#fff2f8', '#2a0a1a'],
  data: ['#2a2f3a', '#ff5a48', '#e8e8e8'],
  payment: ['#f4efe2', '#1f8f4a', '#101010'],
  blast: ['#ffffff', '#111111', '#ff2a2a'],
};
export const SPONSORS = ['MEMPOOL ENERGY', 'HASH·OIL', 'SPV TYRES', 'UTXO LUBES', 'NODE-X', 'ORPHAN RACING', 'SATS BANK', 'BLOCK 21 BREW', 'PROOF OF WORK', 'BIT-FUEL'];

const kindColor = (k: TxKind) => KINDS.find((x) => x.id === k)?.color ?? '#ffffff';

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);

/** How big was this tx, 0..1 (log scale, per kind). */
export function powerOf(f: FeedTx) {
  let v: number;
  if (f.kind === 'token') {
    const a = Number(f.amt);
    v = Number.isFinite(a) && a > 0 ? Math.log10(1 + a) / 11 : 0.35;
  } else if (f.kind === 'payment') v = Math.log10(1 + f.sats) / 9;
  else v = Math.log10(1 + f.bytes) / 5.5;
  return Math.max(0, Math.min(1, v));
}

export function detailOf(f: FeedTx) {
  if (f.kind === 'token') return `${f.op ?? 'transfer'}${f.amt ? ' ' + compact(Number(f.amt)) : ''}`;
  if (f.kind === 'payment') return `payment ${compact(f.sats)} sats`;
  if (f.kind === 'inscription') return `ordinal ${(f.bytes / 1000).toFixed(1)} KB`;
  if (f.kind === 'blast') return `blast${f.game ? ' · ' + f.game : ''}`;
  if (f.kind === 'social') return `${f.appName ?? 'social'} ${(f.bytes / 1000).toFixed(1)} KB`;
  return `${f.appName ?? 'data'} ${(f.bytes / 1000).toFixed(1)} KB`;
}

const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');

/** Pick up to `count` rivals: biggest live moves first, then idle mempool entries to fill the grid. */
export function pickRivals(take: (pred?: (f: FeedTx) => boolean) => FeedTx | null, count: number, seed: number): { rivals: RivalSpec[]; live: number } {
  const r = rng(seed);
  const got: FeedTx[] = [];
  // Drain what is waiting (capped), keep the most powerful.
  for (let i = 0; i < 160; i++) {
    const f = take();
    if (!f) break;
    got.push(f);
  }
  got.sort((a, b) => powerOf(b) - powerOf(a));
  // Prefer a mix: tokens first, then the rest by power; no duplicate txids.
  const seen = new Set<string>();
  const chosen: FeedTx[] = [];
  const push = (f: FeedTx) => {
    if (chosen.length >= count || seen.has(f.id)) return;
    seen.add(f.id);
    chosen.push(f);
  };
  for (const f of got) if (f.kind === 'token') push(f);
  for (const f of got) push(f);
  const rivals: RivalSpec[] = chosen.map((f, i) => {
    const power = powerOf(f);
    return {
      id: f.id,
      tx: f.id,
      token: f.token ?? null,
      kind: f.kind,
      power,
      skill: 0.8 + power * 0.17 + r() * 0.04,
      model: RIVAL_MODEL[f.kind],
      detail: detailOf(f),
      color: kindColor(f.kind),
      live: true,
      slot: i,
    };
  });
  const live = rivals.length;
  const idle: TxKind[] = ['payment', 'data', 'social', 'token', 'inscription'];
  while (rivals.length < count) {
    const k = idle[Math.floor(r() * idle.length)];
    const power = 0.1 + r() * 0.5;
    rivals.push({
      id: 'idle' + rivals.length,
      tx: null,
      token: null,
      kind: k,
      power,
      skill: 0.8 + power * 0.17 + r() * 0.03,
      model: RIVAL_MODEL[k],
      detail: `idle mempool ${hex(r, 4)}…`,
      color: kindColor(k),
      live: false,
      slot: rivals.length,
    });
  }
  return { rivals, live };
}
