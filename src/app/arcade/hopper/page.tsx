import Link from 'next/link';
import { BlockHopper } from '@/components/BlockHopper';

const description = 'A fast side-scrolling platformer built from the live BSV chain: every transaction is ground, blasts are coins, token transfers are enemies, blocks are checkpoints.';
export const metadata = {
  title: 'Block Hopper · TokenBlaster.lol',
  description,
  openGraph: { title: 'Block Hopper', description, url: '/arcade/hopper' },
  twitter: { card: 'summary_large_image', title: 'Block Hopper', description },
};

export default function HopperPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Block Hopper<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Run and jump across mainnet as it happens. Every platform ahead of you is a real transaction that just hit the network.</p>
      </header>
      <BlockHopper />
    </main>
  );
}
