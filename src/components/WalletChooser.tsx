'use client';

import { useEffect, useState } from 'react';
import { discoverWallets, type WalletEntry } from '@/lib/discovery';

const KIND: Record<WalletEntry['kind'], string> = {
  extension: 'browser ext.',
  'in-app': 'this app',
  web: 'web wallet',
  desktop: 'this computer',
};

/**
 * "Connect a wallet": every wallet found, plus the phone (docs/wallet-connect.md §2).
 * The site never picks for the player.
 */
export function WalletChooser({ note, onPick, onClose }: { note?: string | null; onPick: (w: WalletEntry) => void; onClose: () => void }) {
  const [wallets, setWallets] = useState<WalletEntry[] | null>(null);
  const [scan, setScan] = useState(0);

  useEffect(() => {
    let alive = true;
    discoverWallets()
      .then((w) => alive && setWallets(w))
      .catch(() => alive && setWallets([]));
    return () => {
      alive = false;
    };
  }, [scan]);
  const rescan = () => {
    setWallets(null);
    setScan((n) => n + 1);
  };
  const isPhone = typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);
  const noDesktop = wallets !== null && !isPhone && !wallets.some((w) => w.kind === 'desktop');

  // bWalletX look (the wallet's own approval pop-ups), not the site's retro panels: this is a wallet
  // moment, so it should feel like the wallet.
  const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const yours = wallets?.find((w) => w.id === 'window.CWI');

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
        className="w-full max-w-[400px] rounded-2xl p-5"
        style={{ background: '#101114', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
      >
        <div className="mb-4 flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{ background: 'rgba(245,184,0,0.12)', color: '#F5B800' }}
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <path d="M16 12h2M3 9l3-3h12" />
            </svg>
          </span>
          <div className="flex-1">
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>Connect a wallet</div>
            <div style={{ color: '#98A2B3', fontSize: 13, marginTop: 2 }}>Choose which wallet TokenBlaster talks to.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5" style={{ color: '#98A2B3' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {note && (
          <p className="mb-3 rounded-xl px-3 py-2" style={{ background: 'rgba(240,68,56,0.1)', color: '#FDA29B', fontSize: 13 }}>
            {note}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {wallets === null && (
            <p style={{ color: '#98A2B3', fontSize: 14 }} className="px-1 py-3">
              Looking for wallets…
            </p>
          )}
          {wallets?.length === 0 && (
            <p style={{ color: '#98A2B3', fontSize: 14 }} className="px-1 py-2">
              No wallet found in this browser.
            </p>
          )}
          {wallets?.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors"
              style={{ background: '#17191E', border: '1px solid rgba(255,255,255,0.05)' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(245,184,0,0.45)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)')}
            >
              {w.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" className="h-9 w-9 rounded-lg" />
              ) : (
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{ background: '#2b2f36', color: '#fff', fontWeight: 700, fontSize: 15 }}
                >
                  {w.name.slice(0, 1)}
                </span>
              )}
              <span className="flex-1">
                <span className="block" style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>
                  {w.name}
                </span>
                <span style={{ color: '#98A2B3', fontSize: 12 }}>{KIND[w.kind]}</span>
              </span>
              <span style={{ color: '#F5B800', fontSize: 20 }}>›</span>
            </button>
          ))}

          {noDesktop && (
            <div
              className="flex items-center gap-3 rounded-xl px-3 py-3"
              style={{ background: '#17191E', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wallets/bsv-desktop.png" alt="" className="h-9 w-9 rounded-lg" style={{ opacity: 0.55 }} />
              <span className="flex-1">
                <span className="block" style={{ color: '#fff', fontWeight: 600, fontSize: 15, opacity: 0.75 }}>
                  BSV Desktop
                </span>
                <span style={{ color: '#98A2B3', fontSize: 12 }}>Not running. Open the app, then retry.</span>
              </span>
              <button
                onClick={rescan}
                className="rounded-lg px-3 py-1.5"
                style={{ background: 'rgba(245,184,0,0.12)', color: '#F5B800', fontWeight: 600, fontSize: 13 }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Phone: shown straight away, an equal option (spec §2). Live once the pairing relay ships. */}
          {!isPhone && (
            <div
              className="flex items-center gap-4 rounded-xl px-3 py-3"
              style={{ background: '#17191E', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span
                className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-lg"
                style={{
                  background:
                    'repeating-conic-gradient(#2b2f36 0% 25%, #1f2228 0% 50%) 50% / 11px 11px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                aria-hidden
              >
                <span className="rounded-md px-1.5 py-0.5" style={{ background: '#101114', color: '#98A2B3', fontSize: 10, fontWeight: 600 }}>
                  SOON
                </span>
              </span>
              <span className="flex-1">
                <span className="block" style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>
                  Use bWallet on your phone
                </span>
                <span style={{ color: '#98A2B3', fontSize: 12, lineHeight: 1.4 }}>
                  Scan this code with bWallet to connect. Phone pairing is coming soon.
                </span>
              </span>
            </div>
          )}
        </div>

        {yours && wallets && wallets.length > 1 && (
          <p className="mt-3 px-1" style={{ color: '#667085', fontSize: 12, lineHeight: 1.45 }}>
            &quot;{yours.name}&quot; is the wallet on this page&apos;s shared slot (window.CWI). Wallets that announce themselves are
            listed by name.
          </p>
        )}

        <p className="mt-4 px-1" style={{ color: '#98A2B3', fontSize: 13 }}>
          No wallet?{' '}
          <a href="https://bwalletx.com" target="_blank" rel="noreferrer" style={{ color: '#F5B800', fontWeight: 600 }}>
            Get bWalletX →
          </a>
        </p>
      </div>
    </div>
  );
}
