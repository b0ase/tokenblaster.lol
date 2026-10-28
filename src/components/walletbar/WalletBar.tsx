'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SiteWalletChooser } from '@/components/SiteWalletChooser';
import { useHandleVerified, useMyHandle, VerifyButton } from '@/components/PlayerBadge';
import { disconnectSiteWallet, openChooser, openSiteWallet, setSiteWalletError } from '@/lib/siteWallet';
import { useSiteWallet } from '@/lib/useSiteWallet';
import { usePhoneLink } from '@/lib/pair/usePhoneLink';
import { DECLINED_TEXT } from '@/lib/pair/site';
import { getAudioPrefs, subscribeAudio, toggleMute } from '@/lib/sfx';
import { BWALLETX_WEB, WALLET_BAR as W, GET_NAME_URL, chipState, getBarWallet, idLabel, subBarWallet } from '@/lib/walletBar';
import { BwalletButton } from './BwalletButton';
import { GiftIcon, MaximizeIcon, MenuIcon, MinimizeIcon, MuteIcon, PhoneIcon, TrophyIcon, VolumeIcon } from './icons';

/**
 * TokenBlaster's top bar, drawn to bWalletX's side-panel header (values: src/lib/walletBar.ts) so the
 * page bar and the extension's bar read as one straight bar:
 *
 *   sm+   28px name strip (logo · page)            ← bWalletX AccountStrip
 *         56px tool row  (☰ · game tools · chip)   ← bWalletX TopNav
 *   phone one 56px row
 *
 * Game tools (Leaderboard · Sound · Fullscreen) complement the wallet's Calls · Airdrops · Media · Lock;
 * without the extension the wallet tools are in the ☰ drawer and the chip menu.
 */
export const roundBtn =
  'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2A2A2C] bg-transparent text-[#F5B800] transition-colors hover:bg-white/[0.06]';
const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const row = 'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] text-[#E4E4E7] transition-colors hover:bg-white/5';

/** Drawer row helpers for callers' ☰ menus. */
export const menuRowClass = row;

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, close]);
  return ref;
}

/** Calls · Airdrops live in bWalletX; these links reach them where the side panel is not open. */
export function WalletToolLinks() {
  return (
    <>
      <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-[0.12em] text-[#52525B]">Wallet</div>
      <a href={BWALLETX_WEB} target="_blank" rel="noreferrer" className={row}>
        <PhoneIcon color={W.accent} /> Calls <span className="ml-auto text-[10px] text-[#71717A]">in bWalletX</span>
      </a>
      <a href={BWALLETX_WEB} target="_blank" rel="noreferrer" className={row}>
        <GiftIcon color={W.accent} /> Airdrops <span className="ml-auto text-[10px] text-[#71717A]">in bWalletX</span>
      </a>
    </>
  );
}

export function LeaderboardButton() {
  return (
    <Link href="/leaderboard" aria-label="Leaderboard" title="Leaderboard" className={roundBtn}>
      <TrophyIcon size={W.iconSize} />
    </Link>
  );
}

const noMute = () => false;
export function SoundButton() {
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted, noMute);
  return (
    <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute sound' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'} className={roundBtn}>
      {muted ? <MuteIcon size={W.iconSize} /> : <VolumeIcon size={W.iconSize} />}
    </button>
  );
}

const fsSub = (f: () => void) => (document.addEventListener('fullscreenchange', f), () => document.removeEventListener('fullscreenchange', f));
const fsCan = () => Boolean(document.fullscreenEnabled);
/** Page fullscreen (site pages). Game pages pass their own enter/exit (GameShell). */
export function FullscreenButton({ on, onToggle }: { on?: boolean; onToggle?: () => void }) {
  const can = useSyncExternalStore(fsSub, fsCan, () => false);
  const docFs = useSyncExternalStore(fsSub, () => Boolean(document.fullscreenElement), () => false);
  const active = on ?? docFs;
  if (!can) return null;
  const toggle = onToggle ?? (() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined));
  return (
    <button type="button" onClick={toggle} aria-pressed={active} aria-label={active ? 'Exit fullscreen' : 'Fullscreen'} title={active ? 'Exit fullscreen' : 'Fullscreen'} className={roundBtn}>
      {active ? <MinimizeIcon size={W.iconSize} /> : <MaximizeIcon size={W.iconSize} />}
    </button>
  );
}

