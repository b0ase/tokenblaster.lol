import Link from 'next/link';
import { GunArt } from '@/components/GunArt';
import { OrdnanceArsenal } from '@/components/OrdnanceArsenal';
import { ORDNANCE, isMinted } from '@/lib/ordnance';

const description = 'Weapons you actually own. Every gun is a real 1Sat ordinal inscription in your wallet: hold it and it unlocks in Double-O Kweg and the Arena. Trade it on any 1Sat marketplace.';
export const metadata = {
  title: '1Sat Ordnance · TokenBlaster.lol',
  description,
  openGraph: { title: '1SAT ORDNANCE: Weapons you actually own.', description, url: '/1satordnance' },
  twitter: { card: 'summary_large_image', title: '1SAT ORDNANCE: Weapons you actually own.', description },
};

const FAQ: { q: string; a: string }[] = [
  { q: 'What is 1Sat Ordnance?', a: 'A collection of game weapons minted as 1Sat Ordinals on Bitcoin SV. Each gun is an inscription: the art and its metadata live on chain, in a 1-satoshi output that only your key can spend.' },
  { q: 'How does a gun unlock in the games?', a: 'Connect your wallet in Double-O Kweg or the Arena. We read the ordinals your wallet holds (from the wallet itself and the GorillaPool 1Sat index). If one of them is an Ordnance inscription, that gun appears unlocked in the weapon picker. Sell or send it and it locks again.' },
  { q: 'Can I trade them?', a: 'Yes. They are standard 1Sat ordinals, so any 1Sat marketplace or wallet that shows ordinals can list, buy and send them. Nobody needs our permission, including us.' },
  { q: 'What does it cost?', a: 'Each weapon has a price by rarity, shown in the store. You pay it and the network fee in one transaction from your own wallet, which inscribes the gun straight to you. Transfers and in-game shots are real transactions too and pay their fee.' },
  { q: 'How do I get one?', a: 'Open the store, connect your wallet and press BUY. Your wallet shows the transaction (the inscription to you plus the price to TokenBlaster) and you approve it there. Once it is indexed the gun unlocks.' },
  { q: 'Does the gun change the stats?', a: 'Yes. Each weapon has its own rate of fire, pellets, spread and bolt colour, used by the Arena and (for rate of fire and the model) Double-O Kweg.' },
];

