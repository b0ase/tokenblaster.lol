import Link from 'next/link';
import { TokenSnake } from '@/components/TokenSnake';

const description = 'Snake on the live BSV chain: every bite is a real transaction hitting the network, token transfers are token food you collect, blasts are gold.';
export const metadata = {
  title: 'Token Snake · TokenBlaster.lol',
  description,
  openGraph: { title: 'Token Snake', description, url: '/arcade/snake' },
  twitter: { card: 'summary_large_image', title: 'Token Snake', description },
};

export default function SnakePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Token Snake<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Eat mainnet as it happens. Every bite is a transaction that just hit the network; token food is collected as loot.</p>
      </header>
      <TokenSnake />
    </main>
  );
}
