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

  /**
   * One token burn (coin ammo, 25 Oct 2026). Same shape as Gun.fireTokens / buildTokenBurns:
   *   in  [token coin (1 sat, BSV-21 to this key), fee coin (P2PKH)]
   *   out [`per` tokens → `toLock` (the burn address), rest → this key (if any), OP_RETURN tag (0), change]
   * Returns null when the fee coin can't pay. `tok.lock` is the token coin's locking script (its inscription).
   */
  function burn(
    tok: { txidLE: Uint8Array; vout: number; amt: bigint; lock: Uint8Array },
    feeIn: { txidLE: Uint8Array; vout: number; value: number },
    id: string,
    per: bigint,
    toLock: Uint8Array,
    data: Uint8Array,
    satsPerKb: number,
  ): TokenBurn | null {
    const rest = tok.amt - per;
    const burnOut = bsv21Lock(id, per, toLock);
    const restLock = rest > BigInt(0) ? bsv21Lock(id, rest, lock) : null;
    const fixed = [cat([u64(1), varint(burnOut.length), burnOut]), ...(restLock ? [cat([u64(1), varint(restLock.length), restLock])] : []), cat([u64(0), varint(data.length), data])];
    const nOut = fixed.length + 1;
    const outsLen = fixed.reduce((n, o) => n + o.length, 0) + 8 + 1 + lock.length;
    // version 4 + in-count 1 + 2 × (outpoint 36 + len 1 + sig 74 + pub 34 + seq 4) + out-count 1 + outs + locktime 4
    const bytes = 4 + 1 + 2 * (36 + 1 + 74 + 34 + 4) + 1 + outsLen + 4;
    const fee = Math.ceil((bytes * satsPerKb) / 1000) + 1;
    const change = feeIn.value - fee;
    if (change < 1) return null;
    const outs = cat([...fixed, u64(change), lockLen, lock]);
    const op0 = cat([tok.txidLE, u32(tok.vout)]);
    const op1 = cat([feeIn.txidLE, u32(feeIn.vout)]);
    const hashPrev = sha2(cat([op0, op1]));
    const hashSeq = sha2(cat([SEQ, SEQ]));
    const hashOuts = sha2(outs);
    const pre = (op: Uint8Array, script: Uint8Array, value: number) => cat([VERSION, hashPrev, hashSeq, op, varint(script.length), script, u64(value), SEQ, hashOuts, LOCKTIME, SIGHASH]);
    const unlock0 = cat([push(sig(sha2(pre(op0, tok.lock, 1)))), pubPush]);
    const unlock1 = cat([push(sig(sha2(pre(op1, lock, feeIn.value)))), pubPush]);
    const in0 = cat([op0, varint(unlock0.length), unlock0, SEQ]);
    const in1 = cat([op1, varint(unlock1.length), unlock1, SEQ]);
    const raw = cat([VERSION, Uint8Array.of(2), in0, in1, Uint8Array.of(nOut), outs, LOCKTIME]);
    const ef = cat([VERSION, EF_MARKER, Uint8Array.of(2), in0, u64(1), varint(tok.lock.length), tok.lock, in1, u64(feeIn.value), lockLen, lock, Uint8Array.of(nOut), outs, LOCKTIME]);
    return { raw, ef, txidLE: sha2(raw), change, changeVout: nOut - 1, rest, restLock };
  }

  return { blast, burn, feeFor, lock, pub };
}

export type TokenBurn = Blast & { changeVout: number; rest: bigint; restLock: Uint8Array | null };

/** The BSV-21 transfer inscription of `amt` of `id` in front of `lock` (byte-identical to gun.ts bsv21()). */
export function bsv21Lock(id: string, amt: bigint, lock: Uint8Array): Uint8Array {
  const json = enc.encode(JSON.stringify({ p: 'bsv-20', op: 'transfer', id, amt: amt.toString() }));
  return cat([Uint8Array.of(0x00, 0x63), push(enc.encode('ord')), Uint8Array.of(0x51), push(enc.encode('application/bsv-20')), Uint8Array.of(0x00), push(json), Uint8Array.of(0x68), lock]);
}
