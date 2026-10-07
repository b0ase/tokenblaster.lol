import Link from 'next/link';
import { GameBlasts } from '@/components/GameBlasts';
import { PageHead, SectionHead } from '@/components/dr/site';
import { Pictogram } from '@/components/dr';
import { byTitle } from '@/lib/alpha';
import { GAMES } from '@/lib/games';
import { ARCADE_CARD, shareImages } from '@/lib/og';

const description = 'Games built on the live BSV chain: shoot your own tokens, dodge real mainnet traffic, and more on the way.';
export const metadata = {
  title: 'Arcade · TokenBlaster.lol',
  description,
  openGraph: { title: 'TokenBlaster Arcade', description, url: '/arcade', images: shareImages(ARCADE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Arcade', description, images: shareImages(ARCADE_CARD).twitter },
};


/** Not ours: other people's BSV games, linked out to their own sites. Not hosted, run or endorsed here. */
type Other = { href: string; title: string; by: string; site: string; blurb: string };
const OTHER: Other[] = [
  { href: 'https://insertarcade.com/', title: 'Satoshi Pong', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'Pong on Bitcoin SV, by Insert Coin.' },
  { href: 'https://insertarcade.com/', title: 'FPSV', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'A first-person arena shooter on Bitcoin SV, by Insert Coin.' },
  { href: 'https://insertarcade.com/', title: 'CHESSV', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'Chess on a clock on Bitcoin SV, by Insert Coin.' },
  { href: 'https://paiybit.com/paiybit/arcade', title: 'Midnight Pass', by: 'Paiybit', site: 'paiybit.com', blurb: 'From the Paiybit arcade.' },
];

const pad = (n: number) => String(n).padStart(2, '0');

export default function ArcadePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-2.5">
      <PageHead title={<>Arcade<span className="blink text-[var(--accent)]">_</span></>} code={`TB-ARC / ${GAMES.length} GAMES`} kana="アーケード" icon="chip" back={['/', 'TokenBlaster.lol']} sub={description} />

      <Link href="/1satordnance" className="dr-poster group dr-rise flex flex-wrap items-center gap-3 p-3 transition-shadow hover:shadow-[6px_6px_0_var(--accent-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/cards/safu-blaster.webp" alt="" className="h-16 w-16 border-2 border-[var(--border)] object-cover" />
        <div className="min-w-[14rem] flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="dr-sticker text-xs">New</span>
            <span className="dr-display text-2xl text-hot group-hover:text-[var(--accent)]">1Sat Ordnance: weapons you actually own</span>
          </p>
          <p className="text-dim">Game guns as real 1Sat ordinals. Hold one in your wallet and it unlocks in Double-O Satoshi and the Arena.</p>
        </div>
        <span className="btn !px-3 !py-1.5">See the guns &raquo;</span>
      </Link>

      <SectionHead n="01" right={<span className="dr-code">{GAMES.length} cabinets</span>}>
        TokenBlaster games
      </SectionHead>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {byTitle(GAMES).map((g, i) => {
          const body = (
            <>
              <div className="relative aspect-[1200/630] overflow-hidden border-b-2 border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title} screenshot`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                <span className="dr-display absolute left-0 top-0 bg-[var(--accent-fill)] px-2 py-0.5 text-xl text-[var(--on-accent)]">{pad(i + 1)}</span>
                {g.status === 'soon' && <span className="dr-sticker dr-sticker-red absolute right-2 top-2 text-xs">Coming soon</span>}
                {g.version && <span className="dr-stamp absolute bottom-2 right-2 bg-black/80 text-[var(--hot)] !text-[var(--hot)]">{g.version}</span>}
              </div>
              <div className="flex flex-1 flex-col p-3">
                <span className="dr-code">
                  TB-{pad(i + 1)} / {g.tag ?? g.title.slice(0, 5).toUpperCase()}
                </span>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <span className="dr-display text-[28px] text-hot group-hover:text-[var(--accent)]">{g.title}</span>
                  <span className={`dr-stamp mt-1 shrink-0 ${g.status === 'live' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}>{g.status === 'live' ? 'Play' : 'Soon'}</span>
                </div>
                <p className="mt-2 text-[13px] text-dim">{g.blurb}</p>
                {g.tag && (
                  <p className="mt-2">
                    <GameBlasts tag={g.tag} />
                  </p>
                )}
              </div>
            </>
          );
          const cls = 'group relative flex flex-col border-2 border-[var(--border)] bg-panel';
          if (g.status === 'live' && g.href)
            return (
              <Link key={g.title} href={g.href} className={`${cls} transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-[var(--hot)] hover:shadow-[5px_5px_0_var(--accent-fill)]`}>
                {body}
              </Link>
            );
          return (
            <div key={g.title} className={`${cls} opacity-80`}>
              {body}
            </div>
          );
        })}
      </div>

      <section className="panel mt-2">
        <div className="panel-header">
          <span className="panel-title">Other games</span>
          <span className="flex items-center gap-2 text-xs text-dim">
            <Pictogram name="flag" size={14} colour="var(--muted)" />
            by other builders · links to their own sites
          </span>
        </div>
        <p className="text-xs text-dim">
          These aren&apos;t TokenBlaster games: they&apos;re built and run by other teams on their own sites, under their own rules. We just link to them.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OTHER.map((o) => (
            <a key={o.title} href={o.href} target="_blank" rel="noopener noreferrer" className="inset group px-3 py-2 hover:border-[var(--hot)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="dr-display text-xl text-hot group-hover:text-[var(--accent)]">{o.title} ↗</span>
                <span className="dr-stamp !text-[10px] text-[var(--muted)]">External</span>
              </div>
              <div className="text-xs text-accent">
                by {o.by} · {o.site}
              </div>
              <p className="mt-1 text-xs text-dim">{o.blurb}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
