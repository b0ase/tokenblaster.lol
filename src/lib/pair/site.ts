/**
 * Site side of phone pairing (docs/wallet-connect.md §4): show a QR, let bWallet on a phone join the
 * relay channel, compare the 4-digit code, then hand back a WalletInterface whose calls travel to
 * the phone, end-to-end encrypted. To the rest of the site it is just another wallet in the chooser.
 */
import { fetchPairProofs } from './proof-client';
import { parseReturnHash, savePending, takePending, withoutHash, type PendingPair } from './returnStore';
import { PrivateKey, type WalletInterface } from '@bsv/sdk';
import QRCode from 'qrcode';
import {
  DEFAULT_RELAY,
  PAIR_VERSION,
  QR_LIFETIME_S,
  Sealer,
  deriveSession,
  isSealed,
  browserHint,
  isValidReturnUrl,
  newChannel,
  newRequestId,
  pairUrl,
  relaySocketUrl,
  type HelloFrame,
  type PairMessage,
  type RelayFrame,
} from './protocol';

export const RELAY = process.env.NEXT_PUBLIC_PAIR_RELAY || DEFAULT_RELAY;
const STORE = 'tokenblaster.pair';

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
 *   REPAIR_NEEDED          the pairing is over on the phone (a {t:'close', reason:'REPAIR_NEEDED'} follows). Fresh QR, no retry.
 *   REJECTED               any other refusal (reserved protocol, blocked). Show the wallet's own message.
 *   ERROR                  a wallet failure (locked, network). Retry later; tell the player to open/unlock bWallet.
 *   LOCKED                 paired CLI/MCP agents only.
 * UNPAIRED is ours: {t:'close', reason:'user unpaired'}.
 */
export type PairCode = 'ERR_PERMISSION_DENIED' | 'REPAIR_NEEDED' | 'REJECTED' | 'ERROR' | 'LOCKED' | 'UNPAIRED';
export const DECLINED_TEXT = 'You declined in bWallet.';
export const REPAIR_TEXT = 'This pairing has ended. Scan the QR code on the site again to reconnect.';

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
/** "Open in bWallet" on a phone: the universal link with the same query as the QR. */
export const openInBwalletUrl = (qrLink: string) => `https://www.bwallet.space/pair?${new URL(qrLink).searchParams}`;
/** Where a player with no wallet gets one. */
export const GET_BWALLETX_URL = 'https://bwalletx.com/get';

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

/** joined and ready this close together = one resend (pre-#122 bWallet sends no ready, only the relay's joined). */
export const RESEND_DEDUPE_MS = 1000;

/** How long a request may wait with no word from the phone before the site says it is asleep. */
export const ASLEEP_AFTER_MS = 8000;

type Saved = { c: string; r: string; s: string; k: string; phone: string; sent: number; lastSeen: number };

