/**
 * Recent BSV blocks with miner, fees and tx counts, from WhatsOnChain (public, ~3 req/s limit).
 * Blocks never change once buried, so each height is fetched once and kept in memory for the life
 * of the server instance. A request returns what we have and tops the cache up in the background,
 * so the miner-share window fills to WINDOW blocks over the first few minutes after a cold start.
 */
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
export const WINDOW = 144;

export type BlockInfo = { height: number; hash: string; time: number; size: number; txCount: number; fees: number; miner: string };

const cache = new Map<number, BlockInfo>();
let tip = { height: 0, at: 0 };
let filling: Promise<void> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function woc<T>(path: string): Promise<T> {
  const r = await fetch(WOC + path, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`WoC ${r.status}`);
  return r.json() as Promise<T>;
}

/** Strip pool tags to a short readable name. */
function minerName(m: unknown): string {
  const s = typeof m === 'string' ? m.replace(/[^\x20-\x7e]/g, '').trim() : '';
  return s ? s.slice(0, 24) : 'Unknown';
}

async function fetchBlock(height: number): Promise<BlockInfo> {
  const b = await woc<{ hash: string; time: number; size: number; txcount?: number; num_tx?: number; totalFees?: number; miner?: string }>(`/block/height/${height}`);
  return { height, hash: b.hash, time: b.time, size: b.size, txCount: b.txcount ?? b.num_tx ?? 0, fees: Number(b.totalFees) || 0, miner: minerName(b.miner) };
}

async function refreshTip() {
  if (Date.now() - tip.at < 20_000) return;
  const info = await woc<{ blocks: number }>('/chain/info');
  tip = { height: info.blocks, at: Date.now() };
}

/** Fetch up to `max` missing heights, newest first, politely spaced. */
async function fill(max: number) {
  let n = 0;
  for (let h = tip.height; h > tip.height - WINDOW && n < max; h--) {
    if (cache.has(h)) continue;
    try {
      cache.set(h, await fetchBlock(h));
    } catch {
      await sleep(1500); // rate limited: back off and stop this round
      break;
    }
    n++;
    await sleep(400);
  }
  for (const h of cache.keys()) if (h <= tip.height - WINDOW - 6) cache.delete(h);
}

export type BlocksSummary = {
  tip: number;
  blocks: BlockInfo[];
  miners: { name: string; blocks: number; pct: number }[];
  avgSize: number;
  avgFees: number;
  avgInterval: number;
  avgTx: number;
  window: number;
  at: string;
};

export async function recentBlocks(): Promise<BlocksSummary> {
  await refreshTip();
  // Wait for the newest few, then keep filling in the background.
  if (!filling) {
    filling = fill(6).finally(() => {
      filling = fill(30).finally(() => (filling = null));
    });
    await Promise.race([filling, sleep(6000)]);
  }
  const blocks = [...cache.values()].filter((b) => b.height > tip.height - WINDOW).sort((a, b) => b.height - a.height);
  const count = new Map<string, number>();
  for (const b of blocks) count.set(b.miner, (count.get(b.miner) ?? 0) + 1);
  const miners = [...count].map(([name, n]) => ({ name, blocks: n, pct: blocks.length ? (n / blocks.length) * 100 : 0 })).sort((a, b) => b.blocks - a.blocks);
  const avg = (f: (b: BlockInfo) => number) => (blocks.length ? blocks.reduce((s, b) => s + f(b), 0) / blocks.length : 0);
  // Interval over contiguous heights only.
  let span = 0;
  let gaps = 0;
  for (let i = 0; i + 1 < blocks.length; i++) {
    if (blocks[i].height - blocks[i + 1].height === 1) {
      span += blocks[i].time - blocks[i + 1].time;
      gaps++;
    }
  }
  return {
    tip: tip.height,
    blocks: blocks.slice(0, 30),
    miners,
    avgSize: avg((b) => b.size),
    avgFees: avg((b) => b.fees),
    avgTx: avg((b) => b.txCount),
    avgInterval: gaps ? span / gaps : 0,
    window: blocks.length,
    at: new Date().toISOString(),
  };
}
