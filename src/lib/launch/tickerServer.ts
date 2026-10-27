import 'server-only';
import { rpc } from './server';
import { pickByTicker, type TickerRow } from './ticker';

/** The deploy outpoint of the BlastPad coin a ticker names (live first, then newest), or null. Test coins included. */
export async function outpointForTicker(raw: string): Promise<string | null> {
  const rows = await rpc<TickerRow[]>('tokenblaster_launch_board', {}, false).catch(() => [] as TickerRow[]);
  return pickByTicker(rows, raw)?.token_id ?? null;
}
