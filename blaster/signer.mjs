// Fast blast signer (worker thread). Builds and signs fixed-shape blast chains with native crypto:
//   1 P2PKH input -> OP_FALSE OP_RETURN "tokenblaster.lol" <token> <chain>:<n>, P2PKH change
// Sighash is BSV's SIGHASH_ALL|FORKID (BIP143-style preimage). Signature is ECDSA over sha256d(preimage),
// low-S, DER. No @bsv/sdk in the hot loop: it is ~15x faster than the SDK's pure-JS signing.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

const EF_MARKER = Buffer.from('0000000000ef', 'hex');
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const sha = (b) => createHash('sha256').update(b).digest();
const sha2 = (b) => sha(sha(b));
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varint = (n) => (n < 0xfd ? Buffer.from([n]) : Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 0xff, n >> 8])]));
const push = (d) => (d.length < 0x4c ? Buffer.concat([Buffer.from([d.length]), d]) : Buffer.concat([Buffer.from([0x4c, d.length]), d]));
const big32 = (b) => BigInt('0x' + b.toString('hex'));
const to32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const derInt = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.subarray(i); return b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b; };

export function makeSigner({ d, x, y }) {
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'secp256k1', d, x, y }, format: 'jwk' });
  const pubX = Buffer.from(x, 'base64url'), pubY = Buffer.from(y, 'base64url');
  const pub = Buffer.concat([Buffer.from([pubY[31] & 1 ? 3 : 2]), pubX]);
  const pkh = createHash('ripemd160').update(sha(pub)).digest();
  const lock = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pkh, Buffer.from([0x88, 0xac])]);
  const sig = (hash32) => {
    const rs = sign('sha256', hash32, { key, dsaEncoding: 'ieee-p1363' });   // ECDSA over sha256(hash32)
    const r = derInt(rs.subarray(0, 32));
    let s = big32(rs.subarray(32));
    if (s > N / 2n) s = N - s;
    const sb = derInt(to32(s));
    const body = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, sb.length]), sb]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body, Buffer.from([0x41])]);
  };
  /** One blast spending (prevTxidLE, vout, value). Returns { raw, txidLE, change }. */
  const blast = (prevTxidLE, vout, value, opReturn, fee) => {
    const change = value - fee;
    const outs = Buffer.concat([
      u64(0), varint(opReturn.length), opReturn,
      u64(change), varint(lock.length), lock,
    ]);
    const outpoint = Buffer.concat([prevTxidLE, u32(vout)]);
    const seq = u32(0xffffffff);
    const pre = Buffer.concat([
      u32(1), sha2(outpoint), sha2(seq), outpoint, varint(lock.length), lock, u64(value), seq, sha2(outs), u32(0), u32(0x41),
    ]);
    const unlock = Buffer.concat([push(sig(sha(pre))), push(pub)]);
    const input = Buffer.concat([outpoint, varint(unlock.length), unlock, seq]);
    const raw = Buffer.concat([u32(1), varint(1), input, varint(2), outs, u32(0)]);
    // Extended Format (BRC-30): each input carries its parent output's value and script, so ARC can
    // validate a whole chain in one batch without looking parents up (raw chained batches time out)
    const ef = Buffer.concat([u32(1), EF_MARKER, varint(1), input, u64(value), varint(lock.length), lock, varint(2), outs, u32(0)]);
    return { raw, ef, txidLE: sha2(raw), change };
  };
  return { blast, lock };
}

// <tag> <token> <n> <game>: game 'cli' gives CLI blasts their own line on the leaderboard
export const opReturnFor = (token, label, game = 'cli') => {
  const parts = ['tokenblaster.lol', token, label, game].map((s) => push(Buffer.from(s, 'utf8')));
  return Buffer.concat([Buffer.from([0x00, 0x6a]), ...parts]);
};

// worker entry: sign `depth` blasts for each head; reply with one buffer of raws + offsets, chain-major
if (parentPort && workerData) {
  const { jwk, heads, depth, fee, token } = workerData;   // heads: [{ c, txid (display hex), vout, value }]
  const s = makeSigner(jwk);
  const parts = [], lens = [];
  for (const h of heads) {
    let txidLE = Buffer.from(h.txid, 'hex').reverse(), vout = h.vout, value = h.value;
    const D = h.depth ?? depth;
    for (let i = 1; i <= D; i++) {
      if (value - fee < 1) break;
      const t = s.blast(txidLE, vout, value, opReturnFor(token, `${h.c}:${i}`), fee);
      parts.push(t.ef); lens.push(t.ef.length);
      txidLE = t.txidLE; vout = 1; value = t.change;
    }
    lens.push(-1);   // end of chain
    parentPort.postMessage({ progress: parts.length });
  }
  const buf = Buffer.concat(parts);
  parentPort.postMessage({ done: true, buf, lens });
}