/** A live, paired channel: requests out, responses in. */
class Channel {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; action: string; params: unknown }>();
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private outbox: string[] = [];
  private closed = false;
  private joinTimer: ReturnType<typeof setTimeout> | undefined;
  private lastResend = 0;

  constructor(
    private saved: Saved,
    private sealer: Sealer,
    private onGone: (why: string) => void,
  ) {}

  open(ws?: WebSocket) {
    this.ws = ws ?? new WebSocket(relaySocketUrl(this.saved.r, this.saved.c, 'site'));
    this.ws.onopen = () => this.flush();
    if (ws && ws.readyState === WebSocket.OPEN) this.flush();
    this.ws.onmessage = (ev) => void this.receive(String(ev.data));
    this.ws.onclose = () => {
      if (this.closed) return;
      // Reloads and network blips: rejoin the same channel (the relay keeps it for 24 h).
      setTimeout(() => !this.closed && this.open(), 2000);
    };
  }

  /** iOS suspends background tabs and drops their sockets: reconnect when the page is shown again. */
  wake() {
    if (this.closed) return;
    const st = this.ws?.readyState;
    if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
    this.open();
  }

  private async receive(raw: string) {
    const f = JSON.parse(raw) as RelayFrame | unknown;
    if ((f as RelayFrame).t === 'relay') {
      const rf = f as RelayFrame;
      if (rf.role === 'wallet' && rf.peer === 'left') setPhoneStatus('asleep');
      // Back again. bWallet #122+ follows with {t:'ready'}; older builds (5.2.41) never do, so resend on joined too,
      // after a short wait so a ready that follows makes it one resend.
      if (rf.role === 'wallet' && rf.peer === 'joined') {
        setPhoneStatus('awake');
        clearTimeout(this.joinTimer);
        this.joinTimer = setTimeout(() => void this.resend(), RESEND_DEDUPE_MS);
      }
      return;
    }
    if (!isSealed(f)) return;
    const msg = await this.sealer.open(f);
    if (!msg) return;
    clearTimeout(this.sleepTimer);
    setPhoneStatus('awake');
    this.persist();
    if (msg.t === 'res') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const code = msg.error.code || 'ERROR';
        p.reject(new PairError(code, pairErrorText(code, msg.error.message)));
        // REPAIR_NEEDED: the pairing is over. The close frame that follows ends the channel; end it now in case it is lost.
        if (code === 'REPAIR_NEEDED') this.end('REPAIR_NEEDED');
      } else p.resolve(msg.result);
    } else if (msg.t === 'ready') {
      clearTimeout(this.joinTimer);
      // Sent at first pairing and on every rejoin: ask again for anything unanswered, with the SAME ids (bWallet
      // replays a stored answer for a repeated id, never runs it twice).
      void this.resend();
    } else if (msg.t === 'close') {
      this.end(msg.reason === 'REPAIR_NEEDED' ? 'REPAIR_NEEDED' : 'UNPAIRED');
    }
  }

  /** The phone ended the pairing: reject what is waiting with its code, forget the channel, show a fresh QR. */
  private end(code: 'REPAIR_NEEDED' | 'UNPAIRED') {
    if (this.closed) return;
    const err = new PairError(code, pairErrorText(code));
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.close(false);
    phoneEnd = err;
    if (current === this) {
      current = null;
      resumed = null;
    }
    setPhoneStatus('gone');
    this.onGone(err.message);
  }

  private flush() {
    while (this.ws?.readyState === WebSocket.OPEN && this.outbox.length) this.ws.send(this.outbox.shift()!);
  }

  private persist() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ ...this.saved, ...this.sealer.counters }));
    } catch {
      /* the session just won't survive a reload */
    }
  }

  private async send(id: string, action: string, params: unknown) {
    const frame = await this.sealer.seal({ t: 'req', id, action, params } satisfies PairMessage);
    this.persist();
    this.outbox.push(JSON.stringify(frame));
    this.flush();
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => this.pending.size && setPhoneStatus('asleep'), ASLEEP_AFTER_MS);
  }

  private async resend() {
    // One resend per rejoin: joined and ready within RESEND_DEDUPE_MS of each other count once.
    clearTimeout(this.joinTimer);
    if (Date.now() - this.lastResend < RESEND_DEDUPE_MS) return;
    this.lastResend = Date.now();
    for (const [id, p] of this.pending) await this.send(id, p.action, p.params);
  }

  async request(action: string, params: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    const done = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, action, params }));
    await this.send(id, action, params);
    return done;
  }

  close(notify = true) {
    this.closed = true;
    clearTimeout(this.sleepTimer);
    clearTimeout(this.joinTimer);
    const finish = () => this.ws?.close();
    if (notify && this.ws?.readyState === WebSocket.OPEN)
      void this.sealer.seal({ t: 'close', reason: 'site disconnected' }).then((f) => {
        this.ws?.send(JSON.stringify(f));
        finish();
      });
    else finish();
    for (const p of this.pending.values()) p.reject(new Error('Disconnected'));
    this.pending.clear();
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
  }

  /** BRC-100 WalletInterface: every method becomes a request to the phone. */
  wallet(): WalletInterface {
    return new Proxy({} as WalletInterface, {
      get: (_t, method) =>
        typeof method === 'string' && method !== 'then'
          ? (args: unknown) => this.request(method, args ?? {})
          : undefined,
    });
  }
}

let current: Channel | null = null;

/** A paired phone from earlier in this tab (survives reloads, not tab close). */
let resumed: { wallet: WalletInterface; phone: string } | null = null;

