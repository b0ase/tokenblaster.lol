import Link from 'next/link';
import { GitHubLink } from '@/components/GitHubLink';
import { ChainDashboard } from '@/components/ChainDashboard';
import { Barcode, Pictogram } from '@/components/dr';
import { SectionHead } from '@/components/dr/site';
import { HeroShowcase } from '@/components/HeroShowcase';
import { HeroSound } from '@/components/HeroSound';
import { ArcadeGrid } from '@/components/ArcadeGrid';
import { HeroLive } from '@/components/HeroLive';
import { byTitle } from '@/lib/alpha';
import { GAMES, type Game } from '@/lib/games';

/** Every live cabinet, from the one list the arcade page uses (src/lib/games.ts), so count, order, tags and blurbs match. */
const TILES = byTitle(GAMES).filter((g): g is Game & { href: string } => g.status === 'live' && Boolean(g.href));

const STACK = [
  ['Chain', 'Bitcoin SV · BSV-21 tokens · 1Sat ordinals'],
  ['Data', 'GorillaPool JungleBus (live stream) · ordinals index · ARC broadcast'],
  ['Wallets', 'bWalletX first, then any BRC-100 wallet (bWallet, Yours and more); one plain-English permission prompt'],
  ['Multiplayer', 'Realtime rooms: hit a player and your token goes to their gun'],
  ['Games', 'Three.js: real-time 3D, live transactions as the world'],
  ['Source', 'Open source on GitHub (code MIT; brand assets reserved, see NOTICE)'],
];

