import Link from 'next/link';
import { GitHubLink } from '@/components/GitHubLink';
import { ChainDashboard } from '@/components/ChainDashboard';
import { Barcode, Pictogram } from '@/components/dr';
import { SectionHead } from '@/components/dr/site';

const GAMES = [
  { href: '/arcade/doubleosatoshi', img: '/arcade/doubleo.jpg', title: 'Double-O Satoshi', tag: 'V1 · spy shooter', blurb: 'GoldenEye-style 3D missions: Special Agent Kweg Wong fires PNEE at parody crypto villains. LIVE mode: one token per bullet, one transaction per token.' },
  { href: '/arcade/bsvgun', img: '/arcade/bsvgun.jpg', title: 'BSVGun', tag: 'V1 · mass blaster', blurb: 'TeraGun-style: load once and fire 50,000 real tagged transactions in parallel lanes. Every blast counts on the leaderboard.' },
  { href: '/arena', img: '/arcade/arena.jpg', title: 'Arena', tag: 'V1 · multiplayer', blurb: 'DOOM-style maze. Load the tokens in your wallet and fire them: one token per bullet, one transaction per token. Hit another player and your token lands in their gun.' },
  { href: '/arcade/frogger', img: '/arcade/frogger.jpg', title: 'Chain Frogger', tag: 'V2 · 3D city', blurb: 'Cross a GTA-style avenue where every vehicle is a live mainnet transaction, one way from sender to receiver. Token transfers drive box trucks wearing their logo.' },
  { href: '/arcade/hopper', img: '/arcade/hopper.jpg', title: 'Block Hopper', tag: 'V1 · platformer', blurb: 'Run and jump across mainnet as it happens: every platform is a live transaction, token transfers walk out as enemies, new blocks are checkpoints.' },
  { href: '/arcade/invaders', img: '/arcade/invaders.jpg', title: 'Mempool Invaders', tag: 'V1 · shooter', blurb: 'Live transactions march down as invaders. Shoot the gold token invaders and catch the BSV-21 token they drop.' },
  { href: '/arcade/snake', img: '/arcade/snake.jpg', title: 'Token Snake', tag: 'V1 · snake', blurb: 'Eat the live chain: every bite is a transaction. Token transfers are token food you collect, TokenBlaster blasts are gold.' },
  { href: '/arcade/kweg', img: '/arcade/kweg.jpg', title: "Kweg's Expedition", tag: 'V1 · side-scroller', blurb: "Pilot Professor Kweg's pachyderm submarine through mainnet: sonar pings find hidden $KWEG, and three parody rivals race you to Satoshi's submarine coordinates." },
  { href: '/arcade/rally', img: '/arcade/rally.jpg', title: 'Token Rally', tag: 'V1 · 3D rally', blurb: 'Drift gravel stages against the live chain: every rival car is a mainnet transaction, faster the bigger the move. Handbrake, nitro, splits, high scores.' },
  { href: '/arcade/2048', img: '/arcade/2048.jpg', title: 'Sat Stack 2048', tag: 'V1 · puzzle', blurb: 'Merge equal sat stacks, doubling up from dust to a 1 BSV tile. Smooth sliding, arrows or swipe.' },
  { href: '/arcade/highway21', img: '/arcade/highway21.jpg', title: 'Highway 21M', tag: 'V1 · arcade racer', blurb: 'Beat the clock down a sunset highway: traffic coloured by transaction kind, billboards scrolling live token moves.' },
  { href: '/arcade/bubbo-bubbo', img: '/arcade/bubbo-bubbo.jpg', title: 'Coin Pop', tag: 'V1 · bubble shooter', blurb: 'Aim the cannon and pop token coins in groups of three: bombs, super coins and a ceiling that keeps coming. 10p a game or practice free.' },
  { href: '/arcade/puzzling-potions', img: '/arcade/puzzling-potions.jpg', title: 'Token Potions', tag: 'V1 · match-3', blurb: 'Swap potions, chain combos and build specials before the 60 seconds run out. 10p a game or practice free.' },
  { href: '/arcade/bracer', img: '/arcade/bracer.jpg', title: 'bRacer', tag: 'V1 · anti-gravity racer', blurb: 'Hover-ship racing at 700 km/h over a neon megacity: loops, corkscrews, boost pads, rockets. Every rival is a live mainnet transaction.' },
];

