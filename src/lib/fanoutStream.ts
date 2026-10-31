/**
 * Streamed ammo (31 Oct 2026). A $2 TERRORNODE load is ~357k rounds = a root plus 72 leaf fan-outs of 2,500 lane coins
 * (~85 KB each). The old LOCK & LOAD built and signed all 72 on the main thread, POSTed them in one ~6 MB request,
 * waited for every one to be SEEN, and only then let the workers start; every worker then parsed all 72 leaves again
 * (12 workers x 72 x 2,500 outputs as SDK objects), which is what killed the tab.
 *
 * Here the leaves go out in small groups once the root is on the network: the first group is one leaf, so the gun
 * is live as soon as ~2,500 lanes (~5,000 rounds) are SEEN; later groups are built, sent and confirmed in the
 * background, and their lanes are handed to the RUNNING workers. Safety rules kept:
 *  - a leaf is sent only after its parent (the root) is SEEN (the caller waits for it), never with it;
 *  - a lane is handed over only once its leaf is SEEN, and each lane exactly once;
 *  - a root output is reported spent (onSpent) BEFORE its leaf is POSTed, so nothing else re-spends it;
 *  - chains stay 2 deep: lanes are leaf outputs; the workers' own MAX_DEPTH rule is untouched.
 * Memory: a leaf is kept only as { txid, values } once sent (its EF bytes are released after its POST); at most
 * `parallel` groups are in flight. Building is chunked: one leaf, then a yield to the page.
 */
import { P2PKH, SatoshisPerKilobyte, Transaction, type PrivateKey } from '@bsv/sdk';
import { FEE_RATE, isSeen, settleTxs, type Broadcaster } from './stormCore';

/** A status that means no source holds the leaf (so its root output is unspent on the network). */
const BAD_STATUS = /REJECT|DOUBLE|INVALID|ERROR|NOT.?FOUND|NO_ANSWER/i;
import type { FanoutPlan } from './gallery';
import type { StormBase, StormLane } from './stormRun';

export type LaneSpec = Omit<StormLane, 'n'>;
export type StreamOpts = {
  /** The signed root (its outputs 0..leaves-1 fund the leaves); the network already has it. */
  root: Transaction;
  plan: FanoutPlan;
  total: number;
  key: PrivateKey;
  address: string;
  bc: Broadcaster;
  /** Leaves per group: the first is small so play starts at once (default [1, 2, 4, 8, 8, ...]). */
  groups?: number[];
  /** Groups confirming at once (default 3). */
  parallel?: number;
  /** How long one group may take to be SEEN; unseen leaves get one more ask at the end. */
  seenMs: number;
  pollMs?: number;
  cancelled: () => boolean;
  /** A root output is about to be spent by a leaf POST. */
  onSpent: (outpoint: string) => void;
  /**
   * A leaf no source ever saw, even after a re-POST: its root output was never spent on the network, so it is the
   * gun's credit again (31 Oct 2026: 35 such outputs, $0.94, were stranded as "spent" and the retry loaded 8,574).
   */
  onUnspent?: (outpoint: string) => void;
  /** Lanes whose leaf the network has (base = leaf index). */
  onReady: (bases: StormBase[], lanes: LaneSpec[]) => void;
  log?: (s: string) => void;
  /** Give the page a turn (default setTimeout 0). */
  yieldNow?: () => Promise<void>;
};
export const DEFAULT_GROUPS = [1, 2, 4, 8];

/** Lanes of leaf `i`: global lane g = i * SPLIT + j carries rounds g*perLane.. (the old prepareStorm order). */
export function leafLanes(plan: FanoutPlan, total: number, i: number): LaneSpec[] {
  const first = plan.sizes.slice(0, i).reduce((a, b) => a + b, 0);
  const out: LaneSpec[] = [];
  for (let j = 0; j < plan.sizes[i]; j++) {
    const left = total - (first + j) * plan.perLane;
    if (left <= 0) break;
    out.push({ base: i, vout: j, count: Math.min(plan.perLane, left) });
  }
  return out;
}

/** Build and sign leaf `i` (one shared locking script for its 2,500 outputs). */
export async function buildLeaf(root: Transaction, plan: FanoutPlan, key: PrivateKey, address: string, i: number) {
  const lock = new P2PKH().lock(address);
  const leaf = new Transaction();
  leaf.addInput({ sourceTransaction: root, sourceOutputIndex: i, unlockingScriptTemplate: new P2PKH().unlock(key) });
  for (let j = 0; j < plan.sizes[i]; j++) leaf.addOutput({ lockingScript: lock, satoshis: plan.each });
  leaf.addOutput({ lockingScript: lock, change: true });
  await leaf.fee(new SatoshisPerKilobyte(FEE_RATE));
  await leaf.sign();
  return { i, txid: leaf.id('hex'), ef: Uint8Array.from(leaf.toEF()), values: leaf.outputs.map((o) => o.satoshis ?? 0) };
}

