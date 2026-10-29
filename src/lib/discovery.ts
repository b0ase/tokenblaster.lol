/**
 * Find every BRC-100 wallet on offer, per docs/wallet-connect.md §3. The site never picks one:
 * the chooser lists them all and remembers what the player chose.
 */
import { HTTPWalletJSON, WalletClient, type WalletInterface } from '@bsv/sdk';
import { resumePhone } from './pair/site';
import { CLI_URL, cliFetch } from './cliWallet';

export type WalletKind = 'extension' | 'in-app' | 'web' | 'desktop' | 'phone';
/** `fresh`: just paired by QR (a new session, maybe another phone): its key is asked for, never reused. */
export type WalletEntry = { id: string; name: string; icon: string | null; kind: WalletKind; wallet: WalletInterface; fresh?: boolean };

type Announce = { info: { uuid: string; name: string; icon?: string; rdns: string; kind?: WalletKind }; wallet: WalletInterface };

const REMEMBER = 'tokenblaster.wallet';
const isPhone = () => typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);

export const rememberedWallet = () => {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
};
export const rememberWallet = (id: string | null) => {
  try {
    if (id) localStorage.setItem(REMEMBER, id);
    else localStorage.removeItem(REMEMBER);
  } catch {
    /* storage blocked: the chooser just shows again next time */
  }
};

/** Wallets that announce themselves (§3.1), collected for `ms` after asking. */
function announced(ms: number): Promise<Announce[]> {
  return new Promise((done) => {
    const found = new Map<string, Announce>();
    const on = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      if (d?.info?.rdns && d.wallet) found.set(d.info.rdns, d);
    };
    window.addEventListener('brc100:announceWallet', on);
    window.dispatchEvent(new Event('brc100:requestWallet'));
    // A just-woken extension can answer late: ask again, and wait longer if nothing has answered yet
    // (owner, 25 Oct: bWalletX was installed and open but the chooser offered "Get it").
    const again = setTimeout(() => window.dispatchEvent(new Event('brc100:requestWallet')), ms);
    const finish = () => {
      clearTimeout(again);
      window.removeEventListener('brc100:announceWallet', on);
      done([...found.values()]);
    };
    setTimeout(() => (found.size ? finish() : setTimeout(finish, ms * 3)), ms);
  });
}

/**
 * Framed (bChatX's floating player, ?embed=1): bWalletX injects into https iframes only after one round trip
 * to its background (bWalletX #407), so neither window.CWI nor an announce is there at load. Before calling it
 * "no wallet", wait up to `ms` for a late announce (asking again every 400 ms) or a window.CWI to appear.
 * Resolves with whatever answered (empty if nothing did). Timing only: what is offered is unchanged.
 */
export function waitForLateWallet(ms = 2000, poll = 100): Promise<Announce[]> {
  return new Promise((done) => {
    const found = new Map<string, Announce>();
    const hasCwi = () => Boolean((window as { CWI?: unknown }).CWI);
    let ended = false;
    const on = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      if (d?.info?.rdns && d.wallet) {
        found.set(d.info.rdns, d);
        // a short grace so a CWI injected alongside the announce is seen by the caller too
        setTimeout(finish, poll);
      }
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      clearInterval(tick);
      clearInterval(ask);
      clearTimeout(cap);
      window.removeEventListener('brc100:announceWallet', on);
      done([...found.values()]);
    };
    window.addEventListener('brc100:announceWallet', on);
    const tick = setInterval(() => hasCwi() && finish(), poll);
    const ask = setInterval(() => window.dispatchEvent(new Event('brc100:requestWallet')), 400);
    const cap = setTimeout(finish, ms);
    if (hasCwi()) finish();
  });
}

const CLI_SEEN = 'tb.cliWalletSeen';
const localWalletSeen = () => {
  try {
    return Boolean(localStorage.getItem(CLI_SEEN));
  } catch {
    return false;
  }
};
const markLocalWalletSeen = () => {
  try {
    localStorage.setItem(CLI_SEEN, '1');
  } catch {
    /* storage blocked: probe again next time only when no browser wallet appears */
  }
};
/** Probe the local wallet port (bwalletx-cli / BSV Desktop on localhost:3321)? Pure, tested in discovery.test.ts. */
export function shouldProbeLocal(a: { seen: boolean; query: string; injected: boolean }): boolean {
  if (a.seen) return true;
  if (new URLSearchParams(a.query).get('wallet') === 'cli') return true;
  return !a.injected;
}

let localRefused = false;
const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

