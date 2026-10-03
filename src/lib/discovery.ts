/**
 * Find every BRC-100 wallet on offer, per docs/wallet-connect.md §3. The site never picks one:
 * the chooser lists them all and remembers what the player chose.
 */
import { HTTPWalletJSON, WalletClient, type WalletInterface } from '@bsv/sdk';
import { resumePhone } from './pair/site';

export type WalletKind = 'extension' | 'in-app' | 'web' | 'desktop' | 'phone';
export type WalletEntry = { id: string; name: string; icon: string | null; kind: WalletKind; wallet: WalletInterface };

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
    setTimeout(() => {
      window.removeEventListener('brc100:announceWallet', on);
      done([...found.values()]);
    }, ms);
  });
}

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

export async function discoverWallets(): Promise<WalletEntry[]> {
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
  if (!isPhone()) {
    try {
      const desk = new HTTPWalletJSON(window.location.host, 'http://localhost:3321');
      await withTimeout(desk.getVersion({}), 1500);
      list.push({ id: 'metanet.desktop', name: 'BSV Desktop', icon: '/wallets/bsv-desktop.png', kind: 'desktop', wallet: desk });
    } catch {
      /* not running */
    }
  }
  return list;
}
