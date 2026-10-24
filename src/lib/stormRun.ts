/**
 * The storm's worker fan-out (used by Gun.storm() in src/lib/gun.ts and by the throughput bench,
 * scripts/storm-bench.ts): split the lanes over up to `cores` workers (public/storm-worker.js, built from
 * src/workers/storm.ts), forward stop / pause, and add up what ARC accepted.
 */
export type StormLane = { vout: number; count: number; n: number };
export type StormRunOpts = {
  workerUrl: string;
  /** The split tx (hex) whose outputs 0..lanes-1 are the lane coins. */
  baseHex: string;
  lanes: StormLane[];
  wif: string;
  token: string;
  step: number;
  game?: string;
  extra?: string[];
  /** ARC base URLs (default GorillaPool). Each worker spreads its POSTs over them. */
  arcs?: string[];
  cores: number;
  stop: () => boolean;
  paused: () => boolean;
  /** Called with the running total of ARC-ACCEPTED blasts (never attempted ones). */
  onSent: (sent: number, last?: string) => void;
  onWhy: (why: string) => void;
  /** Per-worker stats (bench only): signed, posted, accepted, sign ms, post ms. */
  onStats?: (s: WorkerStats) => void;
};
export type WorkerStats = { signed: number; posted: number; accepted: number; signMs: number; postMs: number; posts: number };

export async function runStorm(o: StormRunOpts): Promise<{ sent: number; lastWhy?: string; stats: WorkerStats }> {
  const cores = Math.max(1, Math.min(o.lanes.length, o.cores));
  let sent = 0;
  let lastWhy: string | undefined;
  const stats: WorkerStats = { signed: 0, posted: 0, accepted: 0, signMs: 0, postMs: 0, posts: 0 };
  await Promise.all(
    Array.from({ length: cores }, (_, w) => {
      const mine = o.lanes.filter((_, i) => i % cores === w);
      return new Promise<void>((done) => {
        const wk = new Worker(o.workerUrl, { type: 'module' });
        let wasPaused: boolean | null = null;
        const poll = setInterval(() => {
          if (o.stop()) return wk.postMessage({ type: 'stop' });
          const p = o.paused();
          if (p !== wasPaused) wk.postMessage({ type: p ? 'pause' : 'resume' });
          wasPaused = p;
        }, 50);
        const end = () => {
          clearInterval(poll);
          wk.terminate();
          done();
        };
        wk.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; n?: number; last?: string; text?: string; stats?: WorkerStats };
          if (m.type === 'sent') {
            sent += m.n ?? 0;
            o.onSent(sent, m.last);
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
          paused: o.paused(),
          hex: o.baseHex,
          lanes: mine,
        });
      });
    }),
  );
  return { sent, lastWhy, stats };
}
