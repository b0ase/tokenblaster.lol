'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The site-wide bar on every page. Full-screen games (Arena, Double-O Satoshi) cover it while playing. */
const LINKS = [
  ['/', 'Home'],
  ['/blast', 'Blast'],
  ['/arena', 'Arena'],
  ['/arcade', 'Arcade'],
  ['/arcade/bsvgun', 'BSVGun'],
  ['/launch', 'BlastPad'],
  ['/1satordnance', '1Sat Ordnance'],
  ['/updates', 'Updates'],
] as const;

export function SiteNav() {
  const path = usePathname() ?? '/';
  const active = (href: string) =>
    href === '/' ? path === '/' : path === href || (path.startsWith(`${href}/`) && !LINKS.some(([h]) => h !== href && h.startsWith(href) && path.startsWith(h)));
  return (
    <nav aria-label="Site" className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1300px] items-center gap-3 overflow-x-auto px-2.5 py-1.5 text-sm">
        <Link href="/" className="shrink-0 font-bold text-hot">
          TokenBlaster<span className="text-fg">.lol</span>
        </Link>
        <ul className="flex shrink-0 gap-1">
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <Link href={href} aria-current={active(href) ? 'page' : undefined} className={`btn whitespace-nowrap ${active(href) ? 'btn-on' : ''}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
