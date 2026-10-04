import Link from 'next/link';

const description = 'Games built on the live BSV chain: shoot your own tokens, dodge real mainnet traffic, and more on the way.';
export const metadata = {
  title: 'Arcade · TokenBlaster.lol',
  description,
  openGraph: { title: 'TokenBlaster Arcade', description, url: '/arcade' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Arcade', description },
};

type Game = { href?: string; external?: boolean; title: string; by?: string; blurb: string; status: 'live' | 'soon'; img: string };
const GAMES: Game[] = [
  { href: '/arena', title: 'Arena', img: '/arcade/arena.jpg', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: every bullet is a real transaction. Multiplayer: hit a player and your token lands in their gun.', status: 'live' },
  { href: '/arcade/frogger', title: 'Chain Frogger', img: '/arcade/frogger.jpg', blurb: 'A 3D city crossing where every vehicle is a live mainnet transaction, one way from sender to receiver. Pick a character, arm up, zap traffic.', status: 'live' },
  { title: 'Ninja Punk Girls', img: '/arcade/npg.jpg', blurb: 'The NPG cards come alive in 3D: build your girl from her cards, then take her into the fight.', status: 'soon' },
  { title: 'Token Rally', img: '/arcade/rally.jpg', blurb: 'Race the tokens moving on chain right now.', status: 'soon' },
  { href: 'https://paiybit.com/paiybit/arcade', external: true, title: 'Midnight Pass', by: 'Paiybit', img: '/arcade/midnight.jpg', blurb: 'From the Paiybit arcade.', status: 'soon' },
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((g) => {
          const body = (
            <>
              <div className="relative -mx-2.5 -mt-2.5 mb-2 aspect-[1200/630] overflow-hidden border-b border-[var(--border-dim)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title} screenshot`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                {g.status === 'soon' && <span className="absolute right-2 top-2 bg-black/80 px-2 py-0.5 text-xs text-hot">COMING SOON</span>}
              </div>
              <div className="panel-header">
                <span className="panel-title group-hover:text-hot">&gt; {g.title}</span>
                <span className={g.status === 'live' ? 'text-hot' : 'text-dim'}>{g.status === 'live' ? '[PLAY]' : '[COMING SOON]'}</span>
              </div>
              {g.by && <p className="text-xs text-dim">by {g.by}</p>}
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
      <p className="text-center text-xs text-muted">free entry · bragging rights only · no prizes, no fees</p>
    </main>
  );
}
