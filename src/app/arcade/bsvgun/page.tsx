import Link from 'next/link';
import { BSVGun } from '@/components/BSVGun';

const description = 'Blast 50,000 real BSV transactions in one go. Load once, pull the trigger, watch them hit the chain.';
export const metadata = {
  title: 'BSVGun · TokenBlaster.lol',
  description,
  openGraph: { title: 'BSVGun', description, url: '/arcade/bsvgun' },
  twitter: { card: 'summary_large_image', title: 'BSVGun', description },
};

export default function BSVGunPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            BSVGun<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Mass blaster: tens of thousands of real mainnet transactions in parallel lanes, as fast as the network takes them.</p>
      </header>
      <BSVGun />
    </main>
  );
}