/**
 * Send the leaves group by group; resolves `first` once the first group's lanes are handed over (or nothing could be),
 * and `done` once every leaf is sent and settled (or cancelled). Returns the leaf indices never seen.
 */
export function streamLeaves(o: StreamOpts): { first: Promise<number>; done: Promise<{ fed: number; unseen: number[] }> } {
  const yieldNow = o.yieldNow ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const sizes = o.groups ?? DEFAULT_GROUPS;
  const parallel = o.parallel ?? 3;
  const n = o.plan.leaves;
  let fed = 0;
  let firstDone: (v: number) => void = () => undefined;
  const first = new Promise<number>((r) => (firstDone = r));
  // Unseen leaves keep their bytes (only these, so memory stays bounded) for one re-POST at the end.
  const late: { i: number; txid: string; ef: Uint8Array | null; values: number[] }[] = [];
  let firstSettled = false;

  const feed = (ls: { i: number; txid: string; values: number[] }[]) => {
    if (!ls.length) return;
    const lanes = ls.flatMap((l) => leafLanes(o.plan, o.total, l.i));
    fed += lanes.length;
    o.onReady(
      ls.map((l) => ({ i: l.i, txid: l.txid, values: l.values })),
      lanes,
    );
    // GO as soon as ANY leaf is live (not only the first group): a stalled first leaf no longer blocks play.
    if (fed > 0 && !firstSettled) {
      firstSettled = true;
      firstDone(fed);
    }
  };

  const done = (async () => {
    const flying = new Set<Promise<void>>();
    let next = 0;
    let g = 0;
    try {
      while (next < n && !o.cancelled()) {
        const want = sizes[Math.min(g, sizes.length - 1)];
        g++;
        const group: { i: number; txid: string; ef: Uint8Array | null; values: number[] }[] = [];
        for (let k = 0; k < want && next < n && !o.cancelled(); k++, next++) {
          group.push(await buildLeaf(o.root, o.plan, o.key, o.address, next));
          await yieldNow();
        }
        if (!group.length) break;
        for (const l of group) o.onSpent(`${o.root.id('hex')}_${l.i}`);
        const isFirst = g === 1;
        const p = (async () => {
          const r = await settleTxs(
            o.bc,
            group.map((l) => ({ ef: l.ef!, txid: l.txid })),
            { deadlineMs: o.seenMs, pollMs: o.pollMs, stop: o.cancelled },
          );
          if (r.bad.length) o.log?.(`fan-out leaves refused: ${r.bad.length} ${JSON.stringify(r.bad.map((t) => r.statuses[t]))}`);
          feed(group.filter((l) => r.seen.has(l.txid)));
          late.push(...group.filter((l) => !r.seen.has(l.txid)));
          for (const l of group) if (r.seen.has(l.txid)) l.ef = null; // seen: release the bytes
          o.log?.(`fan-out group ${g}: ${r.seen.size}/${group.length} leaves seen, ${fed} lanes live`);
        })();
        const q: Promise<void> = p.finally(() => flying.delete(q));
        flying.add(q);
        // The first group goes alone, so nothing competes with it; later ones overlap up to `parallel`.
        if (isFirst) await q;
        while (flying.size >= parallel) await Promise.race(flying);
      }
      await Promise.all(flying);
      // Leaves not seen within their group's deadline (or refused): POST them again (both sources), then wait once
      // more and feed the ones the network has now. The game keeps firing on the live lanes meanwhile.
      if (late.length && !o.cancelled()) {
        const again = late.splice(0);
        const r = await settleTxs(
          o.bc,
          again.filter((l) => l.ef).map((l) => ({ ef: l.ef!, txid: l.txid })),
          { deadlineMs: o.seenMs, pollMs: o.pollMs, stop: o.cancelled },
        ).catch(() => ({ seen: new Set<string>(), statuses: {}, bad: [] as string[] }));
        for (const l of again) l.ef = null;
        feed(again.filter((l) => r.seen.has(l.txid)));
        const lost = again.filter((l) => !r.seen.has(l.txid));
        late.push(...lost);
        // One last look (a source may answer late), then give never-seen root outputs back as credit.
        for (const l of lost) {
          if (o.cancelled()) break;
          const s = await o.bc.status(l.txid).catch(() => null);
          if (isSeen(s?.txStatus)) {
            feed([l]);
            late.splice(late.indexOf(l), 1);
          } else if (!s?.txStatus || BAD_STATUS.test(`${s.txStatus} ${s.extraInfo ?? ''}`)) o.onUnspent?.(`${o.root.id('hex')}_${l.i}`);
        }
      }
    } finally {
      if (!firstSettled) firstDone(fed);
    }
    return { fed, unseen: late.map((l) => l.i) };
  })();
  return { first, done };
}
