'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PaletteToggle } from './PaletteToggle';
import { FullscreenButton, LeaderboardButton, SoundButton, WalletBar, menuRowClass, roundBtn } from './walletbar/WalletBar';
import { GamepadIcon } from './walletbar/icons';

/**
 * The site-wide bar on every page (src/app/layout.tsx). Full-screen games (Arena, Double-O Satoshi) cover
 * it while playing. ARCADE is the main button, with every game in its menu (owner, 7 Oct 2026: it
 * "looks like just another game"); the other sections are plain links.
 */
export const ARCADE_GAMES = [
  ['/arena', 'Arena'],
  ['/arcade/doubleosatoshi', 'Double-O Satoshi'],
  ['/arcade/rally', 'Token Rally'],
  ['/arcade/2048', 'Sat Stack 2048'],
  ['/arcade/highway21', 'Highway 21M'],
  ['/arcade/bracer', 'bRacer'],
  ['/arcade/city', 'Satoshi City'],
  ['/arcade/frogger', 'Chain Frogger'],
  ['/arcade/bsvgun', 'BSVGun'],
  ['/arcade/hopper', 'Block Hopper'],
  ['/arcade/invaders', 'Mempool Invaders'],
  ['/arcade/snake', 'Token Snake'],
  ['/arcade/kweg', "Kweg's Expedition"],
  ['/arcade/npg-runner', 'NPG: Erobot Uprising'],
  ['/arcade/npg-cards', 'NPG: Card Battle'],
  ['/arcade/bubbo-bubbo', 'Coin Pop'],
  ['/arcade/puzzling-potions', 'Token Potions'],
] as const;

const LINKS = [
  ['/blast', 'Blast'],
  ['/launch', 'BlastPad'],
  ['/multiplayer', 'Multiplayer'],
  ['/leaderboard', 'Leaderboard'],
  ['/1satordnance', '1Sat Ordnance'],
  ['/updates', 'Updates'],
] as const;

const inArcade = (path: string) => path === '/arcade' || path.startsWith('/arcade/') || path === '/arena' || path.startsWith('/arena/');

/** Page name beside the logo in the bar's name strip. */
export function pageTitle(path: string): string {
  const game = ARCADE_GAMES.find(([href]) => path === href || path.startsWith(`${href}/`));
  if (game) return game[1];
  const link = LINKS.find(([href]) => path === href || path.startsWith(`${href}/`));
  if (link) return link[1];
  if (path === '/arcade') return 'Arcade';
  if (path.startsWith('/viewer')) return 'Viewer';
  return '';
}

export const SiteLogo = () => (
  <Link href="/" className="dr-display shrink-0 text-[13px] font-bold leading-none" aria-label="TokenBlaster.lol home" style={{ color: '#F2F2F0' }}>
    Token<span style={{ color: '#F5B800' }}>Blaster</span>
    <span className="text-[#71717A]">.lol</span>
  </Link>
);

/**
 * Owner, 8 Oct 2026: the bar is drawn to bWalletX's side-panel header (components/walletbar), so with the
 * extension open the two read as one bar. ARCADE and every section moved into the menu; the row carries
 * game tools (Arcade, Leaderboard, Sound, Fullscreen) and the wallet chip.
 */
export function SiteNav() {
  const path = usePathname() ?? '/';
  const here = (href: string) => path === href || path.startsWith(`${href}/`);
  const item = (href: string, label: string) => (
    <Link key={href} role="menuitem" href={href} aria-current={here(href) ? 'page' : undefined} className={`${menuRowClass} aria-[current=page]:bg-white/10`}>
      {label}
    </Link>
  );
  const games = [...ARCADE_GAMES].sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base', numeric: true }));
  return (
    <WalletBar
      logo={<SiteLogo />}
      title={pageTitle(path)}
      tools={
        <>
          <Link href="/arcade" aria-label="Arcade" title="Arcade" aria-current={inArcade(path) ? 'page' : undefined} className={`${roundBtn} aria-[current=page]:bg-white/10`}>
            <GamepadIcon size={16} />
          </Link>
          <LeaderboardButton />
          <SoundButton />
          <span className="hidden sm:contents">
            <FullscreenButton />
          </span>
        </>
      }
      menu={
        <>
          {item('/arcade', 'Arcade (all games)')}
          {LINKS.map(([href, label]) => item(href, label))}
          <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-[0.12em] text-[#52525B]">Games</div>
          {games.map(([href, label]) => item(href, label))}
          <div className="px-3 py-2">
            <PaletteToggle />
          </div>
        </>
      }
    />
  );
}
