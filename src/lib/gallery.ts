/**
 * TokenBlaster Shooting Gallery: pricing, packs, tag and prize config. Pure (no browser, no server),
 * so the page, the API and the tests all read the same numbers.
 *
 * Every shot is one real BSV transaction: 1 input, OP_FALSE OP_RETURN
 *   "tokenblaster.lol" <token> <chain:n> "gallery" [<handle>]
 * and the change back to the player's own browser gun (src/lib/gun.ts storm()). Nothing goes to us per
 * shot; the only extra is the platform fee below, paid once per pack.
 */

/** The <game> push on every TerrorNode round (owner, 25 Oct 2026: it said 'gallery'). Old 'gallery' rounds still count. */
export const GALLERY_GAME = 'terrornode';
/** Chain tags the TerrorNode board accepts (rounds fired before the rename carry 'gallery'). */
export const GALLERY_TAGS = ['terrornode', 'gallery'];

/**
 * Bytes per shot. A shot is 1 P2PKH input (~148 B), a change output (34 B), ~19 B of framing and the
 * OP_RETURN: OP_FALSE OP_RETURN + "tokenblaster.lol" (17) + <ammo> (1+L) + <chain:n> (<=8) + "gallery" (8)
 * [+ <handle> (1+H)]. 248 + L (+ 1 + H) with ~10 B of signature slack; never below the 260 B that PR #7's
 * smoke test proved ARC takes. Longest case (40-char ammo + 40-char handle/paymail): 329 B = 33 sat.
 */
export const FEE_RATE = 100; // sat/kB, the GorillaPool / TAAL floor
export const MIN_SHOT_BYTES = 260;
export const shotBytes = (ammoLen = 4, handleLen = 0) => Math.max(MIN_SHOT_BYTES, 248 + ammoLen + (handleLen ? 1 + handleLen : 0));
export const shotSats = (named: boolean | number, ammoLen = 4) =>
  Math.ceil((shotBytes(ammoLen, typeof named === 'number' ? named : named ? 40 : 0) * FEE_RATE) / 1000);
/** Worst case: the longest ammo label and the longest handle. */
export const MAX_SHOT_SATS = shotSats(40, 40);

/** "Ammo": the player's own paymail, attached when they pay (owner, 24 Oct). It rides in the tag's <token>
 * field. Lower case [a-z0-9._@-], 1 to 40 chars; anything else is refused. */
export const DEFAULT_AMMO = 'sats';
/**
 * The tag a connected player's rounds carry: the paymail from bWallet's lookup (src/lib/walletBar.ts
 * lookupPaymail), or its alias when the paymail is too long for the tag. null: fire DEFAULT_AMMO.
 * (Replaces the old `<handle>.x@bwallet.space` guess, which was wrong for most players.)
 */
export const ammoFromPaymail = (id: { paymail?: string | null; alias?: string | null } | null | undefined) => cleanAmmo(id?.paymail) ?? cleanAmmo(id?.alias);
export function cleanAmmo(s: string | null | undefined): string | null {
  if (s == null) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  const t = s.trim().toLowerCase();
  return /^[a-z0-9._@-]{1,40}$/.test(t) ? t : null;
}

/** Platform fee on top of network cost, as a fraction. The owner may set 0. */
export const PLATFORM_FEE = 0.05;
/** The stress test is free (network cost only) up to and including 31 Oct 2026 UTC; the fee starts here. */
export const FEE_FROM = '2026-11-01T00:00:00Z';
/** The platform fee in force at `now`: 0 during the stress test, PLATFORM_FEE from FEE_FROM on. */
/** Ammo premium on top of network cost (owner, 24 Oct 2026: 0 for now; ammo is sold at the minimum network cost). */
export const AMMO_PREMIUM = 0;
export const platformFeeAt = (now = Date.now()) => (now < Date.parse(FEE_FROM) ? 0 : PLATFORM_FEE) + AMMO_PREMIUM;
export const freeForStressTest = (now = Date.now()) => platformFeeAt(now) === 0 && PLATFORM_FEE > 0;
/** Rounds a sat budget buys at `perShotSats` (network cost + fee). */
export const roundsFor = (sats: number, perShotSats: number) => (perShotSats > 0 ? Math.max(0, Math.floor(sats / perShotSats)) : 0);

/** Session packs (shots). The pack size is also the hard cap: the gun fires at most this many. */
export const PACKS = [10_000, 100_000, 1_000_000] as const;
export type Pack = (typeof PACKS)[number];

/** Lane split + merge overhead the storm needs on top of the shots (src/lib/gun.ts storm()). */
export const overheadSats = (shots: number) => lanesFor(shots) * 60 + 1000;

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

/** The handle as it goes on chain: a lower-case handle [a-z0-9_] (1-20) or the player's paymail (up to 40). */
export function chainHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const s = h.trim().replace(/^@/, '').toLowerCase();
  if (/^[a-z0-9_]{1,20}$/.test(s)) return s;
  return /^[a-z0-9._-]{1,30}@[a-z0-9.-]{3,30}\.[a-z]{2,}$/.test(s) && s.length <= 40 ? s : null;
}

