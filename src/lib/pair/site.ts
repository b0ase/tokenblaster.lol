/**
 * Phone pairing (docs/wallet-connect.md §4) on @bwalletx/connect: `pairBwalletX` shows a QR (or, on the same phone, a
 * link that opens bWalletX), the phone joins the relay channel, both screens show a 4-digit code, and on Connect we get
 * a BRC-100 wallet whose calls travel to the phone end-to-end encrypted. To the rest of the site it is just another
 * wallet in the chooser.
 *
 * Until connect 0.9 this file was a hand-rolled copy of the protocol. Connect adds what the relay requires from
 * 30 Nov 2026 (a site role claim on every socket, and `wc`, the digest of the QR-bound wallet claim, when a channel is
 * opened; without them relay.bwallet.space refuses new channels), the same-phone return (`#bwx=ok…`, see bwxReturn.ts
 * and `resumeReturnedPairing`), and the rule that after a reconnect only READS are re-sent (a spend is sent once).
 * No origin proofs any more: bWalletX 5.2.61+ ignores them, and every sheet over the relay says "claims to be".
 *
 * What stays ours: the chooser's states (PairState), the paired phone's status (awake / asleep / gone) for the bar,
 * bWallet's reply codes in plain words (PairError), and keeping the pairing for this TAB (sessionStorage), as before.
 * Connect is loaded on demand: it brings its own @bsv/sdk 4.x copy, which stays out of first load.
 */
import type { WalletInterface } from '@bsv/sdk';
import type { PairedWallet, PairStorage, SocketLike } from '@bwalletx/connect';
import QRCode from 'qrcode';
import { bootReturnHash, clearBootReturn } from './bwxReturn';
import { detectPhone } from './phoneUi';

/** Relay host (connect's default). NEXT_PUBLIC_PAIR_RELAY points a dev build at a local relay. */
export const RELAY = process.env.NEXT_PUBLIC_PAIR_RELAY || 'relay.bwallet.space';
/** This tab's pairing, in connect's format. */
export const STORE = 'tokenblaster.pair.v2';
/** Where the hand-rolled code kept it (upgraded in place on the next resume). */
export const OLD_STORE = 'tokenblaster.pair';
const QR_LIFETIME_S = 120;
/** Connect's own per-call limit: above this site's (connect 45 s, payment 180 s, src/lib/wallet.ts), which decide. */
export const CALL_TIMEOUT_MS = 200_000;
/** How long a returned tab waits for the relay to confirm the phone (the old code gave it two minutes). */
export const RETURN_WAIT_MS = 120_000;
/** The phone's name in the chooser and the bar ("bWallet on your phone"). */
export const PHONE_NAME = 'bWallet';

const loadConnect = () => import('@bwalletx/connect');

export type PairState =
  | { k: 'starting' }
  | { k: 'qr'; qr: string; link: string; expires: number }
  | { k: 'code'; code: string; phone: string }
  | { k: 'ready'; wallet: WalletInterface; phone: string }
  | { k: 'error'; message: string };

/**
 * Is the paired phone there? 'asleep' when the relay says its socket left (screen locked, app backgrounded) or a
 * request went unanswered; 'awake' again as soon as it rejoins or answers; 'gone' when it unpaired. 'none' = no phone.
 */
export type PhoneStatus = 'none' | 'awake' | 'asleep' | 'gone';
let phoneStatus: PhoneStatus = 'none';
const statusSubs = new Set<() => void>();
export const getPhoneStatus = () => phoneStatus;
export const subPhoneStatus = (fn: () => void) => (statusSubs.add(fn), () => void statusSubs.delete(fn));
export function setPhoneStatus(s: PhoneStatus) {
  if (s === phoneStatus) return;
  phoneStatus = s;
  for (const f of statusSubs) f();
}

