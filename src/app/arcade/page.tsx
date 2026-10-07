import Link from 'next/link';
import { GameBlasts } from '@/components/GameBlasts';

const description = 'Games built on the live BSV chain: shoot your own tokens, dodge real mainnet traffic, and more on the way.';
export const metadata = {
  title: 'Arcade · TokenBlaster.lol',
  description,
  openGraph: { title: 'TokenBlaster Arcade', description, url: '/arcade' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Arcade', description },
};

type Game = { href?: string; title: string; blurb: string; status: 'live' | 'soon'; img: string; version?: string; /** game name in its blasts' OP_RETURN */ tag?: string };
/** Ours: built and run on tokenblaster.lol. */
const GAMES: Game[] = [
  { href: '/arcade/doubleosatoshi', tag: 'doubleo', title: 'Double-O Satoshi', version: 'V1', img: '/arcade/doubleo.jpg', blurb: 'GoldenEye-style spy shooter: Special Agent Kweg Wong fires PNEE at parody crypto villains across five missions. LIVE mode: every bullet is one token on chain.', status: 'live' },
  { href: '/arcade/bsvgun', tag: 'bsvgun', title: 'BSVGun', version: 'V1', img: '/arcade/bsvgun.jpg', blurb: 'TeraGun-style mass blaster: fire 50,000 real BSV transactions in one go, tagged for your token, straight onto the leaderboard.', status: 'live' },
  { href: '/arena', tag: 'arena', title: 'Arena', version: 'V1', img: '/arcade/arena.jpg', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: every bullet is a real transaction. Multiplayer: hit a player and your token lands in their gun.', status: 'live' },
  { href: '/arcade/frogger', tag: 'frogger', title: 'Chain Frogger', version: 'V2', img: '/arcade/frogger.jpg', blurb: 'A 3D city crossing where every vehicle is a live mainnet transaction, one way from sender to receiver. Pick a character, arm up, zap traffic.', status: 'live' },
  { href: '/arcade/hopper', tag: 'hopper', title: 'Block Hopper', version: 'V1', img: '/arcade/hopper.jpg', blurb: 'A high-speed side-scroller where the level is the live chain: every tx is ground, blasts are coins, token transfers are enemies, blocks are checkpoints.', status: 'live' },
  { href: '/arcade/invaders', tag: 'invaders', title: 'Mempool Invaders', version: 'V1', img: '/arcade/invaders.jpg', blurb: 'Space Invaders where every invader is a live transaction. Token transfers wear their token: shoot one and catch the token it drops.', status: 'live' },
  { href: '/arcade/kweg', tag: 'kweg', title: "Kweg's Expedition", version: 'V1', img: '/arcade/kweg.jpg', blurb: "Pilot Professor Kweg's pachyderm submarine through the live chain: sonar for hidden $KWEG, patent-dash obstacles, outrace three parody rivals to Satoshi's submarine coordinates.", status: 'live' },
  { href: '/arcade/snake', tag: 'snake', title: 'Token Snake', version: 'V1', img: '/arcade/snake.jpg', blurb: 'Snake where the food is the live chain: every bite is a real transaction, token transfers are token food you collect, blasts are gold.', status: 'live' },
  { href: '/arcade/city', title: 'Satoshi City', version: 'V1', img: '/arcade/city.jpg', blurb: 'Open-world island city where every car on the road is a live mainnet transaction. Walk, carjack, drift, deliver the next block against the clock.', status: 'live' },
  { href: '/arcade/npg-cards', tag: 'npgcards', title: 'Ninja Punk Girls: Card Battle', version: 'V1', img: '/arcade/npg-cards.jpg', blurb: 'Turn-based card battle: pick your NPG girl, build a deck of NPG element cards (stats from their six attributes), fight the AI or a friend online. LIVE mode: every card played is a transaction.', status: 'live' },
  { href: '/arcade/npg-runner', tag: 'npg', title: 'Ninja Punk Girls: Erobot Uprising', version: 'V1', img: '/arcade/npg-runner.jpg', blurb: 'NPG platformer: wall-jump, dash and shuriken through three stages and three Erobot bosses. Live token transfers float in as tokens to grab; LIVE mode: every jump is a transaction.', status: 'live' },
  { href: '/arcade/rally', tag: 'rally', title: 'Token Rally', version: 'V1', img: '/arcade/rally.jpg', blurb: 'Rally racing against the live chain: every rival car is a mainnet transaction, faster the bigger the move. Forest, desert and snow stages, handbrake drifts, nitro coins, splits.', status: 'live' },
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

      <Link href="/1satordnance" className="panel group flex flex-wrap items-center gap-3 hover:border-fg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/cards/safu-blaster.webp" alt="" className="h-16 w-16 border border-[var(--border-dim)] object-cover" />
        <div className="min-w-[14rem] flex-1">
          <p className="font-bold text-hot group-hover:underline">NEW · 1SAT ORDNANCE: weapons you actually own</p>
          <p className="text-dim">Game guns as real 1Sat ordinals. Hold one in your wallet and it unlocks in Double-O Satoshi and the Arena.</p>
        </div>
        <span className="text-hot">[SEE THE GUNS]</span>
      </Link>

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
              {g.tag && (
                <p className="mt-1">
                  <GameBlasts tag={g.tag} />
                </p>
              )}
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
