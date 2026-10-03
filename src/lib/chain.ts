/** Chain tip from GorillaPool JungleBus (public REST, no key). */
const TIP = 'https://junglebus.gorillapool.io/v1/block_header/tip';

export type ChainStats = { height: number; hash: string; blockTime: number; at: string };

export async function chainStats(): Promise<ChainStats> {
  const tip = await fetch(TIP, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  return {
    height: Number(tip.height) || 0,
    hash: String(tip.hash ?? ''),
    blockTime: Number(tip.time) || 0,
    at: new Date().toISOString(),
  };
}
