/**
 * BSVGun storm worker: signs and broadcasts its share of lanes on its own CPU core. The sender itself is
 * src/lib/stormCore.ts (shared with the node tests); this file only wires messages to it.
 *
 * Messages in:  { type: 'start', wif, token, hex, lanes: [{ vout, count, n }], step, game?, extra?, arcs?, paused?, waitFor? }
 *               hex: the split tx; lane coins are its outputs `vout`. game: the <game> push (default 'bsvgun');
 *               extra: short pushes after it (the player's paymail). arcs: ARC base URLs (default GorillaPool).
 *               waitFor: ARC X-WaitFor header (off by default).
 *               { type: 'stop' } | { type: 'pause' } | { type: 'resume' }  (paused: hold fire, keep lanes)
 * Messages out: { type: 'sent', n, last, seen, statuses }  n = newly ARC-ACCEPTED blasts; seen = of those, on the
 *                                                          network now (SEEN_ON_NETWORK etc.); statuses = histogram
 *               { type: 'why', text }       a rejection reason (for the UI)
 *               { type: 'stats', stats }    signed / posted / accepted / signMs / postMs / posts since the last one
 *               { type: 'done' }
 */
import { PrivateKey, Transaction } from '@bsv/sdk';
import { runLanes } from '../lib/stormCore';

let stopped = false;
let paused = false;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopped = true;
    return;
  }
  if (m.type === 'pause' || m.type === 'resume') {
    paused = m.type === 'pause';
    return;
  }
  if (m.type !== 'start') return;
  paused = Boolean(m.paused);
  const base = Transaction.fromHex(m.hex);
  await runLanes(
    {
      priv: Uint8Array.from(PrivateKey.fromWif(m.wif).toArray('be', 32)),
      token: m.token,
      baseTxid: base.id('hex'),
      baseValues: base.outputs.map((o) => o.satoshis ?? 0),
      lanes: m.lanes,
      step: m.step,
      game: typeof m.game === 'string' && m.game ? m.game : undefined,
      extra: m.extra,
      arcs: Array.isArray(m.arcs) ? m.arcs : undefined,
      waitFor: typeof m.waitFor === 'string' ? m.waitFor : undefined,
    },
    { stopped: () => stopped, paused: () => paused, emit: (o) => self.postMessage(o) },
  );
  self.postMessage({ type: 'done' });
};