/**
 * bWallet's paired-phone reply codes (bWallet #122). Every refused request comes back as {t:'res', id, error:{code, message}}.
 *   ERR_PERMISSION_DENIED  the user said no (only that). Say so; do not re-pair.
 *   REPAIR_NEEDED          the pairing is over on the phone (a {t:'close'} follows). Fresh QR, no retry.
 *   REJECTED               any other refusal (reserved protocol, blocked). Show the wallet's own message.
 *   ERROR                  a wallet failure (locked, network). Retry later; tell the player to open/unlock bWallet.
 *   LOCKED                 paired CLI/MCP agents only.
 * UNPAIRED is ours: the phone closed the pairing. NO_ANSWER / NO_ANSWER_MAYBE_SENT are connect's (its words kept).
 */
export type PairCode = 'ERR_PERMISSION_DENIED' | 'REPAIR_NEEDED' | 'REJECTED' | 'ERROR' | 'LOCKED' | 'UNPAIRED';
export const DECLINED_TEXT = 'You declined in bWallet.';
export const REPAIR_TEXT = 'This pairing has ended. Scan the QR code on the site again to reconnect.';
/** Where a player with no wallet gets one. */
export const GET_BWALLETX_URL = 'https://bwalletx.com/get';

/** A refusal from the paired phone, carrying bWallet's code. */
export class PairError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PairError';
  }
}

/** Plain words for each code (the site shows these as-is). */
export function pairErrorText(code: string, message = ''): string {
  const m = message.trim().replace(/\.+$/, '');
  switch (code) {
    case 'ERR_PERMISSION_DENIED':
      return DECLINED_TEXT;
    case 'REPAIR_NEEDED':
      return REPAIR_TEXT;
    case 'UNPAIRED':
      return 'You unpaired this site in bWallet. Scan the new QR code to connect again.';
    case 'REJECTED':
      return m ? `bWallet refused: ${m}.` : 'bWallet refused this request.';
    case 'LOCKED':
      return 'bWallet is locked. Unlock it and try again.';
    case 'ERROR':
    default:
      return `bWallet could not do that right now${m ? ` (${m})` : ''}. Open and unlock bWallet on your phone, then try again.`;
  }
}

/** Why the last pairing ended (REPAIR_NEEDED / UNPAIRED), for the chooser's note; null while paired. */
let phoneEnd: PairError | null = null;
export const getPhoneEnd = () => phoneEnd;

/** How long a request may wait with no word from the phone before the site says it is asleep. */
export const ASLEEP_AFTER_MS = 8000;

// ---- Storage: this tab only, and only the live pairing may write it ----

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memory = new Map<string, string>();
const tabStorage = (): KV => {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
  } catch {
    /* blocked: memory only, the pairing just won't survive a reload */
  }
  return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
};

type ScopedStore = PairStorage & { revoke(): void };
/**
 * One per pairing. A pairing that is replaced is revoked first: its connect link may still persist counters or, on
 * forget(), delete the stored pairing, and either would clobber the NEW pairing under the same key.
 */
function scopedStore(): ScopedStore {
  let revoked = false;
  return {
    getItem: (k) => tabStorage().getItem(k),
    setItem: (k, v) => {
      if (!revoked) tabStorage().setItem(k, v);
    },
    removeItem: (k) => {
      if (!revoked) tabStorage().removeItem(k);
    },
    revoke: () => void (revoked = true),
  };
}

/** A pairing the hand-rolled code stored ({c,r,s,k,phone,sent,lastSeen}) becomes connect's ({v:1,…,pairedAt}). */
export function upgradeOldPairing(store: KV = tabStorage(), now = Date.now()) {
  try {
    const raw = store.getItem(OLD_STORE);
    if (!raw) return;
    store.removeItem(OLD_STORE);
    if (store.getItem(STORE)) return;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const n = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
    if (typeof p.c !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(p.c)) return;
    if (typeof p.r !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(p.r)) return;
    if (typeof p.s !== 'string' || !/^[0-9a-f]{64}$/i.test(p.s)) return;
    if (typeof p.k !== 'string' || !/^0[23][0-9a-f]{64}$/i.test(p.k)) return;
    if (!n(p.sent) || !n(p.lastSeen)) return;
    // No site claim yet: connect makes one on the first reconnect and the relay binds it.
    store.setItem(STORE, JSON.stringify({ v: 1, c: p.c, r: p.r, s: p.s, k: p.k, sent: p.sent, lastSeen: p.lastSeen, pairedAt: now }));
  } catch {
    /* unreadable: pair again */
  }
}

