import type { Metadata } from 'next';
import Link from 'next/link';
import { Barcode } from '@/components/dr';
import { byTitle } from '@/lib/alpha';
import { GAMES } from '@/lib/games';

export const metadata: Metadata = {
  title: '404 · TX not found · TokenBlaster.lol',
  description: 'This block was never mined. Jump back into the arcade, the live chain highway or the leaderboard.',
  robots: { index: false },
};

const pad = (n: number) => String(n).padStart(2, '0');

const EXITS: { href: string; code: string; label: string; sub: string; fire?: boolean }[] = [
  { href: '/arcade', code: 'EXIT-01', label: 'Arcade', sub: `${GAMES.filter((g) => g.status === 'live').length} games on the live chain`, fire: true },
  { href: '/arcade/terrornode', code: 'EXIT-02', label: 'TERRORNODE', sub: 'Every bullet a real BSV tx' },
  { href: '/', code: 'EXIT-03', label: 'Live highway', sub: 'Watch mainnet go by' },
  { href: '/leaderboard', code: 'EXIT-04', label: 'Leaderboard', sub: 'The top blasters' },
];

export default function NotFound() {
  const live = byTitle(GAMES.filter((g): g is typeof g & { href: string } => g.status === 'live' && !!g.href));
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-2.5">
      <section className="dr-poster dr-rise tb404" aria-labelledby="tb404-title">
        <div className="dr-tape" aria-hidden />
        <div className="tb404-scan" aria-hidden />
        <div className="relative grid gap-4 px-3 pb-5 pt-3 sm:px-6 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="dr-code !text-[var(--accent)]">ERR 0x194 / HTTP 404</span>
              <span className="dr-code">TB-NULL / BLOCK ??????</span>
              <span className="dr-kana text-[11px] text-[var(--muted)]" aria-hidden>
                見つかりません
              </span>
            </div>
            <h1 id="tb404-title" className="sr-only">
              404: TX not found
            </h1>
            <div className="tb404-num dr-display" aria-hidden>
              <span className="tb404-ghost">404</span>
              <span className="tb404-solid">404</span>
            </div>
            <p className="dr-display mt-2 text-[clamp(30px,5.4vw,60px)] text-hot">
              TX not found<span className="blink text-[var(--accent)]">_</span>
            </p>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-dim sm:text-sm">
              This block was never mined. The page you asked for isn&apos;t on this chain: no txid, no confirmations, no merkle proof. Pick an exit and get back to blasting.
            </p>
          </div>
          <aside className="flex flex-row flex-wrap items-start gap-3 md:flex-col md:items-end md:text-right" aria-hidden>
            <span className="dr-sticker text-sm">Warning: orphaned route</span>
            <span className="dr-stamp text-[var(--accent)]">0 confs</span>
            <dl className="dr-code grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 !text-[var(--text)]">
              <dt className="text-[var(--muted)]">status</dt>
              <dd>rejected</dd>
              <dt className="text-[var(--muted)]">mempool</dt>
              <dd>absent</dd>
              <dt className="text-[var(--muted)]">merkle</dt>
              <dd>null</dd>
            </dl>
            <Barcode seed="TB-404-NOTFOUND" h={26} w={120} colour="var(--text)" />
          </aside>
        </div>
        <div className="dr-chev dr-chev-march opacity-90" aria-hidden />
      </section>

      <nav aria-label="Ways out" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {EXITS.map((e) => (
          <Link key={e.href} href={e.href} className={`tb404-exit ${e.fire ? 'tb404-exit-fire' : ''}`}>
            <span className="dr-code tb404-exit-code">{e.code}</span>
            <span className="dr-display text-[clamp(30px,3.4vw,38px)] leading-none">{e.label} &raquo;</span>
            <span className="tb404-exit-sub text-[12px]">{e.sub}</span>
          </Link>
        ))}
      </nav>

      <div className="flex items-end justify-between gap-3 border-b-2 border-[var(--hot)] pb-1">
        <h2 className="dr-display flex items-baseline gap-2 text-[clamp(26px,4.4vw,40px)] text-hot">
          <span className="text-[0.55em] text-[var(--accent)]">05</span>
          Or load a cabinet
        </h2>
        <span className="dr-code shrink-0 pb-1">{live.length} live</span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {live.map((g, i) => (
          <li key={g.href} className="min-w-0">
            <Link href={g.href} className="tb404-tile group">
              <span className="relative block aspect-[1200/630] overflow-hidden border-b-2 border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                <span className="dr-display absolute left-0 top-0 bg-[var(--accent-fill)] px-1.5 py-0.5 text-base text-[var(--on-accent)]">{pad(i + 1)}</span>
              </span>
              <span className="block p-2">
                <span className="dr-code block truncate">{g.kind ?? 'game'}</span>
                <span className="dr-display block truncate text-[20px] text-hot group-hover:text-[var(--accent)]">{g.title}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
