import type { Metadata } from 'next';
import Link from 'next/link';

const title = 'What we shipped: 6 Oct 2026';
const description = 'BlastPad opens: a BSV-21 launchpad with a live board, coin pages, a real trade modal and share cards. Four game coins, gold home-turf ammo, and Chain Frogger now takes $FROGGER.';

export const metadata: Metadata = {
  title: `${title} · TokenBlaster.lol`,
  description,
  openGraph: { title: `TokenBlaster.lol · ${title}`, description, url: '/updates/2026-10-06', type: 'article' },
  twitter: { card: 'summary_large_image', title: `TokenBlaster.lol · ${title}`, description },
};

const COINS = [
  ['$ARENA', '/arena', 'Arena'],
  ['$DOUBLEO', '/arcade/doubleosatoshi', 'Double-O Satoshi'],
  ['$FROGGER', '/arcade/frogger', 'Chain Frogger'],
  ['$BSVGUN', '/arcade/bsvgun', 'BSVGun'],
] as const;

function Section({ kicker, title, children, href, cta }: { kicker: string; title: string; children: React.ReactNode; href: string; cta: string }) {
  return (
    <section className="panel flex flex-col gap-2">
      <p className="text-xs tracking-widest text-dim">{kicker}</p>
      <h2 className="text-2xl font-bold text-hot sm:text-3xl">{title}</h2>
      <div className="flex flex-col gap-2 text-fg">{children}</div>
      <Link href={href} className="btn-fire mt-1 self-start !px-4 !py-2 !text-base">
        {cta}
      </Link>
    </section>
  );
}

export default function Update20261006() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">TOKENBLASTER.LOL · UPDATE · 6 OCT 2026</span>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <h1 className="mt-2 text-4xl font-bold tracking-wider text-hot sm:text-6xl">
          WHAT WE SHIPPED<span className="blink">_</span>
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-fg">BlastPad opens its doors: launch a coin, trade it, share it. Four games get their own coins, and Chain Frogger learns to hop on $FROGGER.</p>
        <ul className="mt-3 grid gap-1 text-sm text-dim sm:grid-cols-2">
          <li>▸ BlastPad: a BSV-21 launchpad on a bonding curve</li>
          <li>▸ live board, coin pages, charts and share cards</li>
          <li>▸ a real trade modal, and a Disconnect button</li>
          <li>▸ four game coins: $ARENA, $DOUBLEO, $FROGGER, $BSVGUN</li>
          <li>▸ gold home-turf ammo in the Arena and Double-O Satoshi</li>
          <li>▸ Chain Frogger: FREE / PAID cards and $FROGGER hops</li>
        </ul>
      </header>

      <Section kicker="01 · BLASTPAD" title="Launch a coin. Blast it up the curve." href="/launch" cta="OPEN BLASTPAD">
        <p>
          <b>BlastPad</b> is our BSV-21 launchpad: every coin rides a bonding curve. The board has a live trade ticker, Trending and New sidebars, a glowing King of the Hill, filter chips and
          richer coin cards with market cap, holders and trades.
        </p>
        <p className="text-sm text-dim">
          Every coin gets its own page: a curve chart with a you-are-here dot, price change over 5m/1h/6h/24h, Trades and Holders tabs, and proof of reserves that only goes green when both the BSV
          and the tokens check out on chain. Buy/Sell opens a proper trade modal that shows what you can buy and how, every coin has a share card for X, and there&apos;s now a <b>Disconnect</b>{' '}
          button for your wallet.
        </p>
      </Section>

      <Section kicker="02 · GAME COINS" title="Coins that belong to their games" href="/launch" cta="SEE THE GAME COINS">
        <p>Four games now have their own BlastPad coin. Each one is listed in its game as house ammo, first in the list with a badge, or with a link to buy it on BlastPad.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COINS.map(([coin, href, game]) => (
            <Link key={coin} href={href} className="inset group flex flex-col gap-1 p-3 hover:border-fg">
              <span className="text-xl font-bold text-hot">{coin}</span>
              <span className="text-sm text-dim group-hover:underline">{game}</span>
            </Link>
          ))}
        </div>
        <p className="text-sm text-dim">
          Home turf counts: fire <b>$ARENA</b> in the <Link href="/arena" className="underline hover:text-hot">Arena</Link> or <b>$DOUBLEO</b> in{' '}
          <Link href="/arcade/doubleosatoshi" className="underline hover:text-hot">Double-O Satoshi</Link> in LIVE play and your shots glow gold and hit 1.5x. Also fixed: the Laser-Eye Rifle now
          fires the right way round, and Double-O Kweg is back to being Double-O Satoshi.
        </p>
      </Section>

      <Section kicker="03 · CHAIN FROGGER" title="Hop on $FROGGER" href="/arcade/frogger" cta="PLAY CHAIN FROGGER">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/frogger.jpg" alt="Chain Frogger" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          <b>Chain Frogger</b> now takes <b>$FROGGER</b> as well as sats: flip the SATS / $FROGGER toggle and every hop or shot is 1 token. You choose it, the game never switches for you.
        </p>
        <p className="text-sm text-dim">
          Big <b>FREE</b> and <b>PAID</b> mode cards up front, a plain &quot;you are playing&quot; line, and a clear note that $FROGGER has to be loaded before you can move.
        </p>
      </Section>

      <Section kicker="04 · AROUND THE SITE" title="One bar to get everywhere" href="/" cta="BACK TO HOME">
        <p>
          A navigation bar on every page: Home, Blast, Arena, Arcade, BSVGun, BlastPad, 1Sat Ordnance and Updates. And the site is back in its red phosphor colours, with gold where it counts.
        </p>
      </Section>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 py-3 text-xs text-muted">
        <Link href="/" className="hover:text-hot">home</Link>
        <Link href="/launch" className="hover:text-hot">blastpad</Link>
        <Link href="/arcade/frogger" className="hover:text-hot">chain frogger</Link>
        <Link href="/arcade" className="hover:text-hot">arcade</Link>
        <Link href="/updates" className="hover:text-hot">updates</Link>
        <span>Bitcoin SV · every shot a real transaction</span>
      </footer>
    </main>
  );
}
