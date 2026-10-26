/**
 * TERRORNODE spectator helpers (pure): the room code from the watch URL and the live tx/s from state samples.
 */

/** `?room=` (or `?match=`) on /arcade/terrornode/watch: a 5-character match code, upper-cased, or null. */
export function roomFrom(q: { get: (k: string) => string | null }): string | null {
  const r = (q.get('room') ?? q.get('match') ?? '').trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{5}$/.test(r) ? r : null;
}

export type TxSample = { at: number; tx: number; shots: number };

/** Transactions (and shots) a second across the samples' window (oldest to newest); 0 until it spans `minSecs`. */
export function txRate(samples: TxSample[], minSecs = 1.5): { tx: number; shots: number } {
  if (samples.length < 2) return { tx: 0, shots: 0 };
  const a = samples[0];
  const b = samples[samples.length - 1];
  const secs = (b.at - a.at) / 1000;
  if (secs < minSecs) return { tx: 0, shots: 0 };
  return { tx: Math.max(0, (b.tx - a.tx) / secs), shots: Math.max(0, (b.shots - a.shots) / secs) };
}
