/**
 * Ramp txs. Blasts come from src/lib/fastBlast.ts (1 P2PKH in → OP_RETURN tag + change, EF). This adds the
 * fan-out (k P2PKH inputs → n P2PKH outputs to the same key, + tag) and an EF parser for the mock servers.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import { makeBlaster, opReturn, push, toHex, fromHex, txidHex } from '../../src/lib/fastBlast';

export const TAG = 'tokenblaster.lol';
export { toHex, fromHex, txidHex };

const sha2 = (b: Uint8Array) => sha256(sha256(b));
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const u64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const varint = (n: number) => (n < 0xfd ? Uint8Array.of(n) : n <= 0xffff ? Uint8Array.of(0xfd, n & 0xff, n >> 8) : Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24));
const SEQ = u32(0xffffffff);
const EF_MARKER = Uint8Array.of(0, 0, 0, 0, 0, 0xef);

export type Coin = { txid: string; vout: number; value: number };
export type Built = { txid: string; ef: Uint8Array; raw: Uint8Array; outputs: number[]; fee: number };

/** The game every stress/ramp tx is filed under: the same 4th push as a live TERRORNODE round (src/lib/gallery.ts). */
export const GAME = 'terrornode';
/** The site's layout "tokenblaster.lol" <ammo> <n> <game>, then the bot or run name: bsv.lol tags each game by its 4th push. */
export const rampTag = (n: number, run: string) => opReturn([TAG, 'sats', String(n), GAME, run]);

export function signer(priv: Uint8Array) {
  const b = makeBlaster(priv);
  const lock = b.lock;
  const pub = secp256k1.getPublicKey(priv, true);
  const pkh = ripemd160(sha256(pub));

  /** One blast on a lane coin: all but the fee goes back as change (>= 1 sat). */
  function blast(c: Coin, n: number, run: string, satsPerKb: number): Built {
    const data = rampTag(n, run);
    const fee = b.feeFor(data, satsPerKb);
    if (c.value - fee < 1) throw new Error(`lane coin ${c.value} sats can't pay fee ${fee}`);
    const x = b.blast(fromHex(c.txid).reverse(), c.vout, c.value, data, fee);
    return { txid: txidHex(x.txidLE), ef: x.ef, raw: x.raw, outputs: [0, x.change], fee };
  }

  /** Bytes of a fan-out with k inputs and n P2PKH outputs (worst-case signatures). */
  const fanBytes = (k: number, n: number, tagLen: number) => 4 + varint(k).length + k * (36 + 1 + 74 + 34 + 4) + varint(n + 1).length + (8 + varint(tagLen).length + tagLen) + n * (8 + 1 + lock.length) + 4;

  /**
   * Fan `inputs` out into `values` (each to this key) plus change; the fee is paid at satsPerKb. Output 0 is the tag,
   * outputs 1..n are `values`, the last is change (omitted if < 1 sat).
   */
  function fanOut(inputs: Coin[], values: number[], run: string, satsPerKb: number): Built {
    const tag = opReturn([TAG, 'sats', 'fan', GAME, run]);
    const total = inputs.reduce((s, c) => s + c.value, 0);
    const want = values.reduce((s, v) => s + v, 0);
    let fee = Math.ceil((fanBytes(inputs.length, values.length + 1, tag.length) * satsPerKb) / 1000) + 1;
    let change = total - want - fee;
    const outVals = [0, ...values];
    if (change < 0) throw new Error(`fan-out short: inputs ${total}, outputs ${want}, fee ${fee}`);
    if (change >= 1) outVals.push(change);
    else { fee += change; change = 0; }
    const outs = cat(outVals.map((v, i) => (i === 0 ? cat([u64(0), varint(tag.length), tag]) : cat([u64(v), varint(lock.length), lock]))));
    const ops = inputs.map((c) => cat([fromHex(c.txid).reverse(), u32(c.vout)]));
    const hashPrev = sha2(cat(ops));
    const hashSeq = sha2(cat(inputs.map(() => SEQ)));
    const hashOuts = sha2(outs);
    const ins = inputs.map((c, i) => {
      const pre = cat([u32(1), hashPrev, hashSeq, ops[i], varint(lock.length), lock, u64(c.value), SEQ, hashOuts, u32(0), u32(0x41)]);
      const der = secp256k1.sign(sha2(pre), priv, { lowS: true, prehash: false }).toDERRawBytes();
      const unlock = cat([push(cat([der, Uint8Array.of(0x41)])), push(pub)]);
      return cat([ops[i], varint(unlock.length), unlock, SEQ]);
    });
    const outCount = varint(outVals.length);
    const raw = cat([u32(1), varint(ins.length), ...ins, outCount, outs, u32(0)]);
    const ef = cat([u32(1), EF_MARKER, varint(ins.length), ...ins.flatMap((x, i) => [x, u64(inputs[i].value), varint(lock.length), lock]), outCount, outs, u32(0)]);
    return { txid: txidHex(sha2(raw)), ef, raw, outputs: outVals, fee };
  }

  return { blast, fanOut, fanBytes, lock, pkh, blastFee: (n: number, run: string, satsPerKb: number) => b.feeFor(rampTag(n, run), satsPerKb) };
}

export type ParsedTx = { txid: string; inputs: { txid: string; vout: number }[]; outputs: number; bytes: number };

/** Parse one EF or raw tx at `at` (mock servers). Returns the tx and where the next one starts. */
export function parseTx(b: Uint8Array, at = 0): { tx: ParsedTx; next: number } {
  const start = at;
  const rd = (n: number) => { const s = b.subarray(at, at + n); if (s.length < n) throw new Error('truncated tx'); at += n; return s; };
  const vi = () => { const f = rd(1)[0]; if (f < 0xfd) return f; if (f === 0xfd) { const s = rd(2); return s[0] | (s[1] << 8); } const s = rd(4); return (s[0] | (s[1] << 8) | (s[2] << 16)) + s[3] * 2 ** 24; };
  const rawParts: Uint8Array[] = [];
  const version = rd(4);
  rawParts.push(version);
  let ef = false;
  if (b[at] === 0 && b[at + 1] === 0 && b[at + 2] === 0 && b[at + 3] === 0 && b[at + 4] === 0 && b[at + 5] === 0xef) { ef = true; rd(6); }
  const inCountAt = at;
  const nIn = vi();
  rawParts.push(b.subarray(inCountAt, at));
  const inputs: ParsedTx['inputs'] = [];
  for (let i = 0; i < nIn; i++) {
    const s0 = at;
    const outp = rd(36);
    const sl = vi();
    rd(sl + 4);
    rawParts.push(b.subarray(s0, at));
    inputs.push({ txid: txidHex(outp.subarray(0, 32)), vout: new DataView(outp.buffer, outp.byteOffset + 32, 4).getUint32(0, true) });
    if (ef) { rd(8); const ll = vi(); rd(ll); }
  }
  const o0 = at;
  const nOut = vi();
  for (let i = 0; i < nOut; i++) { rd(8); const ll = vi(); rd(ll); }
  rd(4);
  rawParts.push(b.subarray(o0, at));
  return { tx: { txid: txidHex(sha2(cat(rawParts))), inputs, outputs: nOut, bytes: at - start }, next: at };
}

export function parseMany(b: Uint8Array): ParsedTx[] {
  const out: ParsedTx[] = [];
  let at = 0;
  while (at < b.length) { const r = parseTx(b, at); out.push(r.tx); at = r.next; }
  return out;
}
