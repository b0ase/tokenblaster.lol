import Link from 'next/link';
import { GitHubLink } from '@/components/GitHubLink';
import { Highway } from '@/components/Highway';
import { Leaderboard } from '@/components/Leaderboard';

const GAMES = [
  { href: '/arena', img: '/arcade/arena.jpg', title: 'Arena', tag: 'V1 · multiplayer', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: one token per bullet, one transaction per token. Hit another player and your token lands in their gun.' },
  { href: '/arcade/frogger', img: '/arcade/frogger.jpg', title: 'Chain Frogger', tag: 'V2 · 3D city', blurb: 'Cross a GTA-style avenue where every vehicle is a live mainnet transaction, one way from sender to receiver. Token transfers drive box trucks wearing their logo.' },
  { href: '/arcade', img: '/arcade/npg.jpg', title: 'More in the Arcade', tag: 'coming soon', blurb: 'Ninja Punk Girls in 3D, an open-world city, Token Rally, plus links to other builders’ BSV games.' },
];

const STEPS = [
  { n: '01', title: 'Watch the chain', body: 'The live highway streams every BSV transaction from GorillaPool JungleBus and names the tokens moving: icons and $SYMBOLS where explorers just say “tokens”.' },
  { n: '02', title: 'Load your tokens', body: 'Connect bWallet, bWalletX or Yours. Your real tokens appear, read straight from your wallet. One approval loads the tokens plus the fees to fire them into your gun.' },
  { n: '03', title: 'Blast them', body: 'Every bullet is a real BSV-21 transfer, its own transaction on chain and on bsv.lol. Unload brings anything you didn’t fire back to your wallet.' },
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
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      {/* Hero */}
      <header className="panel relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/arena.jpg" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/85 to-transparent" />
        <div className="relative flex flex-col gap-3 py-4 sm:py-8">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-4xl font-bold text-fg drop-shadow-[0_0_14px_rgba(255,48,32,0.6)] sm:text-6xl">
              TokenBlaster<span className="text-hot">.lol</span>
              <span className="blink">_</span>
            </h1>
            <GitHubLink />
          </div>
          <p className="max-w-2xl text-lg text-hot sm:text-xl">Load your tokens. Blast them at the chain.</p>
          <p className="max-w-2xl text-dim">
            A live window on Bitcoin SV, plus games where your wallet’s tokens are the ammo. Every bullet, hop and shot is a real transaction you can find on chain.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/arcade" className="btn-fire">
              ENTER THE ARCADE
            </Link>
            <Link href="/arena" className="btn btn-on px-4 py-2">
              PLAY ARENA
            </Link>
            <Link href="/blast" className="btn px-4 py-2">
              BLAST
            </Link>
          </div>
        </div>
      </header>

      <Highway />

      {/* How it works */}
      <section className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <span className="text-dim">{s.n}</span> {s.title}
              </span>
            </div>
            <p className="text-dim">{s.body}</p>
          </div>
        ))}
      </section>

      {/* Games */}
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Arcade</span>
          <Link href="/arcade" className="text-dim hover:text-hot">
            all games &gt;
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
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

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Leaderboard />
        {/* Blast */}
        <Link href="/blast" className="panel group hover:border-fg">
          <div className="panel-header">
            <span className="panel-title group-hover:text-hot">&gt; Blast</span>
            <span className="text-dim">[ENTER]</span>
          </div>
          <p className="text-dim">The original: load the gun and hold the trigger. Each blast is a tagged transaction for your token, and the leaderboard counts every one the chain confirms.</p>
          <p className="mt-2 text-sm text-accent">Most blasted tokens, live from our own indexer →</p>
        </Link>
      </div>

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
        <Link href="/arena" className="hover:text-hot">arena</Link>
        <Link href="/arcade/frogger" className="hover:text-hot">chain frogger</Link>
        <Link href="/blast" className="hover:text-hot">blast</Link>
        <Link href="/viewer" className="hover:text-hot">3D viewer</Link>
        <a href="https://github.com/b0ase/tokenblaster.lol" className="hover:text-hot">github</a>
        <span>powered by GorillaPool · built on Bitcoin SV</span>
      </footer>
    </main>
  );
}
