'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
  ['/arcade/city', 'Satoshi City'],
  ['/arcade/frogger', 'Chain Frogger'],
  ['/arcade/bsvgun', 'BSVGun'],
  ['/arcade/hopper', 'Block Hopper'],
  ['/arcade/invaders', 'Mempool Invaders'],
  ['/arcade/snake', 'Token Snake'],
  ['/arcade/kweg', "Kweg's Expedition"],
  ['/arcade/npg-runner', 'NPG: Erobot Uprising'],
  ['/arcade/npg-cards', 'NPG: Card Battle'],
] as const;

const LINKS = [
  ['/blast', 'Blast'],
  ['/launch', 'BlastPad'],
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
    <nav aria-label="Site" className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1300px] items-center gap-2 px-2.5 py-1.5 text-sm sm:gap-3">
        <Link href="/" className="shrink-0 font-bold text-hot">
          TokenBlaster<span className="text-fg">.lol</span>
        </Link>

        <div ref={menu} className="relative shrink-0">
          <div className="flex">
            <Link
              href="/arcade"
              aria-current={path === '/arcade' ? 'page' : undefined}
              className={`btn-fire inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-sm font-bold tracking-wider ${arcadeHere ? 'ring-2 ring-[var(--fg)]' : ''}`}
            >
              ▶ ARCADE
            </Link>
            <button
              type="button"
              aria-label="All games"
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => !o)}
              className="btn-fire !ml-px !px-2 !py-1.5 !text-sm"
            >
              <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>
          </div>
          {open && (
            <div role="menu" className="absolute left-0 top-full z-40 mt-1 grid w-[min(92vw,26rem)] grid-cols-2 gap-1 border border-line bg-bg p-2 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
              {ARCADE_GAMES.map(([href, label]) => (
                <Link
                  key={href}
                  role="menuitem"
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={here(href) ? 'page' : undefined}
                  className={`btn justify-start whitespace-nowrap text-left ${here(href) ? 'btn-on' : ''}`}
                >
                  {label}
                </Link>
              ))}
              <Link role="menuitem" href="/arcade" onClick={() => setOpen(false)} className="btn btn-on col-span-2 text-center font-bold">
                ALL GAMES &gt;
              </Link>
            </div>
          )}
        </div>

        <ul className="flex min-w-0 gap-1 overflow-x-auto">
          {LINKS.map(([href, label]) => (
            <li key={href} className="shrink-0">
              <Link href={href} aria-current={here(href) ? 'page' : undefined} className={`btn whitespace-nowrap ${here(href) ? 'btn-on' : ''}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
