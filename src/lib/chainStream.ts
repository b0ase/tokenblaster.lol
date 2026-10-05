'use client';

/**
 * One shared JungleBus stream per page. Every component that wants live transactions subscribes
 * here instead of opening its own websocket; the stream opens with the first subscriber and
 * closes (after a short grace) when the last one leaves. Each classified tx is also re-broadcast
 * on window as FEED_EVENT so the gun can see its blasts land.
 */
import type { ChainStats } from './chain';
import { FEED_EVENT, classify, type FeedTx } from './feed';
import { streamSubscription, type JbTx } from './junglebus';
import { tokenMeta } from './tokenMeta';

const SUBSCRIPTION = process.env.NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID ?? '';

export type StreamStatus = 'off' | 'connecting' | 'live' | 'error';

type TxListener = (f: FeedTx) => void;
type StatusListener = (s: StreamStatus) => void;

const txListeners = new Set<TxListener>();
const statusListeners = new Set<StatusListener>();
let status: StreamStatus = SUBSCRIPTION ? 'connecting' : 'off';
let stop: (() => void) | null = null;
let starting = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const ids = new Set<string>();

const setStatus = (s: StreamStatus) => {
  status = s;
  for (const l of statusListeners) l(s);
};

const onTx = (tx: JbTx) => {
  if (ids.has(tx.id)) return;
  ids.add(tx.id);
  if (ids.size > 8000) ids.clear();
  const f = classify(tx.id, tx.hex, tx.mined);
  if (!f) return;
  if (f.token) tokenMeta(f.token); // start fetching its name/icon now
  window.dispatchEvent(new CustomEvent<FeedTx>(FEED_EVENT, { detail: f }));
  for (const l of txListeners) l(f);
};

function open() {
  if (!SUBSCRIPTION || stop || starting) return;
  starting = true;
  setStatus('connecting');
  fetch('/api/chain')
    .then((r) => r.json())
    .then((s: ChainStats) => {
      starting = false;
      if (txListeners.size === 0 && statusListeners.size === 0) return;
      stop = streamSubscription(SUBSCRIPTION, s.height || 0, { onTx, onState: setStatus });
    })
    .catch(() => {
      starting = false;
      setStatus('error');
    });
}

function maybeClose() {
  if (txListeners.size || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (txListeners.size) return;
    stop?.();
    stop = null;
    if (SUBSCRIPTION) setStatus('connecting');
  }, 2000);
}

/** Receive every classified live tx. Returns an unsubscribe function. */
export function subscribeTx(l: TxListener) {
  txListeners.add(l);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  open();
  return () => {
    txListeners.delete(l);
    maybeClose();
  };
}

/** Receive stream status changes (called immediately with the current status). */
export function subscribeStatus(l: StatusListener) {
  statusListeners.add(l);
  l(status);
  return () => {
    statusListeners.delete(l);
  };
}
