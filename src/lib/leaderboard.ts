/**
 * "Most blasted tokens". Each blast is a transaction tagged with the token it is for
 * (blaster/blast.ts); the leaderboard is the count per token over a period.
 *
 * Not wired to data yet: the pack server will record what it fires, and a referee will check
 * those transactions on chain. Until then every period is empty.
 */
export type Period = '24h' | '7d' | '30d' | 'all';
export const PERIODS: { id: Period; label: string }[] = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

export type TokenScore = { tokenId: string; ticker: string; icon: string | null; blasts: number };

export const isPeriod = (v: string | null): v is Period => PERIODS.some((p) => p.id === v);

/** Scores keyed by period; empty until the pack server records what it fires. */
const SCORES: Partial<Record<Period, TokenScore[]>> = {};

export async function topTokens(period: Period): Promise<TokenScore[]> {
  return SCORES[period] ?? [];
}
