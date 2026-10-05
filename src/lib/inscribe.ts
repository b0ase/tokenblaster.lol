/**
 * 1Sat Ordinals inscription locking scripts (no keys here): the ord envelope, a P2PKH lock to the
 * owner, then MAP metadata after OP_RETURN, the layout js-1sat-ord uses:
 *   OP_0 OP_IF "ord" OP_1 <content-type> OP_0 <data> OP_ENDIF <P2PKH> OP_RETURN 1PuQa7K…  SET k v …
 */
import { LockingScript, OP, P2PKH, Utils } from '@bsv/sdk';

const MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5';
const bytes = (s: string) => Utils.toArray(s, 'utf8');

export function inscriptionScript(address: string, file: { contentType: string; data: number[] }, map?: Record<string, string>): LockingScript {
  const s = new LockingScript();
  s.writeOpCode(OP.OP_0).writeOpCode(OP.OP_IF).writeBin(bytes('ord')).writeOpCode(OP.OP_1).writeBin(bytes(file.contentType)).writeOpCode(OP.OP_0).writeBin(file.data).writeOpCode(OP.OP_ENDIF);
  for (const c of new P2PKH().lock(address).chunks) s.chunks.push(c);
  if (map) {
    s.writeOpCode(OP.OP_RETURN).writeBin(bytes(MAP_PREFIX)).writeBin(bytes('SET'));
    for (const [k, v] of Object.entries(map)) s.writeBin(bytes(k)).writeBin(bytes(v));
  }
  return s;
}
