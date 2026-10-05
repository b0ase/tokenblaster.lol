import Link from 'next/link';
import { AmmoStore } from '@/components/AmmoStore';

const description = 'Ammo for 1Sat Ordnance: each gun fires its own BSV-21 ammo token in LIVE play. 9MM, SHELLS, BEAM, CELLS, RPG, NADES, and real PNEEs for the PNEE Shotgun.';
export const metadata = {
  title: 'Ammo · 1Sat Ordnance · TokenBlaster.lol',
  description,
  openGraph: { title: '1SAT ORDNANCE AMMO: load up.', description, url: '/1satordnance/ammo' },
  twitter: { card: 'summary_large_image', title: '1SAT ORDNANCE AMMO: load up.', description },
};

export default function AmmoPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">Q BRANCH · AMMO COUNTER</span>
          <Link href="/1satordnance/store" className="text-dim hover:text-hot">
            &lt; gun store
          </Link>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-wider text-hot sm:text-5xl">
          AMMO<span className="blink">_</span>
        </h1>
        <p className="mt-2 max-w-2xl text-dim">Every 1Sat Ordnance gun fires its own rounds in LIVE play: real BSV-21 tokens in your wallet, one token per bullet. The PNEE Shotgun takes real PNEEs. Stock guns still fire any token you hold.</p>
      </header>
      <AmmoStore />
    </main>
  );
}