export default function Home() {
  return (
    <main className="flex w-full flex-col">
      {/* Hero: full viewport below the sticky nav, edge to edge, gameplay video behind, text + corner UI overlaid */}
      <header className="dr-hero dr-rise">
        <HeroShowcase />
        {/* directional scrims: dark on the text side, clear on the art side; no flat wash */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[90%] bg-[linear-gradient(to_top,var(--panel)_10%,color-mix(in_srgb,var(--panel)_82%,transparent)_50%,transparent)] lg:hidden" aria-hidden />
        <div className="pointer-events-none absolute inset-0 z-[5] hidden bg-[linear-gradient(90deg,var(--panel)_0%,color-mix(in_srgb,var(--panel)_88%,transparent)_28%,color-mix(in_srgb,var(--panel)_40%,transparent)_52%,transparent_74%)] lg:block" aria-hidden />
        <div className="relative z-10 flex flex-1 items-end px-4 pb-20 pt-[150px] sm:px-8 lg:items-center lg:px-12 lg:pb-20 lg:pt-8">
          <div className="min-w-0 lg:max-w-[56%]">
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="dr-code !text-[var(--accent)]">TB-001 / LIVE ON MAINNET</span>
              <span className="dr-code">TokenBlaster.lol</span>
              <span className="dr-kana text-[11px] text-[var(--muted)]" aria-hidden>
                トークン発射
              </span>
            </div>
            <h1 className="dr-display dr-mega dr-skew text-hot [text-shadow:0_2px_0_var(--panel),0_0_18px_var(--panel)]">
              <span className="dr-line" style={{ ['--d' as string]: '0.05s' }}>
                Load your
              </span>
              <span className="dr-line" style={{ ['--d' as string]: '0.2s' }}>
                tokens<span className="text-[var(--accent)]">.</span>
              </span>
              <span className="dr-line" style={{ ['--d' as string]: '0.35s' }}>
                Blast the
              </span>
              <span className="dr-line" style={{ ['--d' as string]: '0.5s' }}>
                chain<span className="text-[var(--accent)]">.</span>
              </span>
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="dr-sticker text-base sm:text-xl">Every bullet = 1 real BSV tx</span>
              <span className="dr-sticker dr-sticker-red text-xs sm:text-sm">No fake coins</span>
            </div>
            <div className="mt-4"><HeroSound /></div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
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
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-9 z-10 flex justify-center" aria-hidden>
          <span className="dr-scroll dr-code !text-[var(--text)]">
            scroll<span className="dr-scroll-arrow">▼</span>
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10">
          <HeroLive />
        </div>
      </header>

      <div className="dr-chev dr-chev-march !h-[16px]" aria-hidden />
      
      {/* The arcade, unmissable (owner, 7 Oct 2026: "if there is a link, I can't see it"). */}
      <Link href="/arcade" className="dr-band dr-band-grid group dr-rise block !p-0">
        <div className="dr-hazard-2" aria-hidden />
        <div className="relative flex flex-col gap-4 px-[clamp(12px,2.6vw,64px)] py-5 sm:py-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="dr-code !text-[var(--accent)]">TB-002 / ARCADE / {TILES.length} GAMES</p>
              <p className="dr-display text-[clamp(40px,8vw,88px)] text-hot group-hover:text-[var(--accent)]">
                <span aria-hidden>▶ </span>Play the arcade
              </p>
              <p className="mt-1 max-w-2xl text-dim">{TILES.length} games built on the live chain: Arena, Double-O Satoshi, Chain Frogger and more.</p>
            </div>
            <span className="btn-fire !px-6 !py-3 !text-xl">Enter the arcade &raquo;</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
            {TILES.map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={g.href} src={g.img} alt={g.title} className="aspect-video w-full border-2 border-[var(--border)] object-cover transition group-hover:brightness-110" />
            ))}
          </div>
        </div>
      </Link>

      <Link href="/1satordnance/store" className="dr-band dr-band-grid group dr-rise flex flex-wrap items-stretch !p-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/cards/safu-blaster.webp" alt="" className="h-28 w-28 shrink-0 border-r-2 border-[var(--border)] object-cover sm:h-36 sm:w-36 lg:h-44 lg:w-44" />
        <div className="flex min-w-[14rem] flex-1 flex-col justify-center gap-1 px-[clamp(12px,2.6vw,64px)] py-3 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="dr-sticker text-xs">New</span>
            <span className="dr-code">1Sat Ordnance / Q Branch</span>
          </div>
          <p className="dr-display text-[clamp(26px,4.4vw,44px)] text-hot group-hover:text-[var(--accent)]">22 guns you actually own</p>
          <p className="text-dim">Buy a game weapon as a real 1Sat ordinal, inscribed straight into your wallet. Hold it and it unlocks in Double-O Satoshi and the Arena. Shows up in 3D in bWalletX.</p>
        </div>
        <div className="flex items-center px-[clamp(12px,2.6vw,64px)] py-3 sm:py-5">
          <span className="btn-fire !px-4 !py-2 !text-lg">Enter the store &raquo;</span>
        </div>
      </Link>

      <div className="dr-band flex flex-col gap-4">
        <ChainDashboard />
      </div>

      {/* Games */}
      <section aria-label="Arcade" className="dr-band flex flex-col gap-4">
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
        <ArcadeGrid games={TILES} />
      </section>

      {/* Wallets + bGames */}
      <section className="dr-band grid gap-4 md:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Your wallet is the source of truth</span>
            <Pictogram name="shield" size={20} colour="var(--accent)" />
          </div>
          <p className="text-dim">
            TokenBlaster only shows tokens your wallet itself counts as yours. Coins go back with the same notes your wallet writes, so whatever you load, fire or receive in a
            match shows up in your wallet straight away.
          </p>
          <p className="mt-2 text-sm text-dim">Works with bWalletX first, and any BRC-100 wallet (bWallet, Yours and more).</p>
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
      <section className="dr-band">
       <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Under the hood</span>
          <div className="flex items-center gap-3">
            <Barcode seed="UNDER-THE-HOOD" h={16} w={72} colour="var(--muted)" />
            <a href="https://github.com/b0ase/tokenblaster.lol" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-[var(--accent)]">
              source ↗
            </a>
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {STACK.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-[var(--border-dim)] pb-1.5">
              <dt className="dr-display w-24 shrink-0 text-lg text-[var(--accent)]">{k}</dt>
              <dd className="text-dim">{v}</dd>
            </div>
          ))}
        </dl>
       </div>
      </section>
    </main>
  );
}
