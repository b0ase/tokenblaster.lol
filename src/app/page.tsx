import Link from 'next/link';
import { GitHubLink } from '@/components/GitHubLink';
import { ChainDashboard } from '@/components/ChainDashboard';

const GAMES = [
  { href: '/arcade/doubleokweg', img: '/arcade/doubleo.jpg', title: 'Double-O Kweg', tag: 'V1 · spy shooter', blurb: 'GoldenEye-style 3D missions: Special Agent Kweg Wong fires PNEE at parody crypto villains. LIVE mode: one token per bullet, one transaction per token.' },
  { href: '/arcade/bsvgun', img: '/arcade/bsvgun.jpg', title: 'BSVGun', tag: 'V1 · mass blaster', blurb: 'TeraGun-style: load once and fire 50,000 real tagged transactions in parallel lanes. Every blast counts on the leaderboard.' },
  { href: '/arena', img: '/arcade/arena.jpg', title: 'Arena', tag: 'V1 · multiplayer', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: one token per bullet, one transaction per token. Hit another player and your token lands in their gun.' },
  { href: '/arcade/frogger', img: '/arcade/frogger.jpg', title: 'Chain Frogger', tag: 'V2 · 3D city', blurb: 'Cross a GTA-style avenue where every vehicle is a live mainnet transaction, one way from sender to receiver. Token transfers drive box trucks wearing their logo.' },
  { href: '/arcade/hopper', img: '/arcade/hopper.jpg', title: 'Block Hopper', tag: 'V1 · platformer', blurb: 'Run and jump across mainnet as it happens: every platform is a live transaction, token transfers walk out as enemies, new blocks are checkpoints.' },
  { href: '/arcade/invaders', img: '/arcade/invaders.jpg', title: 'Mempool Invaders', tag: 'V1 · shooter', blurb: 'Live transactions march down as invaders. Shoot the gold token invaders and catch the BSV-21 token they drop.' },
  { href: '/arcade/snake', img: '/arcade/snake.jpg', title: 'Token Snake', tag: 'V1 · snake', blurb: 'Eat the live chain: every bite is a transaction. Token transfers are token food you collect, TokenBlaster blasts are gold.' },
  { href: '/arcade/kweg', img: '/arcade/kweg.jpg', title: "Kweg's Expedition", tag: 'V1 · side-scroller', blurb: "Pilot Professor Kweg's pachyderm submarine through mainnet: sonar pings find hidden $KWEG, and three parody rivals race you to Satoshi's submarine coordinates." },
];

const STACK = [
  ['Chain', 'Bitcoin SV · BSV-21 tokens · 1Sat ordinals'],
  ['Data', 'GorillaPool JungleBus (live stream) · ordinals index · ARC broadcast'],
  ['Wallets', 'BRC-100: bWallet, bWalletX, Yours (one plain-English permission prompt)'],
  ['Multiplayer', 'Realtime rooms: hit a player and your token goes to their gun'],
  ['Games', 'Three.js: real-time 3D, live transactions as the world'],
  ['Source', 'MIT open source on GitHub'],
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 p-2.5">
      {/* Compact hero strip */}
      <header className="panel relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/arena.jpg" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/85 to-transparent" />
        <div className="relative flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-fg drop-shadow-[0_0_14px_rgba(245,184,0,0.5)] sm:text-5xl">
              TokenBlaster<span className="text-hot">.lol</span>
              <span className="blink">_</span>
            </h1>
            <p className="text-hot sm:text-lg">Load your tokens. Blast them at the chain.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/blast" className="btn-fire inline-flex h-12 w-40 items-center justify-center !px-0 !py-0 !text-base">
              BLAST NOW
            </Link>
            <Link href="/arcade/bsvgun" className="btn-fire inline-flex h-12 w-40 items-center justify-center !px-0 !py-0 !text-base">
              BSVGUN
            </Link>
            <Link href="/arena" className="btn-fire inline-flex h-12 w-40 items-center justify-center !px-0 !py-0 !text-base">
              ARENA
            </Link>
            <Link href="/arcade" className="btn-fire inline-flex h-12 w-40 items-center justify-center !px-0 !py-0 !text-base">
              ARCADE
            </Link>
            <GitHubLink />
          </div>
        </div>
      </header>

      <Link href="/1satordnance/store" className="panel group flex flex-wrap items-center gap-3 hover:border-fg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/cards/safu-blaster.webp" alt="" className="h-20 w-20 border border-[var(--border-dim)] object-cover" />
        <div className="min-w-[14rem] flex-1">
          <p className="font-bold text-hot group-hover:underline">NEW · 1SAT ORDNANCE STORE: 22 guns you actually own</p>
          <p className="text-dim">Buy a game weapon as a real 1Sat ordinal, inscribed straight into your wallet. Hold it and it unlocks in Double-O Kweg and the Arena. Shows up in 3D in bWalletX.</p>
        </div>
        <span className="btn-fire !px-4 !py-2 !text-base">ENTER THE STORE</span>
      </Link>

      <ChainDashboard />

      {/* Games */}
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Arcade</span>
          <Link href="/arcade" className="text-dim hover:text-hot">
            all games &gt;
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GAMES.map((g) => (
            <Link key={g.title} href={g.href} className="inset group overflow-hidden hover:border-fg">
              <div className="aspect-[1200/630] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
              </div>
              <div className="p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-fg group-hover:text-hot">&gt; {g.title}</span>
                  <span className="text-xs text-accent">{g.tag}</span>
                </div>
                <p className="mt-1 text-sm text-dim">{g.blurb}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Wallets + bGames */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Your wallet is the source of truth</span>
          </div>
          <p className="text-dim">
            TokenBlaster only shows tokens your wallet itself counts as yours. Coins go back with the same notes your wallet writes, so whatever you load, fire or receive in a
            match shows up in your wallet straight away.
          </p>
          <p className="mt-2 text-sm text-dim">Works with bWallet, bWalletX and Yours (BRC-100).</p>
        </div>
        <a href="https://bitcoin-gaming.vercel.app" target="_blank" rel="noopener noreferrer" className="panel group hover:border-fg">
          <div className="panel-header">
            <span className="panel-title group-hover:text-hot">Also in bGames ↗</span>
            <span className="text-dim">bWalletX app store</span>
          </div>
          <p className="text-dim">Open bGames from the Apps tab in bWalletX and play the TokenBlaster chain games right inside your wallet, alongside Snake and 2048.</p>
        </a>
      </section>

      {/* Stack */}
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Under the hood</span>
          <a href="https://github.com/b0ase/tokenblaster.lol" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-hot">
            source ↗
          </a>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {STACK.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-24 shrink-0 text-accent">{k}</dt>
              <dd className="text-dim">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 py-3 text-xs text-muted">
        <Link href="/arcade" className="hover:text-hot">arcade</Link>
        <Link href="/arcade/bsvgun" className="hover:text-hot">bsvgun</Link>
        <Link href="/arena" className="hover:text-hot">arena</Link>
        <Link href="/1satordnance" className="hover:text-hot">1sat ordnance</Link>
        <Link href="/updates" className="hover:text-hot">updates</Link>
        <Link href="/arcade/frogger" className="hover:text-hot">chain frogger</Link>
        <Link href="/blast" className="hover:text-hot">blast</Link>
        <Link href="/viewer" className="hover:text-hot">3D viewer</Link>
        <a href="https://github.com/b0ase/tokenblaster.lol" className="hover:text-hot">github</a>
        <span>powered by GorillaPool · built on Bitcoin SV</span>
      </footer>
    </main>
  );
}