/**
 * The handle every round carries (owner test, 25 Oct 2026: paid rounds went out without the paymail). The wallet's
 * paymail always wins and is kept even while the wallet is marked not answering (the gun signs every round itself,
 * so liveness has nothing to do with the tag; the old path read the name through `live !== false` and dropped it
 * to nothing). Else the player's name (key_ form). Null only with no wallet at all.
 */
export const roundHandle = (paymail: string | null | undefined, name: string | null | undefined) => chainHandle(paymail) ?? chainHandle(name);
/** A live key_ name, not a paymail: the storm looks the paymail up once more before it fires. */
export const needsPaymail = (h: string | null | undefined) => !h || !h.includes('@');
/** Per-shot budget for the handle: always the longest paymail (40), so a paymail that arrives after LOCK & LOAD
 * (or replaces a key_ name at the trigger) still fits the lanes' fee. Spare sats stay in the lane and merge back. */
export const HANDLE_BUDGET = 40;

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
 * How a weapon spends transactions. `stream`: hold the trigger and the chain streams (the storm), `rate` rounds
 * a second from the gun (practice draws exactly this). `burst`: every trigger pull is `n` transactions in one
 * batch (a shotgun's pellets). LIVE sends at min(rate, liveCeiling(rounds)): see below.
 */
export type TxPattern = { kind: 'stream'; rate: number } | { kind: 'burst'; n: number };
/**
 * Volume guns (owner, 24 Oct: "this is a STRESS TEST ... ~2000 tx/second"; 25 Oct: "we're not hitting 2000 tx/sec
 * and we need to"): their stream rate, tx/s. 3,000 so the LIVE sender (which only runs as far ahead of the trigger
 * as this rate) has headroom over 2,000 accepted a second (docs/throughput.md).
 */
export const STREAM_RATES: Record<string, number> = { minigun: 3000, plasmarifle: 3000, 'big-block': 3000 };
/** The ESCAPE FROM TERRORNODE rack: sustained high-volume streams only, no single shots or bursts. */
export const ASSAULT_GUNS = ['minigun', 'plasmarifle', 'big-block'] as const;
export function txPattern(w: { id: string; auto: boolean; fireMs: number; pellets: number }): TxPattern {
  if (w.auto) return { kind: 'stream', rate: STREAM_RATES[w.id] ?? Math.round(Math.min(1500, (1500 * 70) / Math.max(70, w.fireMs)) / 10) * 10 };
  return { kind: 'burst', n: Math.max(1, Math.min(25, w.pellets)) };
}
/**
 * Rounds a full ten-minute block needs at the gun's rate (owner, 24 Oct: hold the trigger for the whole run),
 * plus a margin. A burst gun is counted at two pulls a second.
 */
export const BLOCK_SECS = 600;
export function blockRounds(p: TxPattern, secs = BLOCK_SECS, margin = 1.1): number {
  const perSec = p.kind === 'stream' ? p.rate : p.n * 2;
  return Math.ceil(perSec * secs * margin);
}
export const patternLabel = (p: TxPattern) => (p.kind === 'stream' ? `STREAM · up to ${p.rate.toLocaleString()} tx/s` : `BURST · ${p.n} tx per pull`);

/**
 * The LIVE sender (src/lib/gun.ts storm + src/workers/storm.ts): the paid rounds are split into
 * ceil(rounds / 100) lanes (max 100); each sender round, every lane chains up to STREAM_STEP blasts and every
 * worker (up to 12 cores) posts its lanes to ARC in parallel requests of <= 600, while it signs the next round.
 * So one round carries at most lanes × STREAM_STEP transactions and takes about one ARC answer (signing is
 * overlapped). ROUND_SECS is the ARC answer we plan for (the bench, scripts/storm-bench.ts, measured the sender
 * itself; GorillaPool's real batch latency is the unknown: docs/throughput.md). Real tx/s can be lower on a slow
 * device or a slow ARC, never higher than this.
 */
export const STREAM_STEP = 100;
export const ROUND_SECS = 1.5;
export const MAX_LANES = 100;
export const lanesFor = (rounds: number) => Math.max(1, Math.min(MAX_LANES, Math.ceil(rounds / 100)));
export const liveCeiling = (rounds: number) => Math.floor((lanesFor(rounds) * STREAM_STEP) / ROUND_SECS);
/** What a gun can really send LIVE with `rounds` loaded: the lower of its rate and the sender's ceiling. */
export const liveRate = (p: TxPattern, rounds: number) => (p.kind === 'stream' ? Math.min(p.rate, liveCeiling(rounds)) : 0);
/** Rounds needed for the sender to reach a gun's full rate (enough lanes for `rate` tx/s). */
export const roundsForFullRate = (rate: number) => Math.min(MAX_LANES, Math.ceil((rate * ROUND_SECS) / STREAM_STEP)) * 100;

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

/** Shortest run the gallery reports to /api/scores. The DB's tokenblaster_score_limit('gallery').min_secs is 1 s and a
 * shorter run is rejected as "implausible run" (400); 2 s keeps clear of rounding. */
export const MIN_REPORT_SECS = 2;
