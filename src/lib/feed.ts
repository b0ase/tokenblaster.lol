/**
 * Classify a raw transaction from the GorillaPool JungleBus stream by what its outputs carry.
 * Cheap hex matching on the output scripts; good enough to sort traffic into lanes.
 */
import { Transaction, Utils } from '@bsv/sdk';

export type TxKind = 'blast' | 'token' | 'inscription' | 'social' | 'data' | 'payment';

export const KINDS: { id: TxKind; label: string; color: string }[] = [
  { id: 'blast', label: 'TokenBlaster blast', color: '#ffffff' },
  { id: 'token', label: 'BSV-20/21 token', color: '#d4a843' },
  { id: 'inscription', label: 'Ordinal inscription', color: '#ff5a48' },
  { id: 'social', label: 'Social (B / MAP)', color: '#ff9a85' },
  { id: 'data', label: 'Other data', color: '#b0302a' },
  { id: 'payment', label: 'Payment', color: '#ffd0c0' },
];

export type FeedTx = { id: string; kind: TxKind; bytes: number; sats: number; mined: boolean; token?: string; op?: string; amt?: string };

/** Every classified tx is re-broadcast on window as this event, so the gun can see its blasts land. */
export const FEED_EVENT = 'tokenblaster:tx';

/** Script push of a short hex payload (< 76 bytes). */
const push = (h: string) => (h.length / 2).toString(16).padStart(2, '0') + h;
const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
const ORD = '0063036f7264'; // OP_FALSE OP_IF "ord"
const BSV20 = hex('bsv-20');
const BLAST = '006a' + push(hex('tokenblaster.lol'));
const B = hex('19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut');
const MAP = hex('1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5');

export function classify(id: string, raw: string, mined: boolean): FeedTx | null {
  try {
    const tx = Transaction.fromHex(raw);
    const scripts = tx.outputs.map((o) => o.lockingScript.toHex());
    const all = scripts.join('');
    const blast = scripts.find((s) => s.startsWith(BLAST));
    const kind: TxKind = blast
      ? 'blast'
      : all.includes(BSV20)
      ? 'token'
      : all.includes(ORD)
        ? 'inscription'
        : all.includes(B) || all.includes(MAP)
          ? 'social'
          : scripts.some((s) => s.startsWith('6a') || s.startsWith('006a'))
            ? 'data'
            : 'payment';
    const sats = tx.outputs.reduce((n, o) => n + (o.satoshis ?? 0), 0);
    const f: FeedTx = { id, kind, bytes: raw.length / 2, sats, mined };
    // BSV-20/21: which token, what operation, how much (from the first inscription's JSON).
    const ins = all.includes(BSV20) ? tokenJson(scripts.find((s) => s.includes(BSV20)) ?? '') : null;
    if (ins) {
      f.token = ins.id ?? ins.tick;
      f.op = ins.op;
      f.amt = ins.amt;
      if (ins.op === 'deploy+mint' && !ins.id) f.token = `${id}_0`;
    }
    if (blast) {
      // OP_FALSE OP_RETURN <tag> <token id> <n>: read the token id push.
      const rest = blast.slice(BLAST.length);
      const len = parseInt(rest.slice(0, 2), 16);
      if (len < 76) f.token = Utils.toUTF8(Utils.toArray(rest.slice(2, 2 + len * 2), 'hex'));
    }
    return f;
  } catch {
    return null;
  }
}

/** The `{"p":"bsv-20",…}` JSON inside an inscription script (hex). */
function tokenJson(hex: string): { op?: string; id?: string; tick?: string; amt?: string } | null {
  let text = '';
  for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  const m = text.match(/\{"p":"bsv-20"[^}]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
