import Link from 'next/link';
import { OrdnanceStore } from '@/components/OrdnanceStore';

const description = 'The 1Sat Ordnance store: buy game weapons as real 1Sat ordinals, inscribed straight into your wallet. Hold one and it unlocks in Double-O Kweg and the Arena.';
export const metadata = {
  title: 'Store · 1Sat Ordnance · TokenBlaster.lol',
  description,
  openGraph: { title: '1SAT ORDNANCE STORE: draw your weapon.', description, url: '/1satordnance/store', images: ['/1satordnance/opengraph-image.jpg'] },
  twitter: { card: 'summary_large_image', title: '1SAT ORDNANCE STORE: draw your weapon.', description, images: ['/1satordnance/opengraph-image.jpg'] },
};

export default function OrdnanceStorePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-widest text-dim">Q BRANCH · QUARTERMASTER</span>
          <Link href="/1satordnance" className="text-dim hover:text-hot">
            &lt; 1Sat Ordnance
          </Link>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-wider text-hot sm:text-5xl">
          ORDNANCE STORE<span className="blink">_</span>
        </h1>
        <p className="mt-2 max-w-2xl text-dim">
          Draw your weapon, soldier. Every gun is issued as a 1Sat ordinal inscribed straight into your wallet, in one transaction your wallet shows you first: the inscription to you, the price to TokenBlaster, the network fee to the miners. Hold it and it unlocks in Double-O Kweg and the Arena.
        </p>
      </header>
      <OrdnanceStore />
      <p className="text-center text-[10px] text-muted">
        Weapon models: CC BY 4.0 from Sketchfab by Ashe52, TastyTony, Pepego, johanpindeville, alcorerain, pasquill, Zverev, irons, valterjherson1, Waseem963 and Bl4ckGh0st (recoloured). Full list in docs/ordnance-models.md on GitHub.
      </p>
    </main>
  );
}