// ---- The relay socket, watched for the phone coming and going ----

/** The one paired phone in this page. */
type Live = { w: PairedWallet; wallet: WalletInterface; store: ScopedStore };
let live: Live | null = null;
/** A pairing restored from this tab's storage after a reload: discovery offers it again. */
let restored: { wallet: WalletInterface; phone: string } | null = null;

function peekRelay(data: unknown) {
  if (!live || typeof data !== 'string' || !data.includes('"relay"')) return;
  try {
    const f = JSON.parse(data) as { t?: string; role?: string; peer?: string };
    if (f.t !== 'relay' || f.role !== 'wallet') return;
    if (f.peer === 'left') setPhoneStatus('asleep');
    if (f.peer === 'joined') setPhoneStatus('awake');
  } catch {
    /* not ours to judge */
  }
}

/** Connect's socket factory: the browser WebSocket, with the relay's plaintext "phone joined/left" frames observed. */
export function watchedSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const s: SocketLike = {
    get readyState() {
      return ws.readyState;
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (d) => ws.send(d),
    close: () => ws.close(),
  };
  ws.onopen = (e) => s.onopen?.(e);
  ws.onerror = (e) => s.onerror?.(e);
  ws.onclose = (e) => s.onclose?.(e);
  ws.onmessage = (e) => {
    peekRelay(e.data);
    s.onmessage?.({ data: e.data });
  };
  return s;
}

// ---- The paired wallet: bWallet's codes in plain words, and the phone's status ----

const ended = new WeakMap<PairedWallet, PairError>();
/** Rejects of the calls waiting on each paired wallet (connect's forget() closes the link but leaves them waiting). */
const inflight = new WeakMap<PairedWallet, Set<(e: unknown) => void>>();

/** The phone ended the pairing: refuse what is waiting, forget it here (and tell it, best effort), show a fresh QR. */
function end(w: PairedWallet, code: 'REPAIR_NEEDED' | 'UNPAIRED'): PairError {
  const prev = ended.get(w);
  if (prev) return prev;
  const err = new PairError(code, pairErrorText(code));
  ended.set(w, err);
  for (const reject of inflight.get(w) ?? []) reject(err);
  inflight.get(w)?.clear();
  void w.forget().catch(() => undefined);
  if (live?.w === w) {
    live = null;
    restored = null;
    phoneEnd = err;
    setPhoneStatus('gone');
  }
  return err;
}

/** Connect's errors as the site's: bWallet's codes become PairError; an ended pairing ends here too. */
export function mapPhoneError(w: PairedWallet, e: unknown): unknown {
  const done = ended.get(w);
  if (done) return done; // the pairing is over: every call says why
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  if (code === 'REPAIR_NEEDED') return end(w, 'REPAIR_NEEDED');
  if (/disconnected this site|pairing was removed/i.test(message)) return end(w, 'UNPAIRED');
  if (code === 'NO_ANSWER' || code === 'NO_ANSWER_MAYBE_SENT') {
    if (live?.w === w) setPhoneStatus('asleep');
    return new PairError(code, message);
  }
  if (typeof code === 'string' && code) {
    if (live?.w === w) setPhoneStatus('awake'); // it answered
    return new PairError(code, pairErrorText(code, message));
  }
  return e;
}