/** `@handle ●` when a BRC-100 wallet is connected (✓ once the handle is verified), else "Connect wallet". */
export function WalletBarChip({ primary = false }: { primary?: boolean } = {}) {
  const bar = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  const site = useSiteWallet();
  // The site's wallet is the truth (owner, 25 Oct 2026: paid and played, yet the chip said "Connect wallet"): if the
  // bar store missed it, show the connected wallet anyway.
  const wallet = bar ?? (site.wallet ? { id: site.wallet.id, name: site.wallet.name, publicKey: site.wallet.publicKey, live: site.live } : null);
  const handle = useMyHandle();
  const verified = useHandleVerified(handle);
  const state = chipState(wallet?.name ?? null, handle, verified);
  const [open, setOpen] = useState(false);
  const err = site.error;
  const phone = usePhoneLink(site.wallet?.id === 'phone');
  const ref = useOutside(open, () => setOpen(false));
  // A failed connect (from any Connect button) opens the menu with the plain-words reason and a way on.
  useEffect(() => {
    if (err) void Promise.resolve().then(() => setOpen(true));
  }, [err]);
  const choose = () => (setOpen(false), setSiteWalletError(null), openChooser());

  return (
    <div ref={ref} className="relative min-w-0" data-wallet-chip={state.kind}>
      {primary && state.kind === 'disconnected' && !err ? (
        <BwalletButton onSignIn={() => void openSiteWallet()} />
      ) : (
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => ((state.kind === 'disconnected' || wallet?.live === false) && !err ? void openSiteWallet() : setOpen((o) => !o))}
        className="flex h-9 min-w-0 max-w-[min(9.5rem,40vw)] items-center gap-1.5 rounded-full border border-[#2A2A2C] bg-transparent px-3 text-[12px] font-semibold text-[#F2F2F0] transition-colors hover:bg-white/[0.06] sm:max-w-none"
        style={{ fontFamily: font }}
      >
        {state.kind === 'disconnected' ? (
          <span>
            Connect<span className="hidden sm:inline"> wallet</span>
          </span>
        ) : wallet?.live === false && phone !== 'asleep' ? (
          // Dropped: say so and offer the fix, instead of the paymail beside "Disconnected" (owner, 25 Oct 2026:
          // "if it's disconnected, surely it shouldn't show my paymail"). The name stays in the tooltip.
          <span data-wallet-dropped title={`Reconnect ${wallet?.paymail ?? wallet?.name ?? 'your wallet'}`}>
            Reconnect<span className="hidden sm:inline"> wallet</span>
          </span>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote avatar from the paymail profile */}
            {wallet?.avatar && <img src={wallet.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />}
            <span className="truncate" title={`${wallet?.name ?? ''} · ${wallet?.paymail ?? wallet?.publicKey ?? ''}`}>
              {wallet?.publicKey || wallet?.paymail ? idLabel(wallet) : state.label}
            </span>
            {phone === 'asleep' ? (
              <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-300" data-phone-asleep>
                Asleep
              </span>
            ) : wallet?.live === false ? (
              <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 text-[10px] font-bold text-red-400" data-wallet-dropped>
                Disconnected
              </span>
            ) : (
              <span aria-label="wallet connected" className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            )}
          </>
        )}
        {state.kind === 'connected' && state.verified && (
          <span title="Verified handle" aria-label="verified" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0] text-[9px] leading-none text-white">
            ✓
          </span>
        )}
      </button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-[#1d1f24] bg-[#101114] p-1 shadow-xl shadow-black/60" style={{ fontFamily: font }}>
          {err && (
            <div className="px-3 py-2 text-[11px] text-red-400">
              <p>{err}</p>
              {/* Declined in bWallet: the pairing is fine, so no re-pair; the player just asks again. */}
              {err === DECLINED_TEXT ? (
                <button type="button" className="mt-1 font-semibold text-[#F5B800] underline" data-wallet-declined onClick={() => (setOpen(false), setSiteWalletError(null))}>
                  OK
                </button>
              ) : (
                <button type="button" className="mt-1 font-semibold text-[#F5B800] underline" onClick={choose}>
                  Pick a wallet or scan a new code
                </button>
              )}
            </div>
          )}
          {phone === 'asleep' && (
            <div className="px-3 py-2 text-[11px] text-amber-300" data-phone-asleep-note>
              Phone asleep or disconnected: open bWallet on your phone to resume, or{' '}
              <button type="button" className="font-semibold underline" onClick={choose}>
                re-scan
              </button>
              .
            </div>
          )}
          {state.kind === 'connected' ? (
            <>
              <div className="px-3 py-2 text-[11px] text-[#A1A1AA]">
                {wallet?.live === false ? 'Disconnected' : 'Connected'}: {wallet?.name}
                {wallet?.publicKey ? ` · ${idLabel(wallet)}` : ''}
              </div>
              {!wallet?.paymail && wallet?.publicKey && (
                <a role="menuitem" href={GET_NAME_URL} target="_blank" rel="noreferrer" className={row}>
                  Get your name
                </a>
              )}
              <button type="button" role="menuitem" className={row} onClick={choose}>
                Switch wallet
              </button>
              {handle && !verified && (
                <div className="px-3 py-1">
                  <VerifyButton handle={handle} />
                </div>
              )}
              <a role="menuitem" href={BWALLETX_WEB} target="_blank" rel="noreferrer" className={row}>
                Open bWalletX
              </a>
              <WalletToolLinks />
              <button
                type="button"
                role="menuitem"
                className={row}
                onClick={() => {
                  disconnectSiteWallet();
                  setOpen(false);
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className={row} onClick={choose}>
                Connect a wallet
              </button>
              <WalletToolLinks />
            </>
          )}
        </div>
      )}
      <SiteWalletChooser />
    </div>
  );
}

/** The bar itself. `tools` are round buttons; `menu` fills the ☰ drawer (wallet tools are appended). */
export function WalletBar({ logo, title, tools, menu, className = '', sticky = true, label = 'Site', primaryConnect = false }: { logo: ReactNode; title?: string; tools: ReactNode; menu: ReactNode; className?: string; sticky?: boolean; label?: string; /** The yellow bWallet button in place of the plain Connect chip (arcade games). */ primaryConnect?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const name = (
    <span className="flex min-w-0 items-center gap-2 text-[13px]">
      {logo}
      {title && <span className="hidden text-[#71717A] sm:inline">·</span>}
      {title && <span className="hidden truncate font-semibold text-[#D4D4D8] sm:inline">{title}</span>}
    </span>
  );
  return (
    <nav aria-label={label} data-wallet-bar className={`${sticky ? 'sticky top-0' : ''} z-30 ${className}`} style={{ fontFamily: font, background: W.rowBg }}>
      <div className="wb-strip hidden items-center px-3 sm:flex" style={{ height: W.stripH, background: W.stripBg, borderBottom: `1px solid ${W.stripEdge}` }}>
        {name}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-2 min-[400px]:gap-2 sm:gap-3" style={{ height: W.rowH, background: W.rowBg }}>
        <div ref={ref} className="relative shrink-0">
          <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent hover:bg-white/[0.06]">
            <MenuIcon size={W.menuIconSize} color={W.icon} />
          </button>
          {open && (
            <div role="menu" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)} className="absolute left-0 top-full z-50 mt-2 max-h-[75vh] w-[min(92vw,20rem)] overflow-y-auto rounded-xl border border-[#1d1f24] bg-[#101114] py-1 shadow-xl shadow-black/60">
              {menu}
              <WalletToolLinks />
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center sm:hidden">{name}</div>
        {tools}
        <div className="flex-1" />
        <WalletBarChip primary={primaryConnect} />
      </div>
    </nav>
  );
}
