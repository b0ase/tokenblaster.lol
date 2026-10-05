import Link from 'next/link';

const description = 'Games built on the live BSV chain: shoot your own tokens, dodge real mainnet traffic, and more on the way.';
export const metadata = {
  title: 'Arcade · TokenBlaster.lol',
  description,
  openGraph: { title: 'TokenBlaster Arcade', description, url: '/arcade' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Arcade', description },
};

type Game = { href?: string; title: string; blurb: string; status: 'live' | 'soon'; img: string; version?: string };
/** Ours: built and run on tokenblaster.lol. */
const GAMES: Game[] = [
  { href: '/arena', title: 'Arena', version: 'V1', img: '/arcade/arena.jpg', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: every bullet is a real transaction. Multiplayer: hit a player and your token lands in their gun.', status: 'live' },
  { href: '/arcade/frogger', title: 'Chain Frogger', version: 'V2', img: '/arcade/frogger.jpg', blurb: 'A 3D city crossing where every vehicle is a live mainnet transaction, one way from sender to receiver. Pick a character, arm up, zap traffic.', status: 'live' },
  { href: '/arcade/city', title: 'Satoshi City', version: 'V1', img: '/arcade/city.jpg', blurb: 'Open-world island city where every car on the road is a live mainnet transaction. Walk, carjack, drift, deliver the next block against the clock.', status: 'live' },
  { title: 'Ninja Punk Girls', img: '/arcade/npg.jpg', blurb: 'The NPG cards come alive in 3D: build your girl from her cards, then take her into the fight.', status: 'soon' },
  { title: 'Token Rally', img: '/arcade/rally.jpg', blurb: 'Race the tokens moving on chain right now.', status: 'soon' },
];

/** Not ours: other people's BSV games, linked out to their own sites. Not hosted, run or endorsed here. */
type Other = { href: string; title: string; by: string; site: string; blurb: string };
const OTHER: Other[] = [
  { href: 'https://insertarcade.com/', title: 'Satoshi Pong', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'Pong on Bitcoin SV, by Insert Coin.' },
  { href: 'https://insertarcade.com/', title: 'FPSV', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'A first-person arena shooter on Bitcoin SV, by Insert Coin.' },
  { href: 'https://insertarcade.com/', title: 'CHESSV', by: 'Insert Coin', site: 'insertarcade.com', blurb: 'Chess on a clock on Bitcoin SV, by Insert Coin.' },
  { href: 'https://paiybit.com/paiybit/arcade', title: 'Midnight Pass', by: 'Paiybit', site: 'paiybit.com', blurb: 'From the Paiybit arcade.' },
];

export default function ArcadePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Arcade<span className="blink">_</span>
          </h1>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <p className="mt-1 text-dim">{description}</p>
      </header>

      <h2 className="text-lg font-bold text-hot">TokenBlaster games</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((g) => {
          const body = (
            <>
              <div className="relative -mx-2.5 -mt-2.5 mb-2 aspect-[1200/630] overflow-hidden border-b border-[var(--border-dim)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title} screenshot`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                {g.status === 'soon' && <span className="absolute right-2 top-2 bg-black/80 px-2 py-0.5 text-xs text-hot">COMING SOON</span>}
                {g.version && <span className="absolute left-2 top-2 border border-fg bg-black/85 px-2 py-0.5 text-xs font-bold text-hot">{g.version}</span>}
              </div>
              <div className="panel-header">
                <span className="panel-title group-hover:text-hot">
                  &gt; {g.title}
                  {g.version && <span className="ml-2 text-xs text-accent">{g.version}</span>}
                </span>
                <span className={g.status === 'live' ? 'text-hot' : 'text-dim'}>{g.status === 'live' ? '[PLAY]' : '[COMING SOON]'}</span>
              </div>
              <p className="mt-1 text-dim">{g.blurb}</p>
            </>
          );
          if (g.status === 'live' && g.href)
            return (
              <Link key={g.title} href={g.href} className="panel group hover:border-fg">
                {body}
              </Link>
            );
          return (
            <div key={g.title} className="panel group opacity-80">
              {body}
            </div>
          );
        })}
      </div>

      <section className="panel mt-2">
        <div className="panel-header">
          <span className="panel-title">Other games</span>
          <span className="text-xs text-dim">by other builders · links to their own sites</span>
        </div>
        <p className="text-xs text-dim">
          These aren&apos;t TokenBlaster games: they&apos;re built and run by other teams on their own sites, under their own rules. We just link to them.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OTHER.map((o) => (
            <a key={o.title} href={o.href} target="_blank" rel="noopener noreferrer" className="inset group px-3 py-2 hover:border-fg">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-fg group-hover:text-hot">{o.title} ↗</span>
                <span className="text-xs text-dim">EXTERNAL</span>
              </div>
              <div className="text-xs text-accent">by {o.by} · {o.site}</div>
              <p className="mt-1 text-xs text-dim">{o.blurb}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