export default function OrdnancePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel relative overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">Q BRANCH · TOKENBLASTER.LOL</span>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <div className="grid items-center gap-4 py-4 md:grid-cols-[1fr_22rem]">
          <div>
            <h1 className="text-4xl font-bold leading-tight tracking-wider text-hot sm:text-6xl">
              1SAT ORDNANCE<span className="blink">_</span>
            </h1>
            <p className="mt-2 text-xl text-fg sm:text-2xl">Weapons you actually own.</p>
            <p className="mt-3 max-w-xl text-dim">
              Every gun is a real 1Sat ordinal inscription in your wallet. Own it and it unlocks in Double-O Kweg and the Arena. Sell it, send it, trade it on any 1Sat marketplace: it&apos;s yours, not a row in our database.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/1satordnance/store" className="btn-fire">
                ENTER THE STORE
              </Link>
              <a href="#catalogue" className="btn px-4 py-2 font-bold">
                CATALOGUE
              </a>
              <a href="#arsenal" className="btn px-4 py-2 font-bold">
                MY ARSENAL
              </a>
            </div>
          </div>
          <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ordnance/safu-blaster.webp" alt="The SAFU Blaster, a gold legendary 1Sat Ordnance weapon" className="h-full w-full border border-[var(--border)] object-cover shadow-[0_0_40px_rgba(245,184,0,0.25)]" />
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          ['01 · INSCRIBED', 'Each weapon is a 1Sat ordinal: the art and the stats are inscribed on Bitcoin SV, in a 1-sat output locked to your key.'],
          ['02 · UNLOCKED', 'Hold it and it unlocks in Double-O Kweg (Q Branch) and the Arena gun picker. No account, no login: your wallet is the proof.'],
          ['03 · TRADEABLE', 'List it, sell it or gift it on any 1Sat marketplace. When it leaves your wallet, it leaves your loadout.'],
        ].map(([t, d]) => (
          <div key={t} className="panel">
            <p className="font-bold text-hot">{t}</p>
            <p className="mt-1 text-dim">{d}</p>
          </div>
        ))}
      </section>

      <section id="catalogue" className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-hot">The catalogue</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ORDNANCE.map((o) => {
            const minted = isMinted(o);
            return (
              <article key={o.id} className="panel flex flex-col">
                <div className="relative -mx-2.5 -mt-2.5 mb-2 aspect-square overflow-hidden border-b border-[var(--border-dim)] bg-black">
                  <GunArt o={o} className="h-full w-full object-cover" />
                  </div>
                <div className="panel-header">
                  <span className="panel-title">&gt; {o.name}</span>
                  <Link href={`/1satordnance/store#${o.id}`} className="text-xs font-bold text-[#60ff90] hover:underline">BUY ›</Link>
                </div>
                <p className="mt-1 text-accent">{o.tagline}</p>
                <p className="mt-1 flex-1 text-sm text-dim">{o.description}</p>
                <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <div className="inset bg-black/50 p-1">
                    <dt className="text-dim">RATE</dt>
                    <dd className="font-bold text-hot">{Math.round(1000 / o.stats.fireMs)}/s</dd>
                  </div>
                  <div className="inset bg-black/50 p-1">
                    <dt className="text-dim">PELLETS</dt>
                    <dd className="font-bold text-hot">{o.stats.pellets}</dd>
                  </div>
                  <div className="inset bg-black/50 p-1">
                    <dt className="text-dim">SPREAD</dt>
                    <dd className="font-bold text-hot">{o.stats.spread < 0.01 ? 'pin' : o.stats.spread < 0.05 ? 'tight' : 'wide'}</dd>
                  </div>
                </dl>
                {minted && (
                  <a href={`https://whatsonchain.com/tx/${o.origin.split(/[._]/)[0]}`} target="_blank" rel="noopener noreferrer" className="mt-2 text-xs text-accent underline">
                    origin {o.origin.slice(0, 12)}… ↗
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <OrdnanceArsenal />

      <section className="grid gap-3 md:grid-cols-2">
        <Link href="/arcade/doubleokweg" className="panel group hover:border-fg">
          <p className="font-bold text-hot group-hover:underline">&gt; Double-O Kweg · Q Branch</p>
          <p className="mt-1 text-dim">The spy shooter. Owned ordnance shows up in Q Branch on the mission menu: pick it and Kweg carries it into the field.</p>
        </Link>
        <Link href="/arena" className="panel group hover:border-fg">
          <p className="font-bold text-hot group-hover:underline">&gt; Arena</p>
          <p className="mt-1 text-dim">The DOOM-style maze. Owned ordnance joins the gun picker next to the stock guns, with its own stats.</p>
        </Link>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">&gt; FAQ</span>
        </div>
        <div className="flex flex-col divide-y divide-[var(--border-dim)]">
          {FAQ.map((f) => (
            <details key={f.q} className="py-2">
              <summary className="cursor-pointer font-bold text-hot">{f.q}</summary>
              <p className="mt-1 text-dim">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 py-3 text-xs text-muted">
        <Link href="/" className="hover:text-hot">home</Link>
        <Link href="/arcade" className="hover:text-hot">arcade</Link>
        <Link href="/arcade/doubleokweg" className="hover:text-hot">double-o kweg</Link>
        <Link href="/arena" className="hover:text-hot">arena</Link>
        <span>1Sat Ordinals on Bitcoin SV · indexed by GorillaPool</span>
      </footer>
    </main>
  );
}
