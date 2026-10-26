/**
 * BSVGun storm worker: signs and broadcasts its share of lanes on its own CPU core. The sender itself is
 * src/lib/stormCore.ts (shared with the node tests); this file only wires messages to it.
 *
 * Messages in:  { type: 'start', wif, token, hex, more?, lanes: [{ vout, count, n, base? }], game?, extra?, arcs?, broadcaster?, maxDepth?, paused?, waitFor? }
 *               hex: the split tx; lane coins are its outputs `vout` (or of more[base - 1]: a big fan-out has several). game: the <game> push (default 'bsvgun');
 *               extra: short pushes after it (the player's paymail). arcs: broadcaster base URLs (default GorillaPool).
 *               broadcaster: 'arc' (default) | 'arcade'. maxDepth: deepest chain per lane coin.
 *               waitFor: ARC X-WaitFor header (default SEEN_ON_NETWORK, '' = off).
 *               burn: { id, per, toLockHex } for coin ammo; then each lane also has tok: { vout, amt } (src/lib/stormCore.ts).
 *               { type: 'stop' } | { type: 'pause' } | { type: 'resume' }  (paused: hold fire, keep lanes)
 * Messages out: { type: 'sent', n, last, seen, orphans, statuses }  n = newly ACCEPTED blasts; seen = on the
 *                                                          network now (SEEN_ON_NETWORK etc.); statuses = histogram
 *               { type: 'batch', via, n, ms, statuses }  every POST's answer (the [tb-load] orphan log)
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
  try {
    const base = Transaction.fromHex(m.hex);
    await runLanes(
      {
        priv: Uint8Array.from(PrivateKey.fromWif(m.wif).toArray('be', 32)),
        token: m.token,
        baseTxid: base.id('hex'),
        baseValues: base.outputs.map((o) => o.satoshis ?? 0),
        bases: Array.isArray(m.more)
          ? m.more.map((h: string) => {
              const t = Transaction.fromHex(h);
              return { txid: t.id('hex'), values: t.outputs.map((o) => o.satoshis ?? 0) };
            })
          : undefined,
        lanes: m.lanes,
        burn: m.burn && typeof m.burn.id === 'string' ? { id: m.burn.id, per: String(m.burn.per), toLockHex: String(m.burn.toLockHex) } : undefined,
        step: m.step,
        game: typeof m.game === 'string' && m.game ? m.game : undefined,
        extra: m.extra,
        arcs: Array.isArray(m.arcs) ? m.arcs : undefined,
        broadcaster: m.broadcaster === 'arcade' ? 'arcade' : 'arc',
        maxDepth: typeof m.maxDepth === 'number' ? m.maxDepth : undefined,
        waitFor: typeof m.waitFor === 'string' ? m.waitFor : undefined,
      },
      { stopped: () => stopped, paused: () => paused, emit: (o) => self.postMessage(o) },
    );
  } catch (err) {
    self.postMessage({ type: 'why', text: err instanceof Error ? err.message : String(err) });
  } finally {
    // Always say done: runStorm (and the gun lock behind it) waits for every worker's done.
    self.postMessage({ type: 'done' });
  }
};
