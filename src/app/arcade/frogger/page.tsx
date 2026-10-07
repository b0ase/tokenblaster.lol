import Link from 'next/link';

const FROGGER_CARD = { url: '/arcade/frogger.jpg', width: 1200, height: 630, alt: 'Chain Frogger on TokenBlaster.lol: cross a 3D city avenue where every vehicle is a live BSV transaction' };
import { HighScoresPanel } from '@/components/HighScores';
import { Frogger3D as Frogger } from '@/components/Frogger3D';

const description = 'Frogger where the traffic is the BSV mainnet, live: every car is a real transaction. Cross the chain.';
export const metadata = {
  title: 'Chain Frogger · TokenBlaster.lol',
  description,
  // Its own card: it used to inherit /arcade's old file-convention image, which is gone.
  openGraph: { title: 'Chain Frogger', description, url: '/arcade/frogger', images: [FROGGER_CARD] },
  twitter: { card: 'summary_large_image', title: 'Chain Frogger', description, images: [FROGGER_CARD] },
};

export default function FroggerPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Chain Frogger<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Every car is a real BSV transaction, live from mainnet. Lanes are what each one carries; token transfers show their token.</p>
      </header>
      <Frogger />
      <HighScoresPanel games={['frogger']} label="CROSSINGS" />
    </main>
  );
}
