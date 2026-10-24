// Stress signer worker: signs its chains in segments of `seg` links, posting each segment and then
// waiting for {go:true} before the next one (backpressure: the sender never holds more than it can send).
import { parentPort, workerData } from 'node:worker_threads';
import { makeSigner, opReturnFor } from '../signer.mjs';

const { jwk, heads, fee, token, seg, game } = workerData;   // heads: [{ c, txid, vout, value, depth }]
const s = makeSigner(jwk);
const state = heads.map((h) => ({ c: h.c, txidLE: Buffer.from(h.txid, 'hex').reverse(), vout: h.vout, value: h.value, left: h.depth, i: 0 }));

function round() {
  const parts = [], meta = [];   // meta: [chain, len] per tx
  for (const st of state) {
    for (let k = 0; k < seg && st.left > 0 && st.value - fee >= 1; k++) {
      st.i++; st.left--;
      const t = s.blast(st.txidLE, st.vout, st.value, opReturnFor(token, `${st.c}:${st.i}`, game), fee);
      parts.push(t.ef); meta.push(st.c, t.ef.length);
      st.txidLE = t.txidLE; st.vout = 1; st.value = t.change;
    }
  }
  if (!parts.length) return parentPort.postMessage({ end: true });
  const buf = Buffer.concat(parts);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parentPort.postMessage({ ab, meta }, [ab]);
}
parentPort.on('message', (m) => { if (m.go) round(); });
round();
