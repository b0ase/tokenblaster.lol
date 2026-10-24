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

/**
 * Bytes per shot. A shot is 1 P2PKH input (~148 B), a change output (34 B), ~19 B of framing and the
 * OP_RETURN: OP_FALSE OP_RETURN + "tokenblaster.lol" (17) + <ammo> (1+L) + <chain:n> (<=8) + "gallery" (8)
 * [+ <handle> (1+H)]. 248 + L (+ 1 + H) with ~10 B of signature slack; never below the 260 B that PR #7's
 * smoke test proved ARC takes. Longest case (40-char ammo + 20-char handle): 309 B = 31 sat.
 */
export const FEE_RATE = 100; // sat/kB, the GorillaPool / TAAL floor
export const MIN_SHOT_BYTES = 260;
export const shotBytes = (ammoLen = 4, handleLen = 0) => Math.max(MIN_SHOT_BYTES, 248 + ammoLen + (handleLen ? 1 + handleLen : 0));
export const shotSats = (named: boolean | number, ammoLen = 4) =>
  Math.ceil((shotBytes(ammoLen, typeof named === 'number' ? named : named ? 20 : 0) * FEE_RATE) / 1000);
/** Worst case: the longest ammo label and the longest handle. */
export const MAX_SHOT_SATS = shotSats(20, 40);

/** "Ammo": any label the player types (a domain, a word). It rides in the tag's <token> field. No ownership
 * check, by the owner's decision. Lower case [a-z0-9.-], 1 to 40 chars; anything else is refused. */
export const DEFAULT_AMMO = 'sats';
export const AMMO_SUGGESTIONS = ['sats', 'txblaster.com', 'tokenblaster.lol', 'bwalletx.com', 'google.com', 'pnee'];
export function cleanAmmo(s: string | null | undefined): string | null {
  if (s == null) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  const t = s.trim().toLowerCase();
  return /^[a-z0-9.-]{1,40}$/.test(t) ? t : null;
}

/** Platform fee on top of network cost, as a fraction. The owner may set 0. */
export const PLATFORM_FEE = 0.05;
/** The stress test is free (network cost only) up to and including 31 Oct 2026 UTC; the fee starts here. */
export const FEE_FROM = '2026-11-01T00:00:00Z';
/** The platform fee in force at `now`: 0 during the stress test, PLATFORM_FEE from FEE_FROM on. */
export const platformFeeAt = (now = Date.now()) => (now < Date.parse(FEE_FROM) ? 0 : PLATFORM_FEE);
export const freeForStressTest = (now = Date.now()) => platformFeeAt(now) === 0 && PLATFORM_FEE > 0;

/** Session packs (shots). The pack size is also the hard cap: the gun fires at most this many. */
export const PACKS = [10_000, 100_000, 1_000_000] as const;
export type Pack = (typeof PACKS)[number];

/** Lane split + merge overhead the storm needs on top of the shots (src/lib/gun.ts storm()). */
export const overheadSats = (shots: number) => Math.min(100, Math.ceil(shots / 300)) * 60 + 1000;

export type Quote = { shots: number; network: number; fee: number; total: number };
/** What a pack costs: network fees at cost, plus the platform fee (rounded up to whole sats). */
export function quote(shots: number, named: boolean | number, feeRate = platformFeeAt(), ammoLen = 4): Quote {
  const network = shots * shotSats(named, ammoLen) + overheadSats(shots);
  const fee = Math.ceil(network * Math.max(0, feeRate));
  return { shots, network, fee, total: network + fee };
}

export const usdOf = (sats: number, bsvUsd: number) => (sats / 1e8) * bsvUsd;
export const fmtUsd = (v: number) => (v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`);
export const fmtBsv = (sats: number) => `${(sats / 1e8).toFixed(sats < 1e6 ? 5 : 3)} BSV`;
/** Shots one whole BSV buys at network cost. */
export const shotsPerBsv = (named: boolean | number, ammoLen = 4) => Math.floor(1e8 / shotSats(named, ammoLen));

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

/**
 * How a weapon spends transactions. `stream`: hold the trigger and the chain streams (the storm), `rate` tx/s
 * in practice. `burst`: every trigger pull is `n` transactions in one batch (a shotgun's pellets).
 */
export type TxPattern = { kind: 'stream'; rate: number } | { kind: 'burst'; n: number };
export function txPattern(w: { id: string; auto: boolean; fireMs: number; pellets: number }): TxPattern {
  if (w.auto) return { kind: 'stream', rate: w.id === 'minigun' ? 1500 : Math.round(Math.min(1500, (1500 * 70) / Math.max(70, w.fireMs)) / 10) * 10 };
  return { kind: 'burst', n: Math.max(1, Math.min(25, w.pellets)) };
}
export const patternLabel = (p: TxPattern) => (p.kind === 'stream' ? `STREAM · up to ${p.rate.toLocaleString()} tx/s` : `BURST · ${p.n} tx per pull`);

/** Sum per-session rows into a per-player board: a session is counted once, at its highest report. */
export type SessionRow = { name: string; score: number; meta: Record<string, unknown> };
export type BoardRow = { handle: string; shots: number; sessions: number; weapon?: string; ammo?: string };
export function aggregateBoard(rows: SessionRow[]): BoardRow[] {
  const best = new Map<string, { handle: string; score: number; weapon?: string; ammo?: string }>();
  for (const r of rows) {
    const handle = chainHandle(typeof r.meta?.x === 'string' ? r.meta.x : r.name);
    if (!handle) continue;
    const sid = typeof r.meta?.sid === 'string' ? r.meta.sid : `row-${best.size}`;
    const k = `${handle}:${sid}`;
    const weapon = typeof r.meta?.w === 'string' ? r.meta.w : undefined;
    const ammo = cleanAmmo(typeof r.meta?.a === 'string' ? r.meta.a : null) ?? undefined;
    if ((best.get(k)?.score ?? -1) < r.score) best.set(k, { handle, score: r.score, weapon, ammo });
  }
  const by = new Map<string, BoardRow>();
  const top = new Map<string, number>(); // the weapon of each player's biggest session
  for (const { handle, score, weapon, ammo } of best.values()) {
    const b = by.get(handle) ?? { handle, shots: 0, sessions: 0 };
    if (weapon && score > (top.get(handle) ?? -1)) {
      top.set(handle, score);
      b.weapon = weapon;
      if (ammo) b.ammo = ammo;
    }
    b.shots += score;
    b.sessions++;
    by.set(handle, b);
  }
  return [...by.values()].sort((a, b) => b.shots - a.shots);
}
