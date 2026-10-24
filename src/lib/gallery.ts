/**
 * TokenBlaster Shooting Gallery: pricing, packs, tag and prize config. Pure (no browser, no server),
 * so the page, the API and the tests all read the same numbers.
 *
 * Every shot is one real BSV transaction: 1 input, OP_FALSE OP_RETURN
 *   "tokenblaster.lol" <token> <chain:n> "gallery" [<handle>]
 * and the change back to the player's own browser gun (src/lib/gun.ts storm()). Nothing goes to us per
 * shot; the only extra is the platform fee below, paid once per pack.
 */

export const GALLERY_GAME = 'gallery';

/** Bytes per shot we budget for. Anonymous: 260 (26 sat at 100 sat/kB, PR #7). A handle push adds up
 * to 21 bytes, so named players budget 284 bytes (28.4 → 29 sat). */
export const FEE_RATE = 100; // sat/kB, the GorillaPool / TAAL floor
export const SHOT_BYTES_ANON = 260;
export const SHOT_BYTES_NAMED = 284;
export const shotSats = (named: boolean) => Math.ceil(((named ? SHOT_BYTES_NAMED : SHOT_BYTES_ANON) * FEE_RATE) / 1000);

/** Platform fee on top of network cost, as a fraction. The owner may set 0. */
export const PLATFORM_FEE = 0.05;

/** Session packs (shots). The pack size is also the hard cap: the gun fires at most this many. */
export const PACKS = [10_000, 100_000, 1_000_000] as const;
export type Pack = (typeof PACKS)[number];

/** Lane split + merge overhead the storm needs on top of the shots (src/lib/gun.ts storm()). */
export const overheadSats = (shots: number) => Math.min(100, Math.ceil(shots / 300)) * 60 + 1000;

export type Quote = { shots: number; network: number; fee: number; total: number };
/** What a pack costs: network fees at cost, plus the platform fee (rounded up to whole sats). */
export function quote(shots: number, named: boolean, feeRate = PLATFORM_FEE): Quote {
  const network = shots * shotSats(named) + overheadSats(shots);
  const fee = Math.ceil(network * Math.max(0, feeRate));
  return { shots, network, fee, total: network + fee };
}

export const usdOf = (sats: number, bsvUsd: number) => (sats / 1e8) * bsvUsd;
export const fmtUsd = (v: number) => (v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`);
export const fmtBsv = (sats: number) => `${(sats / 1e8).toFixed(sats < 1e6 ? 5 : 3)} BSV`;
/** Shots one whole BSV buys at network cost. */
export const shotsPerBsv = (named: boolean) => Math.floor(1e8 / shotSats(named));

/** The handle as it goes on chain: lower case, [a-z0-9_], 1 to 20 chars. Anything else: no handle. */
export function chainHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const s = h.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,20}$/.test(s) ? s : null;
}

/** The pushes after <chain:n>: the game, then the handle when there is one. */
export const galleryPushes = (handle: string | null) => [GALLERY_GAME, ...(handle ? [handle] : [])];

/** The event + the prize. Placeholder rules: the owner approves the final text. No payout is automated. */
export const PRIZE = {
  amount: '1 BSV',
  title: '1 BSV to the top blaster',
  start: '2026-10-31T00:00:00Z',
  end: '2026-11-01T00:00:00Z',
  rules: [
    'RULES PLACEHOLDER: final rules to be approved by the owner before the event.',
    'Ranked by accepted Shooting Gallery transactions carrying your handle, between the start and end time (UTC).',
    'Every counted shot must be verifiable on chain by its tokenblaster.lol "gallery" tag.',
    'The prize is paid by hand after the event; nothing is paid automatically.',
  ],
} as const;

export const inEvent = (now = Date.now()) => now >= Date.parse(PRIZE.start) && now < Date.parse(PRIZE.end);

/** Sum per-session rows into a per-player board: a session is counted once, at its highest report. */
export type SessionRow = { name: string; score: number; meta: Record<string, unknown> };
export type BoardRow = { handle: string; shots: number; sessions: number };
export function aggregateBoard(rows: SessionRow[]): BoardRow[] {
  const best = new Map<string, { handle: string; score: number }>();
  for (const r of rows) {
    const handle = chainHandle(typeof r.meta?.x === 'string' ? r.meta.x : r.name);
    if (!handle) continue;
    const sid = typeof r.meta?.sid === 'string' ? r.meta.sid : `row-${best.size}`;
    const k = `${handle}:${sid}`;
    if ((best.get(k)?.score ?? -1) < r.score) best.set(k, { handle, score: r.score });
  }
  const by = new Map<string, BoardRow>();
  for (const { handle, score } of best.values()) {
    const b = by.get(handle) ?? { handle, shots: 0, sessions: 0 };
    b.shots += score;
    b.sessions++;
    by.set(handle, b);
  }
  return [...by.values()].sort((a, b) => b.shots - a.shots);
}