function wrap(w: PairedWallet): WalletInterface {
  const waiting = new Set<(e: unknown) => void>();
  inflight.set(w, waiting);
  const call = async (method: string, args: unknown) => {
    const done = ended.get(w);
    if (done) throw done;
    const sleepy = setTimeout(() => live?.w === w && setPhoneStatus('asleep'), ASLEEP_AFTER_MS);
    let reject: (e: unknown) => void = () => undefined;
    try {
      const fn = (w as unknown as Record<string, (a: unknown) => Promise<unknown>>)[method];
      const r = await new Promise<unknown>((res, rej) => {
        reject = rej;
        waiting.add(rej);
        fn(args ?? {}).then(res, rej);
      });
      if (live?.w === w) setPhoneStatus('awake');
      return r;
    } catch (e) {
      throw mapPhoneError(w, e);
    } finally {
      clearTimeout(sleepy);
      waiting.delete(reject);
    }
  };
  return new Proxy({} as WalletInterface, {
    get: (_t, method) =>
      typeof method === 'string' && method !== 'then' && method !== 'toJSON' ? (args: unknown) => call(method, args) : undefined,
  });
}

/** A new pairing is the phone now. The one it replaces is revoked (no writes) and told to unpair. */
function adopt(w: PairedWallet, store: ScopedStore): Live {
  const prev = live;
  live = { w, wallet: wrap(w), store };
  restored = null;
  phoneEnd = null;
  setPhoneStatus('awake');
  if (prev && prev.w !== w) {
    prev.store.revoke();
    void prev.w.forget().catch(() => undefined);
  }
  return live;
}

/** A paired phone from earlier in this tab (survives reloads, not tab close). Null when this page paired it itself. */
let restoring: Promise<{ wallet: WalletInterface; phone: string } | null> | null = null;
export function resumePhone(): Promise<{ wallet: WalletInterface; phone: string } | null> {
  if (restored) return Promise.resolve(restored);
  if (live) return Promise.resolve(null);
  restoring ??= (async () => {
    upgradeOldPairing();
    if (!tabStorage().getItem(STORE)) return null;
    const store = scopedStore();
    const { restorePairing } = await loadConnect();
    const w = await restorePairing({ storage: store, storageKey: STORE, socket: watchedSocket, callTimeoutMs: CALL_TIMEOUT_MS }).catch(() => null);
    if (!w) return null;
    if (live) {
      // Paired again meanwhile: this one is stale.
      store.revoke();
      w.close();
      return null;
    }
    const l = adopt(w, store);
    restored = { wallet: l.wallet, phone: PHONE_NAME };
    return restored;
  })().finally(() => (restoring = null));
  return restoring;
}

export function disconnectPhone() {
  setPhoneStatus('none');
  const l = live;
  live = null;
  restored = null;
  if (l) void l.w.forget().catch(() => undefined);
  try {
    tabStorage().removeItem(STORE);
    tabStorage().removeItem(OLD_STORE);
  } catch {
    /* ignore */
  }
}

// ---- The chooser's pairing ----

/** The return id of the chooser's pairing in progress (same phone): that pairing takes its own return. */
let livePairRid: string | null = null;
export const isLivePairing = (rid: string | null) => !!rid && rid === livePairRid;

function pairFailText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const m = e instanceof Error ? e.message : String(e);
  if (code === 'RETURNED_IN_ANOTHER_TAB') return 'You connected bWallet in another tab. Switch to it, or reload this page.';
  if (/Could not reach the bWalletX pairing service/i.test(m)) return 'Phone pairing is unreachable right now. Try again shortly.';
  if (/declined/i.test(m)) return 'Cancelled on the phone.';
  return m;
}

/**
 * Show a QR (a link on a phone) and wait for a phone. Calls `onState` as things happen; returns a stop function (call it
 * when the chooser closes: an unfinished pairing is cancelled, and the phone told). A fresh QR is made when one expires.
 * On a phone the link also asks bWalletX to send the player back here (connect `returnTo`); never for a QR another
 * device scans.
 */
