/**
 * Guards for every server signer (28 Oct 2026, after the DotSwap V1 drain; see VexVoid/SIGNING-PATHS-AUDIT.md).
 * Pure helpers, no 'server-only', so the tests can load them:
 *   - kill switch:   <NAME>_SIGNING_OFF=1 makes a key loader refuse to sign (default: signing on)
 *   - daily caps:    outflow over the last 24 h, checked BEFORE signing, env-overridable
 *   - rate limits:   in-app, per IP / per identity (per warm instance; Vercel firewall rules are separate)
 *   - safeEqual:     constant-time secret compare
 *   - arcAccepted:   an ARC reply counts as accepted only if it is THIS tx, never a double-spend
 */
import { createHash, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
const DAY = 24 * 60 * 60 * 1000;

// ── kill switch ────────────────────────────────────────────────

export class SigningOffError extends Error {
  constructor(name: string) {
    super(`Server signing is switched off (${name}_SIGNING_OFF). Nothing was signed; try again later.`);
    this.name = 'SigningOffError';
  }
}

/** True when `<name>_SIGNING_OFF` is 1/true/on (any of `names`). */
export function signingOff(names: string | string[], env: Env = process.env): boolean {
  return (Array.isArray(names) ? names : [names]).some((n) => /^(1|true|on|yes)$/i.test((env[`${n}_SIGNING_OFF`] ?? '').trim()));
}

/** LAUNCH_POOL_WIF's switch. LAUNCH_SIGNING_OFF (the audit's name) works too. */
export const LAUNCH_SIGNERS = ['LAUNCH_POOL', 'LAUNCH'];

export function assertSigningOn(names: string | string[], env: Env = process.env) {
  if (signingOff(names, env)) throw new SigningOffError(Array.isArray(names) ? names[0] : names);
}

// ── caps ───────────────────────────────────────────────────────

/** A positive integer from env, else the default. 0 or junk falls back to the default (a cap is never "off" by typo). */
export function envInt(name: string, def: number, env: Env = process.env): number {
  const v = Number((env[name] ?? '').trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

/**
 * Daily caps, chosen generous against current traffic (28 Oct 2026) and documented in the PR:
 *   LAUNCH_RESERVE_DAILY_CAP_SATS  5 BSV of curve reserve paid out to sellers per 24 h (all coins' reserves: ~0.23 BSV)
 *   LAUNCH_VAULT_DAILY_CAP_SATS    0.5 BSV out of the fee vaults per 24 h (claims + splits; vaults hold far less)
 *   RECEIPTS_DAILY_CAP_TOKENS      2,000,000 TERRORNODE per 24 h (397,600 issued in total so far)
 *   RECEIPTS_INSTANT_MAX           25,000 TERRORNODE per settlement sent on 0-conf; above it waits for 1 confirmation
 */
export const caps = (env: Env = process.env) => ({
  reserveSats: envInt('LAUNCH_RESERVE_DAILY_CAP_SATS', 500_000_000, env),
  vaultSats: envInt('LAUNCH_VAULT_DAILY_CAP_SATS', 50_000_000, env),
  receiptTokens: envInt('RECEIPTS_DAILY_CAP_TOKENS', 2_000_000, env),
  receiptInstantMax: envInt('RECEIPTS_INSTANT_MAX', 25_000, env),
});

/** Sum `pick(row)` over rows created in the last 24 h. */
export function sumLastDay<T extends { created_at: string }>(rows: T[], pick: (r: T) => number, now = Date.now()): number {
  let n = 0;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (Number.isFinite(t) && now - t < DAY) n += Number(pick(r)) || 0;
  }
  return n;
}

/** Would `adding` on top of `used` pass the cap? */
export const underCap = (used: number, adding: number, cap: number) => used + adding <= cap;

/** In-process rolling 24 h total (per warm instance). Used only where no ledger row records the outflow. */
export class DailyCounter {
  private log: { at: number; n: number }[] = [];
  total(now = Date.now()) {
    this.log = this.log.filter((e) => now - e.at < DAY);
    return this.log.reduce((s, e) => s + e.n, 0);
  }
  add(n: number, now = Date.now()) {
    this.log.push({ at: now, n });
  }
}

// ── rate limits ────────────────────────────────────────────────

/** Sliding-window limiter, in memory. `allow` records the hit when it passes. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const h = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (h.length >= limit) {
      this.hits.set(key, h);
      return false;
    }
    h.push(now);
    this.hits.set(key, h);
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
    return true;
  }
}

/** Live locks per requester (trade leases): at most `max` unexpired at once per key. */
export class LockBudget {
  private held = new Map<string, Map<string, number>>();
  private live(key: string, now: number) {
    const m = this.held.get(key) ?? new Map<string, number>();
    for (const [id, until] of m) if (until <= now) m.delete(id);
    this.held.set(key, m);
    return m;
  }
  canTake(key: string, max: number, now = Date.now()) {
    return this.live(key, now).size < max;
  }
  take(key: string, id: string, until: number) {
    this.live(key, Date.now()).set(id, until);
  }
  drop(id: string) {
    for (const m of this.held.values()) m.delete(id);
  }
}

/** The caller's IP as Vercel reports it. */
export const clientIp = (req: Request) =>
  (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim();

// ── secrets ────────────────────────────────────────────────────

/** Constant-time compare (hashes first, so lengths never leak or throw). Empty never matches. */
export function safeEqual(got: string | null | undefined, want: string | null | undefined): boolean {
  if (!got || !want) return false;
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b) && got.length === want.length;
}

// ── broadcast replies ──────────────────────────────────────────

/**
 * Did ARC accept THIS transaction? "Already known / in mempool / seen / mined" are fine (the same tx).
 * A double-spend ("invalid competing transaction", DOUBLE_SPEND_ATTEMPTED, REJECTED, ORPHAN) is NOT: another tx
 * spent our inputs, and reporting success would hide a race (the old code did, which masked double claims).
 */
export function arcAccepted(r: unknown): boolean {
  const s = JSON.stringify(r ?? {});
  if (/competing transaction|DOUBLE_SPEND|DOUBLE|REJECT|ORPHAN/i.test(s)) return false;
  const o = (r ?? {}) as { status?: string; txStatus?: string };
  if (o.status === 'success') return true;
  return /already known|ALREADY_IN_MEMPOOL|SEEN_ON_NETWORK|MINED/i.test(s);
}
