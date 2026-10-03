/**
 * Minimal browser client for a GorillaPool JungleBus subscription. Talks to JungleBus's Centrifuge
 * websocket directly: @gorillapool/js-junglebus pulls in better-queue, which breaks in browser bundles.
 */
import { Centrifuge } from 'centrifuge';

const HOST = 'https://junglebus.gorillapool.io';
const WS = 'wss://junglebus.gorillapool.io/connection/websocket';

export type JbTx = { id: string; hex: string; mined: boolean };

type Handlers = {
  onTx: (tx: JbTx) => void;
  onState: (state: 'connecting' | 'live' | 'error') => void;
};

const b64ToHex = (b64: string) => {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
};

/** Streams mempool transactions and blocks from `fromBlock` on. Returns a stop function. */
export function streamSubscription(subscriptionId: string, fromBlock: number, { onTx, onState }: Handlers) {
  let token = '';
  const centrifuge = new Centrifuge(WS, {
    getToken: async () => {
      if (!token) {
        const r = await fetch(`${HOST}/v1/user/subscription-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: subscriptionId }),
        });
        if (!r.ok) throw new Error(`subscription-token ${r.status}`);
        token = (await r.json()).token;
        return token;
      }
      const r = await fetch(`${HOST}/v1/user/refresh-token`, { headers: { token } });
      if (!r.ok) throw new Error(`refresh-token ${r.status}`);
      token = (await r.json()).token;
      return token;
    },
  });
  centrifuge.on('connecting', () => onState('connecting'));
  centrifuge.on('connected', () => onState('live'));
  centrifuge.on('error', (e) => {
    console.warn('JungleBus connection error', e);
    onState('error');
  });

  const listen = (channel: string, mined: boolean) => {
    const sub = centrifuge.newSubscription(channel);
    sub.on('publication', (ctx) => {
      const d = ctx.data as { id?: string; transaction?: string };
      // Some publications carry only the txid; nothing to decode there.
      if (d.id && d.transaction) onTx({ id: d.id, hex: b64ToHex(d.transaction), mined });
    });
    sub.on('error', (e) => console.warn('JungleBus subscription error', channel, e));
    sub.subscribe();
  };
  listen(`query:${subscriptionId}:mempool`, false);
  // Block channel: JungleBus replays from fromBlock and then follows new blocks.
  if (fromBlock > 0) listen(`query:${subscriptionId}:${fromBlock}`, true);

  centrifuge.connect();
  return () => centrifuge.disconnect();
}
