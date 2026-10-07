'use client';

import { useEffect, useState } from 'react';
import { discoverWallets, type WalletEntry } from '@/lib/discovery';
import { startPairing, type PairState } from '@/lib/pair/site';

const KIND: Record<WalletEntry['kind'], string> = {
  extension: 'browser ext.',
  'in-app': 'this app',
  web: 'web wallet',
  desktop: 'this computer',
  phone: 'paired phone',
};

/** The wallets this site is built around: always listed, with an install link when missing. */
const FEATURED: { key: string; name: string; icon: string; get: string; match: (w: WalletEntry) => boolean }[] = [
  {
    key: 'bwalletx',
    name: 'bWalletX',
    icon: '/wallets/bwalletx.png',
    // Points at the Chrome Web Store once bWalletX is listed (one link to keep current).
    get: 'https://bwalletx.com/extension',
    match: (w) => w.id === 'com.bwalletx.extension',
  },
  {
    key: 'yours',
    name: 'Yours Wallet',
    icon: '/wallets/yours.png',
    get: 'https://chromewebstore.google.com/detail/yours-wallet/mlbnicldlpdimbjdcncnklfempedeipj',
    match: (w) => w.id === 'window.CWI' && /^yours/i.test(w.name),
  },
];

function WalletRow({
  icon,
  name,
  sub,
  onClick,
  href,
  action,
}: {
  icon: string | null;
  name: string;
  sub: string;
  onClick?: () => void;
  href?: string;
  action?: string;
}) {
  const inner = (
    <>
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="h-9 w-9 rounded-none" />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-none" style={{ background: 'var(--canvas)', color: 'var(--hot)', fontWeight: 700, fontSize: 15 }}>
          {name.slice(0, 1)}
        </span>
      )}
      <span className="flex-1">
        <span className="block" style={{ color: 'var(--hot)', fontWeight: 600, fontSize: 15 }}>
          {name}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{sub}</span>
      </span>
      {action ? (
        <span className="rounded-none px-3 py-1.5" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>
          {action}
        </span>
      ) : (
        <span style={{ color: 'var(--accent)', fontSize: 20 }}>›</span>
      )}
    </>
  );
  const cls = 'flex w-full items-center gap-3 rounded-none px-3 py-3 text-left transition-colors';
  const style = { background: 'var(--input)', border: '1px solid var(--border-dim)' };
  const hover = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.borderColor = 'var(--accent)'),
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.borderColor = 'var(--border-dim)'),
  };
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} style={style} {...hover}>
      {inner}
    </a>
  ) : (
    <button onClick={onClick} className={cls} style={style} {...hover}>
      {inner}
    </button>
  );
}

/**
 * "Connect a wallet": every wallet found, plus the phone (docs/wallet-connect.md §2).
 * The site never picks for the player.
 */
export function WalletChooser({ note, onPick, onClose }: { note?: string | null; onPick: (w: WalletEntry) => void; onClose: () => void }) {
  const [wallets, setWallets] = useState<WalletEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    discoverWallets()
      .then((w) => alive && setWallets(w))
      .catch(() => alive && setWallets([]));
    return () => {
      alive = false;
    };
  }, []);
  const isPhone = typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);

  // Phone QR, live as soon as the chooser opens (spec §2.1). The channel closes with the chooser.
  const [pair, setPair] = useState<PairState>({ k: 'starting' });
  useEffect(() => {
    if (isPhone) return;
    return startPairing((st) => {
      setPair(st);
      if (st.k === 'ready')
        onPick({ id: 'phone', name: `${st.phone} on your phone`, icon: null, kind: 'phone', wallet: st.wallet });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone]);

  // bWalletX look (the wallet's own approval pop-ups), not the site's retro panels: this is a wallet
  // moment, so it should feel like the wallet.
  const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', fontFamily: font }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Connect a wallet"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[400px] p-5 pt-7"
        style={{ background: 'var(--panel)', border: '2px solid var(--hot)', boxShadow: '8px 8px 0 var(--accent-fill)' }}
      >
        <div className="dr-hazard absolute inset-x-0 top-0 !h-2" aria-hidden />
        <div className="mb-4 flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-none"
            style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <path d="M16 12h2M3 9l3-3h12" />
            </svg>
          </span>
          <div className="flex-1">
            <div className="dr-display" style={{ color: 'var(--hot)', fontSize: 24 }}>Connect a wallet</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Use bWalletX, Yours Wallet, or bWallet on your phone.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-none p-1.5" style={{ color: 'var(--muted)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {note && (
          <p className="mb-3 rounded-none px-3 py-2" style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)', fontSize: 13 }}>
            {note}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {wallets === null && (
            <p style={{ color: 'var(--muted)', fontSize: 14 }} className="px-1 py-3">
              Looking for wallets…
            </p>
          )}

          {/* The two browser wallets, always offered: connect if installed, else a link to get it. */}
          {wallets !== null &&
            FEATURED.map((f) => {
              const w = wallets.find(f.match);
              return w ? (
                <WalletRow key={f.key} icon={f.icon} name={f.name} sub="browser extension" onClick={() => onPick(w)} />
              ) : (
                !isPhone && (
                  <WalletRow
                    key={f.key}
                    icon={f.icon}
                    name={f.name}
                    sub="Chrome extension · not installed"
                    href={f.get}
                    action="Get it"
                  />
                )
              );
            })}

          {/* Anything else found (BSV Desktop when it's running, other browser wallets). */}
          {wallets
            ?.filter((w) => !FEATURED.some((f) => f.match(w)))
            .map((w) => (
              <WalletRow key={w.id} icon={w.icon} name={w.name} sub={KIND[w.kind]} onClick={() => onPick(w)} />
            ))}

          {/* bWallet on the phone: QR shown straight away, an equal option (spec §2). */}
          {!isPhone && (
            <div
              className="flex items-center gap-4 rounded-none px-3 py-3"
              style={{ background: 'var(--input)', border: '1px solid var(--border-dim)' }}
            >
              <span
                className="grid h-[112px] w-[112px] shrink-0 place-items-center overflow-hidden rounded-none"
                style={{ background: pair.k === 'qr' ? '#fff' : 'var(--canvas)', border: '1px solid var(--border-dim)' }}
              >
                {pair.k === 'qr' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pair.qr} alt="Pairing QR code" className="h-full w-full" />
                ) : pair.k === 'code' ? (
                  <span style={{ color: 'var(--accent)', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 26, letterSpacing: 2 }}>
                    {pair.code}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{pair.k === 'error' ? 'Unavailable' : 'Loading…'}</span>
                )}
              </span>
              <span className="flex-1">
                <span className="block" style={{ color: 'var(--hot)', fontWeight: 600, fontSize: 15 }}>
                  bWallet on your phone
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.4 }}>
                  {pair.k === 'code'
                    ? `Check bWallet shows ${pair.code}, then tap Connect on your phone.`
                    : pair.k === 'error'
                      ? pair.message
                      : 'Open bWallet › menu › Scan to connect, and point it at this code.'}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