export function resumePhone(onGone: (why: string) => void = () => {}): { wallet: WalletInterface; phone: string } | null {
  if (resumed) return resumed;
  if (current) return null;
  let saved: Saved | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as Saved | null;
  } catch {
    return null;
  }
  if (!saved) return null;
  const s = saved;
  const ch = new Promise<Channel>((resolve) => {
    void deriveSession(PrivateKey.fromHex(s.s), s.k, s.c).then(({ key }) => {
      const sealer = new Sealer(key, 'site');
      sealer.restore({ sent: s.sent, lastSeen: s.lastSeen });
      const c = new Channel(s, sealer, onGone);
      c.open();
      current = c;
      setPhoneStatus('awake');
      resolve(c);
    });
  });
  const wallet = new Proxy({} as WalletInterface, {
    get: (_t, method) =>
      typeof method === 'string' && method !== 'then'
        ? async (args: unknown) => (await ch).request(method, args ?? {})
        : undefined,
  });
  resumed = { wallet, phone: s.phone };
  return resumed;
}

export function disconnectPhone() {
  setPhoneStatus('none');
  current?.close();
  current = null;
  resumed = null;
}

/** Our side of one pairing attempt on a relay channel: the phone's hello, then its encrypted "ready". */
function pairSession(S: PrivateKey, c: string, r: string, onState: (s: PairState) => void, onError: () => void) {
  let sealer: Sealer | null = null;
  let phone = 'bWallet';
  let phoneKey = '';
  let done = false;
  const handle = (sock: WebSocket) => async (ev: { data: unknown }) => {
    const f = JSON.parse(String(ev.data)) as RelayFrame | HelloFrame | unknown;
    // 1. The phone's hello (plaintext): derive the key, show the code.
    if ((f as HelloFrame).t === 'hello' && !sealer) {
      const h = f as HelloFrame;
      phone = h.info?.name || 'bWallet';
      phoneKey = h.k;
      const { key, code } = await deriveSession(S, h.k, c);
      sealer = new Sealer(key, 'site');
      onState({ k: 'code', code, phone });
      return;
    }
    // 2. "ready" (encrypted): the user tapped Connect on the phone.
    if (!sealer || !isSealed(f) || done) return;
    const msg = await sealer.open(f);
    if (msg?.t === 'ready') {
      done = true;
      const saved: Saved = { c, r, s: S.toHex(), k: phoneKey, phone, ...sealer.counters };
      try {
        sessionStorage.setItem(STORE, JSON.stringify(saved));
      } catch {
        /* the session just won't survive a reload */
      }
      const ch = new Channel(saved, sealer, () => {});
      phoneEnd = null;
      ch.open(sock);
      current?.close();
      current = ch;
      resumed = null;
      setPhoneStatus('awake');
      onState({ k: 'ready', wallet: ch.wallet(), phone });
    } else if (msg?.t === 'res' && msg.error) onState({ k: 'error', message: pairErrorText(msg.error.code, msg.error.message) });
    else if (msg?.t === 'close') onState({ k: 'error', message: 'Cancelled on the phone.' });
  };
  const attach = (sock: WebSocket) => {
    sock.onmessage = handle(sock);
    sock.onerror = () => !sealer && onError();
  };
  return { attach, started: () => !!sealer, done: () => done };
}

/** The pairing link on screen now (v2: with its return), saved for the return tab when the player leaves. */
let pendingNow: PendingPair | null = null;
/** Save the pairing in progress for bWallet's return (call before navigating to bWallet). */
export function rememberPairing() {
  if (pendingNow) savePending({ ...pendingNow, at: Date.now() });
}

/** v2 link fields for this page: `ret` (this page without its hash, when the wallet would accept it), `rid`, `b`. */
export function returnFields(href: string, o: string, ua: string, isBrave = false) {
  const ret = withoutHash(href);
  if (!isValidReturnUrl(ret, o)) return {};
  return { ret, rid: newRequestId(), b: browserHint(ua, isBrave) };
}

const isBraveBrowser = () => typeof navigator !== 'undefined' && !!(navigator as { brave?: unknown }).brave;

/**
 * Show a QR and wait for a phone. Calls `onState` as things happen; returns a stop function
 * (call it when the chooser closes). A fresh QR is made when one expires.
 */
