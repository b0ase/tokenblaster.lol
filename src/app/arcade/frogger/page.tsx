import Link from 'next/link';
import { Frogger3D as Frogger } from '@/components/Frogger3D';

const description = 'Frogger where the traffic is the BSV mainnet, live: every car is a real transaction. Cross the chain.';
export const metadata = {
  title: 'Chain Frogger · TokenBlaster.lol',
  description,
  openGraph: { title: 'Chain Frogger', description, url: '/arcade/frogger' },
  twitter: { card: 'summary_large_image', title: 'Chain Frogger', description },
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
    </main>
  );
}