/** "yours-wallet-5.0.2" → "Yours Wallet". */
const nameFromVersion = (v: string) => {
  const base = v.replace(/[-_ ]?v?\d[\d.]*.*$/, '');
  if (!base) return 'Browser wallet';
  return base
    .split(/[-_ ]/)
    .map((w) => (w.toLowerCase() === 'bwalletx' ? 'bWalletX' : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
};

/** Opened inside a host app's frame (bWallet's Apps tab): the host is the wallet, reached over XDM. */
export const inFrame = () => typeof window !== 'undefined' && window.self !== window.top;

/** What the last discovery saw, for the chooser's diagnostic line (owner, 25 Oct: "won't connect", no reason shown). */
export type DiscoveryDiag = { at: number; ms: number; announced: string[]; cwi: boolean; found: string[] };
let lastDiag: DiscoveryDiag | null = null;
export const lastDiscovery = () => lastDiag;
export function diagLine(d: DiscoveryDiag | null): string {
  if (!d) return 'Discovery: not run yet.';
  const ann = d.announced.length ? d.announced.join(', ') : 'none';
  return `Discovery ${d.ms} ms: announced ${ann}; window.CWI ${d.cwi ? 'present' : 'absent'}; offered ${d.found.length ? d.found.join(', ') : 'none'}.`;
}

/**
 * One discovery at a time, and its answer reused for a moment (29 Oct audit: the chooser and the site wallet both ran
 * discovery on one press, so localhost:3321 was probed twice and logged two red ERR_CONNECTION_REFUSED lines).
 */
let running: { at: number; p: Promise<WalletEntry[]> } | null = null;
export function discoverWallets(): Promise<WalletEntry[]> {
  const now = Date.now();
  if (running && now - running.at < 3000) return running.p;
  const p = discoverOnce();
  running = { at: now, p };
  p.catch(() => {
    if (running?.p === p) running = null;
  });
  return p;
}

async function discoverOnce(): Promise<WalletEntry[]> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const list = await discoverAll();
  const cwi = typeof window !== 'undefined' && Boolean((window as { CWI?: unknown }).CWI);
  lastDiag = {
    at: Date.now(),
    ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
    announced: list.filter((w) => w.id !== 'window.CWI' && w.kind !== 'phone' && w.kind !== 'desktop').map((w) => `${w.name} (${w.id})`),
    cwi,
    found: list.map((w) => w.name),
  };
  return list;
}

async function discoverAll(): Promise<WalletEntry[]> {
  // bWallet's Apps tab frames us and injects nothing; the wallet answers postMessage (BRC-100 XDM)
  // from its own frame only. That is the one wallet on offer there (docs/wallet-connect.md §2.3).
  if (inFrame()) {
    const host = new WalletClient('XDM', window.location.host);
    try {
      await withTimeout(host.getVersion({}), 2500);
      return [{ id: 'space.bwallet.mobile', name: 'bWallet', icon: null, kind: 'in-app', wallet: host }];
    } catch {
      /* framed by something that is not a wallet: fall through to normal discovery */
    }
  }
  const list: WalletEntry[] = (await announced(400)).map((a) => ({
    id: a.info.rdns,
    name: a.info.name,
    icon: a.info.icon ?? null,
    kind: a.info.kind ?? 'extension',
    wallet: a.wallet,
  }));
  if (inFrame() && !list.length && !(window as { CWI?: unknown }).CWI)
    for (const a of await waitForLateWallet())
      if (!list.some((w) => w.id === a.info.rdns)) list.push({ id: a.info.rdns, name: a.info.name, icon: a.info.icon ?? null, kind: a.info.kind ?? 'extension', wallet: a.wallet });

  // A phone paired by QR earlier in this tab (§4.6): offer it again, so a reload reconnects to it.
  const phone = resumePhone();
  if (phone) list.push({ id: 'phone', name: `${phone.phone} on your phone`, icon: null, kind: 'phone', wallet: phone.wallet });

  // §3.3: a window.CWI nobody announced (Yours today, older wallets).
  const cwi = (window as { CWI?: WalletInterface }).CWI;
  if (cwi && !list.some((w) => w.wallet === cwi)) {
    let name = 'Browser wallet';
    try {
      name = nameFromVersion((await withTimeout(cwi.getVersion({}), 1500)).version);
    } catch {
      /* locked or slow: keep the generic name */
    }
    // Yours doesn't announce yet; show its own sprout so players recognise it.
    const icon = /^yours/i.test(name) ? '/wallets/yours.png' : null;
    list.push({ id: 'window.CWI', name, icon, kind: 'extension', wallet: cwi });
  }

  // BSV Desktop (formerly MetaNet Desktop) on this computer. Only when the chooser is open, never on a phone.
  // Probing localhost:3321 when nothing listens prints a red ERR_CONNECTION_REFUSED in every console (owner, 26 Oct
  // 2026), so only probe when a local wallet was seen before, ?wallet=cli asks for it, or no browser wallet showed up
  // (announce/CWI, after the ~400 ms wait above). getVersion stays the probe (bwalletx-cli keeps it open).
  const injected = list.some((w) => w.kind === 'extension' || w.kind === 'in-app') || Boolean(cwi);
  // A refused probe is not repeated in this page: once is enough to know nothing listens.
  if ((!localRefused || /[?&]wallet=cli/.test(window.location.search)) && !isPhone() && shouldProbeLocal({ seen: localWalletSeen(), query: window.location.search, injected })) {
    try {
      const desk = new HTTPWalletJSON(window.location.host, CLI_URL, cliFetch());
      await withTimeout(desk.getVersion({}), 1500);
      markLocalWalletSeen();
      list.push({ id: 'metanet.desktop', name: 'BSV Desktop', icon: '/wallets/bsv-desktop.png', kind: 'desktop', wallet: desk });
    } catch {
      localRefused = true; // not running
    }
  }
  return list;
}