export function startPairing(onState: (s: PairState) => void): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let handedOver = false;
  let reopen: (() => void) | null = null;

  const round = async () => {
    if (stopped) return;
    const S = PrivateKey.fromRandom();
    const c = newChannel();
    const e = Math.floor(Date.now() / 1000) + QR_LIFETIME_S;
    const k = S.toPublicKey().toString();
    const o = location.origin;
    const v2 = returnFields(location.href ?? '', o, typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '', isBraveBrowser());
    const { s, s2 } = await fetchPairProofs({ c, k, o, e, ...v2 });
    if (stopped) return;
    // ret/rid/b only travel with their proof: without s2 the wallet would not return anyway.
    const link = pairUrl({ v: PAIR_VERSION, r: RELAY, c, k, o, e, s, ...(s2 && v2.ret ? { ...v2, s2 } : {}) });
    pendingNow = s2 && v2.ret && v2.rid ? { c, r: RELAY, s: S.toHex(), e, rid: v2.rid, ret: v2.ret, at: Date.now() } : null;
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 320 });
    if (stopped) return;
    const session = pairSession(S, c, RELAY, (st) => {
      if (st.k === 'code') clearTimeout(refresh);
      if (st.k === 'ready') {
        handedOver = true;
        pendingNow = null;
      }
      onState(st);
    }, () => onState({ k: 'error', message: 'Phone pairing is unreachable right now. Try again shortly.' }));
    const connect = (withExpiry: boolean) => {
      const sock = new WebSocket(relaySocketUrl(RELAY, c, 'site', withExpiry ? e : undefined));
      ws = sock;
      session.attach(sock);
      return sock;
    };
    const sock = connect(true);
    sock.onopen = () => onState({ k: 'qr', qr, link, expires: e * 1000 });
    // iOS dropped the socket while the player was in bWallet: rejoin the same channel.
    reopen = () => {
      if (stopped || handedOver || session.done()) return;
      const st = ws?.readyState;
      if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
      connect(false);
    };
    refresh = setTimeout(() => {
      if (session.started() || stopped) return;
      ws?.close();
      void round();
    }, QR_LIFETIME_S * 1000 - 5000);
  };

  const onVis = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') rememberPairing();
    else reopen?.();
  };
  const onHide = () => rememberPairing();
  const onShow = () => reopen?.();
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
  }

  onState({ k: 'starting' });
  void round();
  return () => {
    stopped = true;
    clearTimeout(refresh);
    pendingNow = null;
    if (!handedOver) ws?.close();
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    }
  };
}

/**
 * bWallet sent the player back to `<ret>#bwx=ok&rid=<rid>`: if that rid is one we saved (in the last 10 minutes),
 * rejoin its relay channel and finish the connect there. The hash is cleaned out of the URL either way.
 * Resolves with the phone wallet when the phone's "ready" arrives, or null (unknown rid, expired, cancelled).
 */
export function resumeReturnedPairing(
  loc: { hash: string; href: string } = location,
  replace: (url: string) => void = (u) => history.replaceState(history.state, '', u),
): Promise<{ wallet: WalletInterface; phone: string } | null> {
  const rid = parseReturnHash(loc.hash);
  if (!rid) return Promise.resolve(null);
  try {
    replace(withoutHash(loc.href));
  } catch {
    /* leave the hash: harmless */
  }
  const p = takePending(rid);
  if (!p) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { wallet: WalletInterface; phone: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      resolve(v);
    };
    const session = pairSession(PrivateKey.fromHex(p.s), p.c, p.r, (st) => {
      if (st.k === 'ready') finish({ wallet: st.wallet, phone: st.phone });
      else if (st.k === 'error') finish(null);
    }, () => undefined);
    const connect = () => {
      const sock = new WebSocket(relaySocketUrl(p.r, p.c, 'site'));
      session.attach(sock);
      sock.onclose = () => !settled && setTimeout(() => !settled && connect(), 2000);
    };
    connect();
    // The relay keeps the channel for a while; give the phone two minutes to (re)send its hello and ready.
    const giveUp = setTimeout(() => finish(null), 120_000);
  });
}

/** iOS tab suspension: reconnect the paired phone's relay socket when the page comes back. */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const wake = () => document.visibilityState !== 'hidden' && current?.wake();
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
}
