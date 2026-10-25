/**
 * Fast blast builder for the browser storm (src/workers/storm.ts). Same transaction as the SDK path and as
 * blaster/signer.mjs (the CLI's native signer):
 *   1 P2PKH input -> OP_FALSE OP_RETURN <pushes…> (0 sat), P2PKH change
 * Sighash is SIGHASH_ALL|FORKID (BIP143-style preimage); ECDSA (RFC 6979, low-S) over sha256d(preimage), DER.
 *
 * Why: @bsv/sdk signs ~800 tx/s per core in pure JS and its Transaction/Script objects allocate heavily;
 * @noble/curves signs ~4,000/s per core, and building the bytes directly skips the object graph. Pure: no DOM,
 * so the tests run it in Node and check every tx against the SDK's own script interpreter.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';

const enc = new TextEncoder();
const sha2 = (b: Uint8Array) => sha256(sha256(b));

function cat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
const u64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const varint = (n: number) => (n < 0xfd ? Uint8Array.of(n) : Uint8Array.of(0xfd, n & 0xff, n >> 8));
/** A minimal data push (up to 255 bytes). */
export const push = (d: Uint8Array) => (d.length < 0x4c ? cat([Uint8Array.of(d.length), d]) : cat([Uint8Array.of(0x4c, d.length), d]));

/** OP_FALSE OP_RETURN followed by one push per string. */
export const opReturn = (parts: string[]) => cat([Uint8Array.of(0x00, 0x6a), ...parts.map((s) => push(enc.encode(s)))]);

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i]];
  return s;
}
export function fromHex(h: string): Uint8Array {
  const b = new Uint8Array(h.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
}
/** Display txid (big-endian hex) of a little-endian hash. */
export const txidHex = (le: Uint8Array) => toHex(le.slice().reverse());

const EF_MARKER = Uint8Array.of(0x00, 0x00, 0x00, 0x00, 0x00, 0xef);
const SEQ = u32(0xffffffff);
const SHA2_SEQ = sha2(SEQ);
const VERSION = u32(1);
const LOCKTIME = u32(0);
const SIGHASH = u32(0x41);

export type Blast = { raw: Uint8Array; ef: Uint8Array; txidLE: Uint8Array; change: number };

/** A signer bound to one 32-byte private key. Every blast pays its change back to the same key. */
export function makeBlaster(priv: Uint8Array) {
  const pub = secp256k1.getPublicKey(priv, true);
  const pkh = ripemd160(sha256(pub));
  const lock = cat([Uint8Array.of(0x76, 0xa9, 0x14), pkh, Uint8Array.of(0x88, 0xac)]);
  const lockLen = varint(lock.length);
  const pubPush = push(pub);

  const sig = (hash: Uint8Array) => {
    const der = secp256k1.sign(hash, priv, { lowS: true, prehash: false }).toDERRawBytes();
    return cat([der, Uint8Array.of(0x41)]);
  };

  /** One blast spending (prevTxidLE:vout) worth `value` sats; `fee` sats go to the miner, the rest is change. */
  function blast(prevTxidLE: Uint8Array, vout: number, value: number, data: Uint8Array, fee: number): Blast {
    const change = value - fee;
    const outs = cat([u64(0), varint(data.length), data, u64(change), lockLen, lock]);
    const outpoint = cat([prevTxidLE, u32(vout)]);
    const pre = cat([VERSION, sha2(outpoint), SHA2_SEQ, outpoint, lockLen, lock, u64(value), SEQ, sha2(outs), LOCKTIME, SIGHASH]);
    const unlock = cat([push(sig(sha2(pre))), pubPush]);
    const input = cat([outpoint, varint(unlock.length), unlock, SEQ]);
    const raw = cat([VERSION, Uint8Array.of(1), input, Uint8Array.of(2), outs, LOCKTIME]);
    // Extended Format (BRC-30): the input carries its parent output's value and script, so ARC validates a
    // whole chain in one batch without looking parents up.
    const ef = cat([VERSION, EF_MARKER, Uint8Array.of(1), input, u64(value), lockLen, lock, Uint8Array.of(2), outs, LOCKTIME]);
    return { raw, ef, txidLE: sha2(raw), change };
  }

  /** Sats one blast with this payload pays at `satsPerKb` (worst-case 73-byte signature, rounded up, +1). */
  function feeFor(data: Uint8Array, satsPerKb: number) {
    // version 4 + in-count 1 + outpoint 36 + script len 1 + (sig push 1+73) + pubkey push 34 + seq 4
    // + out-count 1 + (8 + varint + data) + (8 + 1 + 25) + locktime 4
    const bytes = 4 + 1 + 36 + 1 + 74 + 34 + 4 + 1 + 8 + varint(data.length).length + data.length + 8 + 1 + lock.length + 4;
    return Math.ceil((bytes * satsPerKb) / 1000) + 1;
  }

  return { blast, feeFor, lock, pub };
}
