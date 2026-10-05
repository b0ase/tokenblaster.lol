import type { Metadata } from 'next';
import Link from 'next/link';

const title = 'What we shipped: 5 Oct 2026';
const description = '22 game guns as real 1Sat ordinals with their own 3D models and test-fire, ammo tokens, a Double-O Kweg spy story across five missions, new monsters, and gold everything.';

export const metadata: Metadata = {
  title: `${title} · TokenBlaster.lol`,
  description,
  openGraph: { title: `TokenBlaster.lol · ${title}`, description, url: '/updates/2026-10-05', type: 'article' },
  twitter: { card: 'summary_large_image', title: `TokenBlaster.lol · ${title}`, description },
};

const GUNS = [
  ['big-blocker', 'big-block', 'BIG BLOCKER'],
  ['hashpower-howitzer', 'hashpower-howitzer', 'Hashpower Howitzer'],
  ['genesis-blaster', 'genesis-blaster', 'Genesis Blaster'],
  ['pnee-shotgun', 'pnee-shotgun', 'PNEE Shotgun'],
  ['satoshis-sidearm', 'satoshi-sidearm', "Satoshi's Sidearm"],
  ['safu-blaster', 'safu-blaster', 'SAFU Blaster'],
  ['double-spend', 'double-spend', 'Double Spend'],
  ['op-return', 'op-return', 'OP_RETURN'],
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

export default function Update20261005() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">TOKENBLASTER.LOL · UPDATE · 5 OCT 2026</span>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <h1 className="mt-2 text-4xl font-bold tracking-wider text-hot sm:text-6xl">
          WHAT WE SHIPPED<span className="blink">_</span>
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-fg">One big day: guns you actually own, ammo tokens, a spy story, new monsters, and a whole new coat of gold.</p>
        <ul className="mt-3 grid gap-1 text-sm text-dim sm:grid-cols-2">
          <li>▸ 22 game guns as real 1Sat ordinals</li>
          <li>▸ every gun its own 3D model you can test-fire</li>
          <li>▸ ammo tokens: $9MM, $SHELLS, $BEAM, $CELLS, $RPG, $NADES</li>
          <li>▸ the PNEE Shotgun fires real PNEE</li>
          <li>▸ Double-O Kweg: 5 missions and a story</li>
          <li>▸ new monsters, city pedestrians, music player</li>
        </ul>
      </header>

      <Section kicker="01 · 1SAT ORDNANCE" title="Guns you actually own" href="/1satordnance/store" cta="ENTER THE STORE">
        <p>
          The 1Sat Ordnance store is open: 22 game weapons, each one a real 1Sat ordinal inscribed straight into your wallet in a single transaction. Hold it and it unlocks in Double-O Kweg and
          the Arena. Sell it, send it, trade it: it&apos;s yours, not a row in our database.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GUNS.map(([slug, id, name]) => (
            <Link key={slug} href={`/1satordnance/store/${slug}`} className="inset group overflow-hidden hover:border-fg" title={name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/ordnance/cards/${id}.webp`} alt={`${name} poster`} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            </Link>
          ))}
        </div>
        <p className="text-sm text-dim">
          Every gun now has its own model: revolvers, an RPG, a lever-action, a double-barrel, sci-fi blasters, a 6-barrel BIG BLOCKER. Each has its own recruitment poster. Hover one in the store to
          spin it in 3D, click to test-fire it with its own ammo (demo only), and every gun has its own page to share.
        </p>
      </Section>

      <Section kicker="02 · AMMO" title="Matching ammo, on chain" href="/1satordnance/ammo" cta="GET AMMO">
        <p>
          Each gun fires its own ammo token in LIVE play: <b>$9MM</b> for bullets, <b>$SHELLS</b> for shotguns, <b>$BEAM</b> for lasers, <b>$CELLS</b> for plasma, <b>$RPG</b> for rockets and{' '}
          <b>$NADES</b> for grenades. The <b>PNEE Shotgun fires real PNEE</b>: one cent a shot. Ammo trades on the open 1Sat market.
        </p>
        <p className="text-sm text-dim">In game every type looks and sounds different: tracers, shotgun spray, beams, plasma bolts, smoking rockets and bouncing grenades with area damage.</p>
      </Section>

      <Section kicker="03 · DOUBLE-O KWEG" title="Licensed to blast: now with a story" href="/arcade/doubleokweg" cta="PLAY DOUBLE-O KWEG">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arcade/doubleo.jpg" alt="Double-O Kweg" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        <p>
          A shadowy syndicate, <b>S.U.S.P.E.N.D.</b>, is freezing everyone&apos;s coins. Special Agent Kweg Wong works through five missions: a fake-block bunker, Seizey&apos;s casino tower, the vault
          of IOUs, a hash farm, and finally the yacht <i>Margin Call</i>. M briefs you, Q kits you out, and the villains taunt you over the radio.
        </p>
        <p className="text-sm text-dim">
          New levels with hidden intel, gold coins and adrenaline. Real animated henchmen and agents. Your 1Sat Ordnance guns in Q Branch. Co-op and versus multiplayer, and soon verified X handles
          over your opponents&apos; heads via bWalletX.
        </p>
      </Section>

      <Section kicker="04 · THE ARCADE" title="More monsters, more city, more music" href="/arcade" cta="OPEN THE ARCADE">
        <div className="grid gap-2 sm:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/arcade/arena.jpg" alt="Arena" className="w-full border border-[var(--border-dim)]" loading="lazy" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/arcade/city.jpg" alt="Satoshi City" className="w-full border border-[var(--border-dim)]" loading="lazy" />
        </div>
        <p>
          The <b>Arena</b> gets a velociraptor and a zombie horde, and your ordnance guns fire their own ammo there. <b>Satoshi City</b> gets people on its sidewalks (mind the traffic: every car is a live
          transaction). Every game now has a proper <b>music player</b>: pick a station, skip, see what&apos;s playing.
        </p>
      </Section>

      <Section kicker="05 · bWALLETX" title="Gold, and in your wallet in 3D" href="/1satordnance" cta="ABOUT 1SAT ORDNANCE">
        <p>
          TokenBlaster now wears bWalletX gold. Guns you own show up in <b>bWalletX&apos;s 3D cabinet</b>: spinning, in their real finish, straight from the chain. Your wallet is the proof, no login
          needed.
        </p>
      </Section>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 py-3 text-xs text-muted">
        <Link href="/" className="hover:text-hot">home</Link>
        <Link href="/1satordnance/store" className="hover:text-hot">store</Link>
        <Link href="/1satordnance/ammo" className="hover:text-hot">ammo</Link>
        <Link href="/arcade" className="hover:text-hot">arcade</Link>
        <span>Bitcoin SV · every shot a real transaction · models CC BY (credits on each page)</span>
      </footer>
    </main>
  );
}
