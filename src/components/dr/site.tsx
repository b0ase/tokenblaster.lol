/**
 * Site-level DR building blocks. Server-safe, colour comes only from the palette tokens in globals.css
 * (so the ?palette= switch restyles all of it). The primitives (Pictogram, Barcode...) live in ./index.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Barcode, Pictogram, type PictogramName } from './index';
import { PaletteToggle } from '../PaletteToggle';

/** The standard page header: poster frame, hazard band, product code, oversized condensed title. */
export function PageHead({
  title,
  kicker,
  code,
  kana,
  back,
  sub,
  icon,
  children,
  size = 'h1',
}: {
  title: ReactNode;
  kicker?: string;
  code?: string;
  kana?: string;
  back?: [href: string, label: string];
  sub?: ReactNode;
  icon?: PictogramName;
  children?: ReactNode;
  size?: 'h1' | 'h2';
}) {
  return (
    <header className="dr-poster dr-rise">
      <div className="dr-hazard" aria-hidden />
      <div className="dr-halftone pointer-events-none absolute right-0 top-3 h-40 w-3/5" aria-hidden />
      <div className="relative px-3 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-3">
            {icon && <Pictogram name={icon} size={18} colour="var(--accent)" />}
            <span className="dr-code">{kicker ?? 'TokenBlaster.lol'}</span>
            {code && <span className="dr-code !text-[var(--accent)]">{code}</span>}
          </div>
          <div className="flex items-center gap-3">
            {kana && (
              <span className="dr-kana text-[11px] text-[var(--muted)]" aria-hidden>
                {kana}
              </span>
            )}
            {back && (
              <Link href={back[0]} className="dr-code !text-[var(--text)] underline-offset-4 hover:underline">
                &lt; {back[1]}
              </Link>
            )}
          </div>
        </div>
        <h1 className={`dr-display ${size === 'h1' ? 'dr-h1' : 'dr-h2'} text-hot [text-wrap:balance]`}>{title}</h1>
        {sub && <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-dim sm:text-sm">{sub}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
      <div className="dr-chev opacity-90" aria-hidden />
    </header>
  );
}

/** Section marker: "02 // ARCADE" with a rule. */
export function SectionHead({ n, children, right }: { n?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b-2 border-[var(--hot)] pb-1">
      <h2 className="dr-display flex items-baseline gap-2 text-[clamp(26px,4.4vw,40px)] text-hot">
        {n && <span className="text-[0.55em] text-[var(--accent)]">{n}</span>}
        {children}
      </h2>
      {right && <div className="shrink-0 pb-1 text-xs">{right}</div>}
    </div>
  );
}

const FOOT: [string, string][] = [
  ['/arcade', 'Arcade'],
  ['/leaderboard', 'Leaderboard'],
  ['/arena', 'Arena'],
  ['/arcade/bsvgun', 'BSVGun'],
  ['/arcade/bracer', 'bRacer'],
  ['/arcade/frogger', 'Chain Frogger'],
  ['/blast', 'Blast'],
  ['/launch', 'BlastPad'],
  ['/1satordnance', '1Sat Ordnance'],
  ['/updates', 'Updates'],
  ['/viewer', '3D viewer'],
];

export function SiteFooter() {
  return (
    <footer className="mt-6 border-t-2 border-[var(--hot)] bg-bg">
      <div className="dr-hazard" aria-hidden />
      <div className="w-full px-[clamp(12px,2.6vw,64px)] pb-6 pt-4">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="dr-display dr-logo text-[clamp(26px,7.4vw,92px)] leading-[0.95] text-hot" aria-hidden>
              Token<span className="text-[var(--accent)]">Blaster</span>
              <span className="dr-outline">.lol</span>
            </p>
            <p className="dr-kana mt-3 text-sm text-[var(--muted)]" aria-hidden>
              トークン・ブラスター &nbsp;/&nbsp; チェーン直撃
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Barcode seed="TOKENBLASTER.LOL" h={34} w={150} colour="var(--text)" />
            <span className="dr-code">TB-2026 / BSV / MAINNET</span>
            <div className="flex gap-2">
              <Pictogram name="bolt" size={16} colour="var(--accent)" />
              <Pictogram name="target" size={16} colour="var(--accent)" />
              <Pictogram name="hex" size={16} colour="var(--accent)" />
              <Pictogram name="turbo" size={16} colour="var(--accent)" />
            </div>
          </div>
        </div>
        <div className="dr-chev dr-chev-ink my-4 opacity-30" aria-hidden />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 text-xs uppercase tracking-wider">
          {FOOT.map(([href, label]) => (
            <Link key={href} href={href} className="text-dim hover:text-[var(--accent)] hover:underline">
              {label}
            </Link>
          ))}
          <a href="https://github.com/b0ase/tokenblaster.lol" className="text-dim hover:text-[var(--accent)] hover:underline">
            GitHub
          </a>
        </nav>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="dr-code">powered by GorillaPool · built on Bitcoin SV</span>
          <PaletteToggle />
        </div>
      </div>
    </footer>
  );
}