export function startPairing(onState: (s: PairState) => void): () => void {
  let stopped = false;
  let ctl: AbortController | null = null;
  let refresh: ReturnType<typeof setTimeout> | undefined;

  const round = async () => {
    if (stopped) return;
    const mine = new AbortController();
    ctl = mine;
    const current = () => !stopped && ctl === mine;
    let coded = false;
    const store = scopedStore();
    const phone = detectPhone();
    let connect: Awaited<ReturnType<typeof loadConnect>>;
    try {
      connect = await loadConnect();
    } catch {
      if (current()) onState({ k: 'error', message: 'Phone pairing is unreachable right now. Try again shortly.' });
      return;
    }
    if (!current()) return;
    clearTimeout(refresh);
    // Refresh a QR nobody scanned a little before it expires (connect would reject it at expiry).
    refresh = setTimeout(() => {
      if (coded || !current()) return;
      mine.abort();
      void round();
    }, QR_LIFETIME_S * 1000 - 5000);
    connect
      .pairBwalletX({
        relay: RELAY,
        storage: store,
        storageKey: STORE,
        socket: watchedSocket,
        callTimeoutMs: CALL_TIMEOUT_MS,
        signal: mine.signal,
        ...(phone && typeof location !== 'undefined' && { returnTo: location.href }),
        readHash: bootReturnHash,
        replaceUrl: clearBootReturn,
        onLink: (link) => {
          let expires = Date.now() + QR_LIFETIME_S * 1000;
          try {
            const u = new URL(link);
            expires = Number(u.searchParams.get('e')) * 1000 || expires;
            if (ctl === mine) livePairRid = u.searchParams.get('rid');
          } catch {
            /* connect's own link: always parses */
          }
          void QRCode.toDataURL(link, { margin: 4, width: 600, errorCorrectionLevel: 'L' })
            .then((qr) => {
              if (current() && !coded) onState({ k: 'qr', qr, link, expires });
            })
            .catch(() => {
              if (current() && !coded) onState({ k: 'error', message: 'Could not draw the pairing code. Try again.' });
            });
        },
        onCode: (code) => {
          coded = true;
          clearTimeout(refresh);
          if (current()) onState({ k: 'code', code, phone: PHONE_NAME });
        },
      })
      .then(
        (w) => {
          if (ctl === mine) livePairRid = null;
          const l = adopt(w, store);
          onState({ k: 'ready', wallet: l.wallet, phone: PHONE_NAME });
        },
        (e: unknown) => {
          if (ctl === mine) livePairRid = null;
          store.revoke();
          if (!current()) return; // stopped, or replaced by a fresh QR
          if (/expired/i.test(e instanceof Error ? e.message : '')) return void round();
          onState({ k: 'error', message: pairFailText(e) });
        },
      );
  };

  onState({ k: 'starting' });
  void round();
  return () => {
    stopped = true;
    clearTimeout(refresh);
    ctl?.abort();
  };
}

/**
 * bWalletX sent the player back (`#bwx=ok&rid=…`, stashed by the boot script): if this browser saved that pairing in the
 * last 10 minutes, finish it here (connect confirms the fragment against the relay's wallet first). Resolves with the
 * phone wallet and the page the pairing started on (origin + path, or null), or null when there is nothing to finish.
 */
export async function finishReturn(): Promise<{ wallet: WalletInterface; phone: string; page: string | null } | null> {
  const hash = bootReturnHash();
  if (!hash) return null;
  clearBootReturn(); // taken now: a second caller finds nothing
  const store = scopedStore();
  try {
    const { resumeReturnedPairing } = await loadConnect();
    const r = await resumeReturnedPairing({
      hash,
      href: typeof location !== 'undefined' ? location.href.split('#')[0] : '',
      replaceUrl: clearBootReturn,
      storage: store,
      storageKey: STORE,
      socket: watchedSocket,
      callTimeoutMs: CALL_TIMEOUT_MS,
      waitMs: RETURN_WAIT_MS,
    });
    if (!r) return null;
    const l = adopt(r.wallet, store);
    return { wallet: l.wallet, phone: PHONE_NAME, page: r.page };
  } catch {
    return null;
  }
}

/** Tests only: drop this module's in-memory pairing as a page reload would (storage is kept). */
export function _forgetPhoneForReload() {
  const l = live;
  live = null;
  restored = null;
  if (l) {
    l.store.revoke();
    l.w.close();
  }
}
