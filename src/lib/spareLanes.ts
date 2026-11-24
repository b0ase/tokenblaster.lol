/**
 * Spare lanes (owner, 24 Nov 2026: a released gun came back SHORT): lane coins a storm session fanned out but never
 * fired. Until now every lane of a used fan-out was marked spent at session end, and at ~62 sats a lane sits under
 * every coin read's 100-sat cut, so the rounds were simply gone. Now the senders name the lanes they never signed
 * from (src/lib/stormCore.ts UnfiredLane), the gun keeps them here, and the next LOCK & LOAD / RELOAD fires them
 * first: no new fan-out, no wait for the network, nothing written off.
 */
import { LANE_DEPTH } from './gallery';
import type { UnfiredLane } from './stormCore';
import type { StormBase } from './stormRun';
import type { LaneSpec } from './fanoutStream';

/** Stored form: one record per fan-out and lane value, its vouts as [first, last] runs (lanes go unfired in runs). */
export type SpareRec = { t: string; s: number; r: number[] };

/** Base numbers for spare fan-outs, clear of a load's own root (0) and leaves (1..leaves). */
export const SPARE_BASE = 1_000_000;

export const spareKey = (l: { txid: string; vout: number }) => `${l.txid}_${l.vout}`;

export function encodeSpare(lanes: UnfiredLane[]): SpareRec[] {
  const groups = new Map<string, { t: string; s: number; v: number[] }>();
  for (const l of lanes) {
    const k = `${l.txid}:${l.sats}`;
    const g = groups.get(k) ?? { t: l.txid, s: l.sats, v: [] };
    g.v.push(l.vout);
    groups.set(k, g);
  }
  return [...groups.values()].map(({ t, s, v }) => {
    const sorted = [...new Set(v)].sort((a, b) => a - b);
    const r: number[] = [];
    for (const x of sorted) {
      if (r.length && r[r.length - 1] === x - 1) r[r.length - 1] = x;
      else r.push(x, x);
    }
    return { t, s, r };
  });
}

export function decodeSpare(recs: unknown): UnfiredLane[] {
  if (!Array.isArray(recs)) return [];
  const out: UnfiredLane[] = [];
  for (const x of recs as SpareRec[]) {
    if (!x || typeof x.t !== 'string' || !/^[0-9a-f]{64}$/.test(x.t) || !(x.s > 0) || !Array.isArray(x.r)) continue;
    for (let i = 0; i + 1 < x.r.length; i += 2) for (let v = x.r[i]; v <= x.r[i + 1]; v++) out.push({ txid: x.t, vout: v, sats: x.s });
  }
  return out;
}

/** Add `more` to `have`, once per outpoint, leaving out anything in `spent`. */
export function mergeSpare(have: UnfiredLane[], more: UnfiredLane[], spent: Set<string>): UnfiredLane[] {
  const seen = new Set<string>();
  return [...have, ...more].filter((l) => {
    const k = spareKey(l);
    if (seen.has(k) || spent.has(k) || !(l.sats > 0)) return false;
    seen.add(k);
    return true;
  });
}

/** Rounds one spare lane carries at `perBlast` sats a blast (at most LANE_DEPTH, and at least 1 sat of change left). */
export const spareRounds = (sats: number, perBlast: number) => Math.max(0, Math.min(LANE_DEPTH, Math.floor((sats - 1) / perBlast)));

/**
 * Take spare lanes for up to `total` rounds: the batch to hand the senders (bases numbered from SPARE_BASE), the
 * rounds it carries, the lanes taken and the ones left. Lanes in `spent` or too small for one blast are dropped.
 */
export function takeSpare(spare: UnfiredLane[], total: number, perBlast: number, spent: Set<string>) {
  const taken: UnfiredLane[] = [];
  const rest: UnfiredLane[] = [];
  let rounds = 0;
  for (const l of spare) {
    if (spent.has(spareKey(l))) continue;
    const n = spareRounds(l.sats, perBlast);
    if (!n) continue;
    if (rounds >= total) {
      rest.push(l);
      continue;
    }
    taken.push(l);
    rounds += Math.min(n, total - rounds);
  }
  const index = new Map<string, number>();
  const bases: StormBase[] = [];
  const lanes: LaneSpec[] = [];
  let left = total;
  for (const l of taken) {
    let i = index.get(l.txid);
    if (i === undefined) {
      i = SPARE_BASE + bases.length;
      index.set(l.txid, i);
      bases.push({ i, txid: l.txid, values: [] });
    }
    const b = bases[i - SPARE_BASE];
    while (b.values.length <= l.vout) b.values.push(0);
    b.values[l.vout] = l.sats;
    const count = Math.min(spareRounds(l.sats, perBlast), left);
    left -= count;
    lanes.push({ base: i, vout: l.vout, count });
  }
  return { bases, lanes, rounds, taken, rest };
}