const STACK = [
  ['Chain', 'Bitcoin SV · BSV-21 tokens · 1Sat ordinals'],
  ['Data', 'GorillaPool JungleBus (live stream) · ordinals index · ARC broadcast'],
  ['Wallets', 'BRC-100: bWallet, bWalletX, Yours (one plain-English permission prompt)'],
  ['Multiplayer', 'Realtime rooms: hit a player and your token goes to their gun'],
  ['Games', 'Three.js: real-time 3D, live transactions as the world'],
  ['Source', 'MIT open source on GitHub'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-2.5">
      {/* Hero poster */}
      <header className="dr-poster dr-rise">
        <div className="dr-hazard" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/arena.jpg" alt="" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[38%] object-cover opacity-90 [clip-path:polygon(14%_0,100%_0,100%_100%,0_100%)] lg:block" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] bg-[var(--accent-fill)] opacity-25 mix-blend-multiply [clip-path:polygon(14%_0,100%_0,100%_100%,0_100%)] lg:block" aria-hidden />
        <div className="dr-halftone pointer-events-none absolute -left-4 bottom-0 h-1/2 w-1/2 [mask-image:linear-gradient(to_right,#000,transparent_80%)]" aria-hidden />
        <div className="relative px-3 pb-5 pt-4 sm:px-7 sm:pb-8">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="dr-code !text-[var(--accent)]">TB-001 / LIVE ON MAINNET</span>
            <span className="dr-code">TokenBlaster.lol</span>
            <span className="dr-kana text-[11px] text-[var(--muted)]" aria-hidden>
              トークン発射
            </span>
          </div>
          <h1 className="dr-display dr-mega max-w-[16ch] text-hot lg:max-w-[58%]">
            Load your tokens<span className="text-[var(--accent)]">.</span> Blast the chain<span className="text-[var(--accent)]">.</span>
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="dr-sticker text-base sm:text-xl">Every bullet = 1 real BSV tx</span>
            <span className="dr-sticker dr-sticker-red text-xs sm:text-sm">No fake coins</span>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3 sm:gap-4">
            <Link href="/blast" className="btn-fire inline-flex items-center justify-center !text-xl sm:!text-2xl">
              Blast now &raquo;
            </Link>
            <Link href="/arcade/bsvgun" className="btn-fire inline-flex items-center justify-center !bg-[var(--panel)] !bg-none !text-xl !text-[var(--hot)] sm:!text-2xl">
              BSVGun
            </Link>
            <Link href="/arena" className="btn-fire inline-flex items-center justify-center !bg-[var(--panel)] !bg-none !text-xl !text-[var(--hot)] sm:!text-2xl">
              Arena
            </Link>
            <Link href="/launch" className="btn-fire inline-flex items-center justify-center !bg-[var(--panel)] !bg-none !text-xl !text-[var(--hot)] sm:!text-2xl">
              BlastPad
            </Link>
            <GitHubLink />
          </div>
        </div>
        <div className="dr-chev opacity-90" aria-hidden />
      </header>

      {/* The arcade, unmissable (owner, 7 Oct 2026: "if there is a link, I can't see it"). */}
      <Link href="/arcade" className="dr-poster group dr-rise block transition-shadow hover:shadow-[8px_8px_0_var(--accent-fill)]">
        <div className="dr-hazard-2" aria-hidden />
        <div className="relative flex flex-col gap-4 p-3 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="dr-code !text-[var(--accent)]">TB-002 / ARCADE / {GAMES.length} GAMES</p>
              <p className="dr-display text-[clamp(40px,8vw,88px)] text-hot group-hover:text-[var(--accent)]">
                <span aria-hidden>▶ </span>Play the arcade
              </p>
              <p className="mt-1 max-w-2xl text-dim">{GAMES.length} games built on the live chain: Arena, Double-O Satoshi, Chain Frogger and more.</p>
            </div>
            <span className="btn-fire !px-6 !py-3 !text-xl">Enter the arcade &raquo;</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {GAMES.slice(0, 8).map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={g.href} src={g.img} alt={g.title} className="aspect-video w-full border-2 border-[var(--border)] object-cover grayscale transition group-hover:grayscale-0" />
            ))}
          </div>
        </div>
      </Link>

      <Link href="/1satordnance/store" className="dr-poster group dr-rise flex flex-wrap items-stretch transition-shadow hover:shadow-[8px_8px_0_var(--accent-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/cards/safu-blaster.webp" alt="" className="h-28 w-28 shrink-0 border-r-2 border-[var(--border)] object-cover sm:h-36 sm:w-36" />
        <div className="flex min-w-[14rem] flex-1 flex-col justify-center gap-1 p-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="dr-sticker text-xs">New</span>
            <span className="dr-code">1Sat Ordnance / Q Branch</span>
          </div>
          <p className="dr-display text-[clamp(26px,4.4vw,44px)] text-hot group-hover:text-[var(--accent)]">22 guns you actually own</p>
          <p className="text-dim">Buy a game weapon as a real 1Sat ordinal, inscribed straight into your wallet. Hold it and it unlocks in Double-O Satoshi and the Arena. Shows up in 3D in bWalletX.</p>
        </div>
        <div className="flex items-center p-3 sm:p-5">
          <span className="btn-fire !px-4 !py-2 !text-lg">Enter the store &raquo;</span>
        </div>
      </Link>

      <ChainDashboard />

      {/* Games */}
      <section aria-label="Arcade" className="flex flex-col gap-3">
        <SectionHead
          n="01"
          right={
            <Link href="/arcade" className="text-dim hover:text-[var(--accent)] hover:underline">
              all games &gt;&gt;
            </Link>
          }
        >
          Arcade
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GAMES.map((g, i) => (
            <Link key={g.title} href={g.href} className="group relative flex flex-col border-2 border-[var(--border)] bg-panel transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-[var(--hot)] hover:shadow-[5px_5px_0_var(--accent-fill)]">
              <div className="relative aspect-[1200/630] overflow-hidden border-b-2 border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                <span className="dr-display absolute left-0 top-0 bg-[var(--accent-fill)] px-2 py-0.5 text-lg text-[var(--on-accent)]">{pad(i + 1)}</span>
                <span className="dr-sticker absolute bottom-2 right-2 text-[11px]">{g.tag.split(' · ')[1] ?? g.tag}</span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <span className="dr-code">
                  TB-{pad(i + 1)} / {g.tag.split(' · ')[0]}
                </span>
                <span className="dr-display mt-1 text-[26px] text-hot group-hover:text-[var(--accent)]">{g.title}</span>
                <p className="mt-2 text-[13px] text-dim">{g.blurb}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Wallets + bGames */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Your wallet is the source of truth</span>
            <Pictogram name="shield" size={20} colour="var(--accent)" />
          </div>
          <p className="text-dim">
            TokenBlaster only shows tokens your wallet itself counts as yours. Coins go back with the same notes your wallet writes, so whatever you load, fire or receive in a
            match shows up in your wallet straight away.
          </p>
          <p className="mt-2 text-sm text-dim">Works with bWallet, bWalletX and Yours (BRC-100).</p>
        </div>
        <a href="https://bitcoin-gaming.vercel.app" target="_blank" rel="noopener noreferrer" className="panel group hover:border-[var(--hot)]">
          <div className="panel-header">
            <span className="panel-title group-hover:text-[var(--accent)]">Also in bGames ↗</span>
            <span className="dr-code">bWalletX app store</span>
          </div>
          <p className="text-dim">Open bGames from the Apps tab in bWalletX and play the TokenBlaster chain games right inside your wallet, alongside Snake and 2048.</p>
        </a>
      </section>

      {/* Stack */}
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Under the hood</span>
          <div className="flex items-center gap-3">
            <Barcode seed="UNDER-THE-HOOD" h={16} w={72} colour="var(--muted)" />
            <a href="https://github.com/b0ase/tokenblaster.lol" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-[var(--accent)]">
              source ↗
            </a>
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {STACK.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-[var(--border-dim)] pb-1.5">
              <dt className="dr-display w-24 shrink-0 text-lg text-[var(--accent)]">{k}</dt>
              <dd className="text-dim">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
