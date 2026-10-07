'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PaletteToggle } from './PaletteToggle';

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

export function SiteNav() {
  const path = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close the games menu when a game is picked, on outside clicks and on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const here = (href: string) => path === href || path.startsWith(`${href}/`);
  const arcadeHere = inArcade(path);

  return (
    <nav aria-label="Site" className="sticky top-0 z-30 border-b-2 border-[var(--hot)] bg-bg">
      <div className="dr-hazard !h-[6px]" aria-hidden />
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 text-sm sm:min-h-[56px] sm:gap-x-4 sm:py-2">
        <Link href="/" className="dr-display dr-logo shrink-0 text-[15px] leading-none text-hot min-[400px]:text-[18px] sm:text-[28px]" aria-label="TokenBlaster.lol home">
          Token<span className="text-[var(--accent)]">Blaster</span>
          <span className="dr-outline !text-[0.7em]">.lol</span>
        </Link>

        <div ref={menu} className="relative shrink-0">
          <div className="flex">
            <Link
              href="/arcade"
              aria-current={path === '/arcade' ? 'page' : undefined}
              className={`btn-fire inline-flex items-center gap-1.5 !px-3 !py-1 !text-[17px] sm:!px-5 sm:!py-2 sm:!text-[22px] ${arcadeHere ? 'outline outline-2 outline-offset-2 outline-[var(--hot)]' : ''}`}
            >
              <span aria-hidden>▶</span> Arcade
            </Link>
            <button
              type="button"
              aria-label="All games"
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => !o)}
              className="btn-fire !ml-1 !px-2.5 !py-1 !text-[17px] sm:!py-2 sm:!text-[22px]"
            >
              <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>
          </div>
          {open && (
            <div role="menu" className="absolute left-0 top-full z-40 mt-3 w-[min(94vw,28rem)] max-sm:fixed max-sm:inset-x-2 max-sm:w-auto border-2 border-[var(--hot)] bg-bg shadow-[6px_6px_0_var(--hard)]">
              <div className="dr-hazard !h-2" aria-hidden />
              <div className="grid grid-cols-2 gap-1 p-2">
                {LINKS.map(([href, label]) => (
                  <Link key={href} role="menuitem" href={href} onClick={() => setOpen(false)} aria-current={here(href) ? 'page' : undefined} className={`btn whitespace-nowrap text-left !text-[11px] sm:hidden ${here(href) ? 'btn-on' : ''}`}>
                    {label}
                  </Link>
                ))}
                <div className="col-span-2 my-1 border-t border-[var(--border-dim)] sm:hidden" aria-hidden />
                {[...ARCADE_GAMES].sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base', numeric: true })).map(([href, label]) => (
                  <Link
                    key={href}
                    role="menuitem"
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={here(href) ? 'page' : undefined}
                    className={`btn justify-start whitespace-nowrap text-left !text-[11px] ${here(href) ? 'btn-on' : ''}`}
                  >
                    {label}
                  </Link>
                ))}
                <Link role="menuitem" href="/arcade" onClick={() => setOpen(false)} className="btn btn-on col-span-2 text-center font-bold">
                  All games &gt;&gt;
                </Link>
              </div>
            </div>
          )}
        </div>

        <ul className="hidden min-w-0 gap-1 overflow-x-auto py-1 sm:flex">
          {LINKS.map(([href, label]) => (
            <li key={href} className="shrink-0">
              <Link href={href} aria-current={here(href) ? 'page' : undefined} className={`btn whitespace-nowrap !px-3 !py-1.5 !text-[12px] sm:!px-4 sm:!py-2.5 sm:!text-[13px] ${here(href) ? 'btn-on' : ''}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <PaletteToggle className="ml-auto hidden shrink-0 xl:flex" />
      </div>
      <div className="dr-chev !h-[7px] opacity-80" aria-hidden />
    </nav>
  );
}
