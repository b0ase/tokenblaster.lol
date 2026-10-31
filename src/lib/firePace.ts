/**
 * TERRORNODE fire pacing (owner, 31 Oct 2026: "$0.10 lasted 6 seconds, the most annoying game known to man").
 *
 * Pure, shared by the Shooting Gallery and the tests. Pacing never changes how many rounds a dollar buys: every
 * loaded round is still one real transaction. It only spreads them out so a load lasts a meaningful time:
 *
 *  - The default trigger rate is the loaded rounds spread over PACE_TARGET_SECS (90 s), never above the gun's own
 *    max rate and never below PACE_MIN_RATE. $0.10 (~17k rounds) fires at ~190/s for 90 s; $1 (~170k) at ~1,900/s;
 *    $5 (~850k) hits the minigun's full 3,000/s. Big loads keep max rate.
 *  - The minigun spins up over SPIN_UP_SECS each time the trigger is pulled.
 *  - The trigger may only run AHEAD_SECS ahead of what the network has taken: rounds fired visually but not sent
 *    stay in the gun, so the HUD can never say "out of rounds" while the gun still holds them.
 */
export const PACE_TARGET_SECS = 90;
export const PACE_MIN_RATE = 50;
export const SPIN_UP_SECS = 1.5;
export const AHEAD_SECS = 2;
export const AHEAD_MIN = 200;

/** The trigger's rounds per second for a load of `rounds` on a gun whose top rate is `maxRate`. */
export function pacedRate(maxRate: number, rounds: number, targetSecs = PACE_TARGET_SECS): number {
  if (!(maxRate > 0) || !(rounds > 0)) return 0;
  return Math.min(maxRate, Math.max(Math.min(PACE_MIN_RATE, maxRate), Math.ceil(rounds / targetSecs)));
}

/** Spin-up: the share of the paced rate after the trigger has been held `heldSecs` (15% at once, 100% at 1.5 s). */
export function spinUp(heldSecs: number): number {
  if (!(heldSecs > 0)) return 0.15;
  return Math.min(1, 0.15 + (0.85 * heldSecs) / SPIN_UP_SECS);
}

/** How many rounds the trigger may have fired but not yet sent, at `rate` rounds/s. */
export const maxAhead = (rate: number) => Math.max(AHEAD_MIN, Math.ceil(rate * AHEAD_SECS));

/** Rounds the trigger may fire now: what is left in the pack, capped by how far it may run ahead of the network. */
export function fireAllowance(p: { left: number; fired: number; sent: number; rate: number }): number {
  const ahead = maxAhead(p.rate) - Math.max(0, p.fired - p.sent);
  return Math.max(0, Math.min(p.left, ahead));
}

/** Seconds of holding the trigger left at `rate` (null when not firing). */
export const secsLeft = (left: number, rate: number) => (rate > 0 && left > 0 ? Math.ceil(left / rate) : left > 0 ? null : 0);

/** "1:30", "0:07". */
export const fmtClock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.max(0, Math.floor(secs % 60))).padStart(2, '0')}`;

/**
 * The gun is truly empty (offer reload amounts) only when nothing is left in the pack, nothing fired is still waiting
 * to go out, and the gun's spare credit is less than one round. Otherwise the spare credit loads by itself.
 */
export function trulyEmpty(p: { left: number; unsent: number; spareSats: number; roundSats: number }): boolean {
  return p.left <= 0 && p.unsent <= 0 && !(p.roundSats > 0 && p.spareSats >= p.roundSats);
}

/** Spare credit worth auto-loading now (no wallet prompt): the pack is dry, the network caught up, a round's worth is there. */
export function shouldAutoLoad(p: { left: number; unsent: number; spareSats: number; roundSats: number }): boolean {
  return p.left <= 0 && p.unsent <= 0 && p.roundSats > 0 && p.spareSats >= p.roundSats;
}
