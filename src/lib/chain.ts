/** Live BSV chain stats from WhatsOnChain (no key needed for these endpoints). */
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

export type ChainStats = {
  height: number;
  mempoolTxs: number;
  mempoolBytes: number;
  at: string;
};

export async function chainStats(): Promise<ChainStats> {
  const [info, mempool] = await Promise.all([
    fetch(`${WOC}/chain/info`, { cache: 'no-store' }).then((r) => r.json()),
    fetch(`${WOC}/mempool/info`, { cache: 'no-store' }).then((r) => r.json()),
  ]);
  return {
    height: Number(info.blocks) || 0,
    mempoolTxs: Number(mempool.size) || 0,
    mempoolBytes: Number(mempool.bytes) || 0,
    at: new Date().toISOString(),
  };
}
