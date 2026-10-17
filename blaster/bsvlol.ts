// bsv.lol watcher: block height and the per-app counts it shows (txs since the last block, by app).
// Same public API its page uses (https://bsv.lol/api/dvr/seek); read-only.
const SEEK = 'https://bsv.lol/api/dvr/seek';

export type LolStatus = { height: number; counts: [string, number][]; total: number };

export async function lolStatus(): Promise<LolStatus | null> {
  try {
    const r = await fetch(`${SEEK}?t=${Date.now()}&txCount=50`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { blocks?: { height: number }[]; counts?: Record<string, number>; totalTx?: number };
    const height = Math.max(0, ...(j.blocks ?? []).map((b) => b.height));
    const counts = Object.entries(j.counts ?? {}).sort((a, b) => b[1] - a[1]);
    return { height, counts, total: j.totalTx ?? 0 };
  } catch {
    return null;
  }
}

/** "TokenBlaster #1 · 5,349" style line, plus the leader if it isn't us. */
export function rankLine(s: LolStatus, app = 'TokenBlaster'): string {
  const i = s.counts.findIndex(([k]) => k === app);
  const mine = i >= 0 ? s.counts[i][1] : 0;
  const lead = s.counts[0];
  const rank = i >= 0 ? `#${i + 1}` : 'unranked';
  return `bsv.lol: ${app} ${rank} · ${mine.toLocaleString()}` + (lead && lead[0] !== app ? ` (leader ${lead[0]} ${lead[1].toLocaleString()})` : '');
}

export async function waitForBlock(onTick?: (s: LolStatus | null, secs: number) => void, signal?: { stop: boolean }): Promise<number> {
  const start = await lolStatus();
  const h0 = start?.height ?? 0;
  const t0 = Date.now();
  for (;;) {
    if (signal?.stop) return h0;
    await new Promise((r) => setTimeout(r, 4000));
    const s = await lolStatus();
    onTick?.(s, (Date.now() - t0) / 1000);
    if (s && h0 && s.height > h0) return s.height;
  }
}

const RED = '\x1b[38;5;196m', DIM = '\x1b[38;5;240m', GREY = '\x1b[38;5;250m', RESET = '\x1b[0m';
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (tty ? `${code}${s}${RESET}` : s);

/** The bsv.lol board as a bar chart: top apps since the last block, TokenBlaster in red. */
export function chart(s: LolStatus, rows = 6, width = 40, app = 'TokenBlaster'): string[] {
  let top = s.counts.slice(0, rows);
  if (!top.some(([k]) => k === app)) { const mine = s.counts.find(([k]) => k === app); if (mine) top = [...top.slice(0, rows - 1), mine]; }
  const max = Math.max(1, ...top.map(([, v]) => v));
  const lines = [c(DIM, `  BSV.LOL · since block ${s.height.toLocaleString()} · ${s.total.toLocaleString()} txs`)];
  for (const [k, v] of top) {
    const len = Math.max(v > 0 ? 1 : 0, Math.round((v / max) * width));
    const bar = '█'.repeat(len) + c(DIM, '░'.repeat(width - len));
    const mine = k === app;
    lines.push(`  ${mine ? c(RED, k.padEnd(14).slice(0, 14)) : c(GREY, k.padEnd(14).slice(0, 14))} ${mine ? c(RED, bar) : c(GREY, bar)} ${(mine ? c(RED, v.toLocaleString()) : v.toLocaleString()).padStart(9)}`);
  }
  return lines;
}
