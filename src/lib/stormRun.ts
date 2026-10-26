/**
 * The storm's worker fan-out (used by Gun.storm() in src/lib/gun.ts and by the throughput bench,
 * scripts/storm-bench.ts): split the lanes over up to `cores` workers (public/storm-worker.js, built from
 * src/workers/storm.ts), forward stop / pause, and add up what ARC accepted.
 */
export type StormLane = { vout: number; count: number; n: number; base?: number; tok?: { vout: number; amt: string } };
export type StormRunOpts = {
  workerUrl: string;
  /** The split tx (hex) whose outputs are the lane coins. */
  baseHex: string;
  /** More fan-out txs (hex): a lane with `base: i` (i >= 1) spends moreHex[i - 1] (src/lib/stormCore.ts StartMsg.bases). */
  moreHex?: string[];
  lanes: StormLane[];
  wif: string;
  token: string;
  step: number;
  game?: string;
  extra?: string[];
  /** Broadcaster base URLs (default GorillaPool). Each worker spreads its POSTs over them. */
  arcs?: string[];
  /** 'arc' (default) or 'arcade' (src/lib/stormCore.ts). */
  broadcaster?: 'arc' | 'arcade';
  /** Deepest chain per lane coin (src/lib/stormCore.ts MAX_DEPTH for the sats storm). */
  maxDepth?: number;
  cores: number;
  stop: () => boolean;
  paused: () => boolean;
  /** Coin ammo: burn `per` of token `id` to `toLockHex` per shot (src/lib/stormCore.ts StartMsg.burn). */
  burn?: { id: string; per: string; toLockHex: string };
  /** ARC X-WaitFor header for every POST (default SEEN_ON_NETWORK, '' = off: see src/lib/stormCore.ts). */
  waitFor?: string;
  /** Called with the running total of ARC-ACCEPTED blasts (never attempted ones), and of those ARC says are on
   * the network now (SEEN_ON_NETWORK / ACCEPTED_BY_NETWORK / MINED) with the running status histogram. */
  onSent: (sent: number, last?: string, net?: StormNet) => void;
  onWhy: (why: string) => void;
  /** Every POST's answer: broadcaster, txs, ms and the status histogram (for the [tb-load] orphan log). */
  onBatch?: (b: StormBatch) => void;
  /** Per-worker stats (bench only): signed, posted, accepted, sign ms, post ms. */
  onStats?: (s: WorkerStats) => void;
};
export type StormNet = { seen: number; orphans: number; statuses: Record<string, number> };
export type StormBatch = { via: string; n: number; ms: number; statuses: Record<string, number> };
export type WorkerStats = { signed: number; posted: number; accepted: number; signMs: number; postMs: number; posts: number; orphans: number };

/** After stop, a worker gets this long to say done (it covers POST_TRIES x POST_TIMEOUT_MS plus back-off), then it is terminated. */
export const STOP_KILL_MS = 40_000;

export async function runStorm(o: StormRunOpts): Promise<{ sent: number; lastWhy?: string; stats: WorkerStats; net: StormNet }> {
  const cores = Math.max(1, Math.min(o.lanes.length, o.cores));
  let sent = 0;
  const net: StormNet = { seen: 0, orphans: 0, statuses: {} };
  let lastWhy: string | undefined;
  const stats: WorkerStats = { signed: 0, posted: 0, accepted: 0, signMs: 0, postMs: 0, posts: 0, orphans: 0 };
  await Promise.all(
    Array.from({ length: cores }, (_, w) => {
      const mine = o.lanes.filter((_, i) => i % cores === w);
      return new Promise<void>((done) => {
        const wk = new Worker(o.workerUrl, { type: 'module' });
        let wasPaused: boolean | null = null;
        let kill: ReturnType<typeof setTimeout> | undefined;
        const poll = setInterval(() => {
          if (o.stop()) {
            // A worker stuck past every POST deadline must not hold the session (and the gun lock) for ever.
            kill ??= setTimeout(end, STOP_KILL_MS);
            return wk.postMessage({ type: 'stop' });
          }
          const p = o.paused();
          if (p !== wasPaused) wk.postMessage({ type: p ? 'pause' : 'resume' });
          wasPaused = p;
        }, 50);
        const end = () => {
          clearInterval(poll);
          clearTimeout(kill);
          wk.terminate();
          done();
        };
        wk.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; n?: number; last?: string; text?: string; stats?: WorkerStats; seen?: number; orphans?: number; statuses?: Record<string, number>; via?: string; ms?: number };
          if (m.type === 'sent') {
            sent += m.n ?? 0;
            net.seen += m.seen ?? 0;
            net.orphans += m.orphans ?? 0;
            // A status-ask message (n 0) only adds to `seen`: its statuses were already counted when the tx was sent.
            if (m.n) for (const [k, v] of Object.entries(m.statuses ?? {})) net.statuses[k] = (net.statuses[k] ?? 0) + v;
            o.onSent(sent, m.last, { seen: net.seen, orphans: net.orphans, statuses: { ...net.statuses } });
          } else if (m.type === 'batch') {
            o.onBatch?.({ via: m.via ?? '', n: m.n ?? 0, ms: m.ms ?? 0, statuses: m.statuses ?? {} });
          } else if (m.type === 'why') {
            lastWhy = m.text;
            o.onWhy(m.text ?? '');
          } else if (m.type === 'stats' && m.stats) {
            for (const k of Object.keys(stats) as (keyof WorkerStats)[]) stats[k] += m.stats[k];
            o.onStats?.(m.stats);
          } else if (m.type === 'done') end();
        };
        wk.onerror = (e) => {
          lastWhy = e.message || 'worker crashed';
          end();
        };
        wk.postMessage({
          type: 'start',
          wif: o.wif,
          token: o.token,
          step: o.step,
          game: o.game,
          extra: o.extra,
          arcs: o.arcs,
          broadcaster: o.broadcaster,
          maxDepth: o.maxDepth,
          waitFor: o.waitFor,
          burn: o.burn,
          paused: o.paused(),
          hex: o.baseHex,
          more: o.moreHex,
          lanes: mine,
        });
      });
    }),
  );
  return { sent, lastWhy, stats, net };
}
