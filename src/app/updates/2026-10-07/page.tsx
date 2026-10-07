import type { Metadata } from 'next';
import Link from 'next/link';

const title = 'What we shipped: 7 Oct 2026';
const description = 'Token Rally, a new racing game. A big look-and-feel pass on the Arena, Double-O Satoshi and Satoshi City. 10p coin-op across seven arcade games, and token coins your wallet can list and send.';

export const metadata: Metadata = {
  title: `${title} · TokenBlaster.lol`,
  description,
  openGraph: { title: `TokenBlaster.lol · ${title}`, description, url: '/updates/2026-10-07', type: 'article' },
  twitter: { card: 'summary_large_image', title: `TokenBlaster.lol · ${title}`, description },
};

const COIN_OP = [
  ['/arcade/snake', 'Token Snake'],
  ['/arcade/invaders', 'Mempool Invaders'],
  ['/arcade/hopper', 'Block Hopper'],
  ['/arcade/kweg', "Kweg's Expedition"],
  ['/arcade/npg-runner', 'NPG: Erobot Uprising'],
  ['/arcade/npg-cards', 'NPG: Card Battle'],
  ['/arcade/rally', 'Token Rally'],
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

export default function Update20261007() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">TOKENBLASTER.LOL · UPDATE · 7 OCT 2026</span>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <h1 className="mt-2 text-4xl font-bold tracking-wider text-hot sm:text-6xl">
          WHAT WE SHIPPED<span className="blink">_</span>
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-fg">A new racing game, a serious glow-up for our 3D games, and the arcade goes coin-op: 10p a credit.</p>
        <ul className="mt-3 grid gap-1 text-sm text-dim sm:grid-cols-2">
          <li>▸ Token Rally: a brand new racing game</li>
          <li>▸ Arena: open-air compound, new feel and sound</li>
          <li>▸ Double-O Satoshi: big look pass, briefings, villain radio</li>
          <li>▸ Satoshi City: facades, billboards, night sky</li>
          <li>▸ 10p coin-op across seven arcade games</li>
          <li>▸ token coins your wallet can list and send</li>
        </ul>
      </header>

      <Section kicker="01 · TOKEN RALLY" title="New game: Token Rally" href="/arcade/rally" cta="PLAY TOKEN RALLY">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/rally.jpg" alt="Token Rally" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          <b>Token Rally</b> is in the arcade: a stage rally where your rivals are live BSV transactions. Proper car physics, a racing HUD and results at the end of every stage.
        </p>
        <p className="text-sm text-dim">
          Practice for free, or put in a credit for one stage run that counts on the board. The HUD tells you which you&apos;re in: <b>PAID · 1 CREDIT</b> or <b>PRACTICE</b>. Cars, scenery,
          textures and skies are CC0 (Kenney and Poly Haven).
        </p>
      </Section>

      <Section kicker="02 · ARENA" title="The Arena moves outdoors" href="/arena" cta="ENTER THE ARENA">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/arena.jpg" alt="Arena" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          The <b>Arena</b> is now an open-air ruined compound under a real sky: sunlight and soft shadows, grass, props, decals and landmarks on the horizon, with a Low/High quality toggle.
        </p>
        <p className="text-sm text-dim">
          It feels better too: hit markers, damage numbers, camera kick, damage direction, a minimap, death and respawn, a touch stick, and new sounds for hits, kills, footsteps and your heartbeat.
          New players get a short onboarding and can <b>practice fire</b> before spending anything.
        </p>
      </Section>

      <Section kicker="03 · DOUBLE-O SATOSHI" title="Licensed to look good" href="/arcade/doubleosatoshi" cta="PLAY DOUBLE-O SATOSHI">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/doubleo.jpg" alt="Double-O Satoshi" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          A big look pass on <b>Double-O Satoshi</b>: new textures for every mission, better lighting and colour, dressed-up levels, sky and sea through the windows, and a sharper-looking cast.
        </p>
        <p className="text-sm text-dim">
          Briefings are now cinematic, with portraits rendered from the 3D characters. The villains taunt you loudly over the radio, and there are more jokes. On slower graphics cards enemies were
          crawling or freezing: that&apos;s fixed, and the game adjusts its quality to keep up. Plus hit markers, enemy flinches, impact sparks, a touch pause button and smaller downloads.
        </p>
      </Section>

      <Section kicker="04 · SATOSHI CITY" title="The city lights up" href="/arcade/city" cta="VISIT SATOSHI CITY">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/city.jpg" alt="Satoshi City" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          <b>Satoshi City</b> gets brick and render facades with real windows, lit office floors, stepped tower tops, street furniture, rooftop billboards running a live ticker, lamp-lit puddles,
          stars and a moon. It picks a quality level for your device and steps down if frames slow.
        </p>
      </Section>

      <Section kicker="05 · COIN-OP" title="Insert coin: 10p a credit" href="/arcade" cta="OPEN THE ARCADE">
        <p>
          Seven arcade games are now coin-op. One credit costs 10p, paid in sats at the live rate, and buys a whole game instead of paying per shot or per jump. Practice is still there if you just
          want a go.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COIN_OP.map(([href, name]) => (
            <Link key={href} href={href} className="inset p-3 text-sm font-bold text-hot hover:border-fg hover:underline">
              {name}
            </Link>
          ))}
        </div>
        <p className="text-sm text-dim">
          A credit is a game with 3 lives in Token Snake, Mempool Invaders and Block Hopper; an expedition in Kweg&apos;s Expedition; a game in Erobot Uprising; a match against the AI in Card Battle
          (a win streak goes live only if every match in it was paid); and a stage run in Token Rally.
        </p>
      </Section>

      <Section kicker="06 · WALLETS & HOME" title="Coins your wallet can see" href="/" cta="BACK TO HOME">
        <p>
          Token coins we send now carry the 1Sat id tag, so wallets like bWalletX can list them and send them on. If you have older coins, the <Link href="/arena" className="underline hover:text-hot">Arena</Link>{' '}
          offers a one-tap fix.
        </p>
        <p className="text-sm text-dim">And the home page has a big PLAY THE ARCADE banner with the game pictures, right under the title.</p>
      </Section>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 py-3 text-xs text-muted">
        <Link href="/" className="hover:text-hot">home</Link>
        <Link href="/arcade" className="hover:text-hot">arcade</Link>
        <Link href="/arena" className="hover:text-hot">arena</Link>
        <Link href="/arcade/rally" className="hover:text-hot">token rally</Link>
        <Link href="/updates" className="hover:text-hot">updates</Link>
        <span>Bitcoin SV · every shot a real transaction · CC0 assets from Kenney and Poly Haven</span>
      </footer>
    </main>
  );
}
