/**
 * BSVGun storm worker: signs and broadcasts its share of lanes on its own CPU core.
 * Each lane is an unconfirmed chain: coin → blast → blast → … (one OP_RETURN tag + change each).
 * Messages in:  { type: 'start', wif, token, lanes: [{ hex, vout, count }], startN, step }
 *               { type: 'stop' }
 * Messages out: { type: 'sent', n, last }   n = newly accepted blasts
 *               { type: 'why', text }       a rejection reason (for the UI)
 *               { type: 'done' }
 */
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';

const ARC_URL = 'https://arc.gorillapool.io';
const TAG = 'tokenblaster.lol';
const FEE_RATE = 100; // sats/kB
// Orphan is NOT bad here: a chained blast often reaches ARC a moment before its parent is processed;
// it's held and goes through once the parent lands.
const BAD = /REJECT|DOUBLE|INVALID|ERROR/i;
const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

let stopped = false;

type Lane = { tx: Transaction; vout: number; left: number; n: number };

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopped = true;
    return;
  }
  if (m.type !== 'start') return;
  const key = PrivateKey.fromWif(m.wif);
  const lock = new P2PKH().lock(key.toAddress());
  const unlock = new P2PKH().unlock(key);
  const token: string = m.token || 'sats';
  // Each lane numbers its blasts in its own range so numbers never collide across workers.
  let lanes: Lane[] = (m.lanes as { hex: string; vout: number; count: number; n: number }[]).map((l) => ({
    tx: Transaction.fromHex(l.hex),
    vout: l.vout,
    left: l.count,
    n: l.n,
  }));
  const step: number = m.step;
  let fee = 0; // worked out once (every blast is the same size, give or take a digit)

  while (lanes.length && !stopped) {
    // Build up to `step` chained blasts per lane.
    const chains: Transaction[][] = [];
    for (const lane of lanes) {
      const chain: Transaction[] = [];
      let prev = lane.tx;
      let vout = lane.vout;
      while (chain.length < Math.min(step, lane.left) && !stopped) {
        const have = prev.outputs[vout].satoshis ?? 0;
        const tx = new Transaction();
        tx.addInput({ sourceTransaction: prev, sourceOutputIndex: vout, unlockingScriptTemplate: unlock });
        tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, token, String(lane.n + chain.length), 'bsvgun'].map(hex).join(' ')}`), satoshis: 0 });
        if (!fee) {
          tx.addOutput({ lockingScript: lock, change: true });
          await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
          fee = have - (tx.outputs[1].satoshis ?? 0) + 2;
        } else {
          if (have - fee < 1) break;
          tx.addOutput({ lockingScript: lock, satoshis: have - fee });
        }
        if ((tx.outputs[1].satoshis ?? 0) < 1) break;
        await tx.sign();
        chain.push(tx);
        prev = tx;
        vout = 1;
      }
      chains.push(chain);
    }
    if (!chains.some((c) => c.length)) break;

    // One ARC request for this worker's round; EF format carries each parent's output.
    const all = chains.flat();
    let results: { txStatus?: string; extraInfo?: string; status?: number; detail?: string }[] = [];
    try {
      const r = await fetch(`${ARC_URL}/v1/txs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all.map((t) => ({ rawTx: t.toHexEF() }))),
      });
      const body = await r.json();
      results = Array.isArray(body) ? body : [];
      if (!Array.isArray(body)) self.postMessage({ type: 'why', text: `ARC ${r.status}: ${body?.detail ?? body?.title ?? 'error'}` });
    } catch (err) {
      self.postMessage({ type: 'why', text: err instanceof Error ? err.message : String(err) });
    }

    // Count what ARC took, lane by lane; a lane carries on only from its last accepted blast.
    let at = 0;
    let got = 0;
    let last: string | undefined;
    const next: Lane[] = [];
    chains.forEach((c, i) => {
      let k = 0;
      while (k < c.length) {
        const r = results[at + k];
        if (!r || !r.txStatus || BAD.test(`${r.txStatus} ${r.extraInfo ?? ''}`)) break;
        k++;
      }
      if (k < c.length && results[at + k]) {
        const r = results[at + k];
        self.postMessage({ type: 'why', text: `${r.txStatus ?? r.status ?? ''} ${r.extraInfo ?? r.detail ?? ''}`.trim() });
      }
      at += c.length;
      got += k;
      const lane = lanes[i];
      // A lane where everything we sent was accepted keeps going; a broken lane stops
      // (re-sending from a coin of unknown fate risks a double spend).
      if (k && k === c.length && lane.left - k > 0) {
        last = c[k - 1].id('hex');
        // Drop ancestry so memory stays flat: keep only the last tx as the next parent.
        next.push({ tx: Transaction.fromHex(c[k - 1].toHex()), vout: 1, left: lane.left - k, n: lane.n + k });
      } else if (k) last = c[k - 1].id('hex');
    });
    if (got) self.postMessage({ type: 'sent', n: got, last });
    lanes = next;
  }
  self.postMessage({ type: 'done' });
};
