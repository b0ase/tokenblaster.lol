import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { SatStack2048 } from '@/components/SatStack2048';

const description = 'Sat Stack 2048: slide and merge sat stacks, dust to sat to coin to vault, until you cut a 1 BSV tile. Arrows or swipe.';
export const metadata = {
  title: 'Sat Stack 2048 · TokenBlaster.lol',
  description,
  openGraph: { title: 'Sat Stack 2048', description, url: '/arcade/2048' },
  twitter: { card: 'summary_large_image', title: 'Sat Stack 2048', description },
};

export default function SatStack2048Page() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Sat Stack 2048<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">The merge puzzle with a coin purse: equal stacks of sats combine, doubling every time, up to the 1 BSV tile and beyond.</p>
      </header>
      <SatStack2048 />
      <HighScoresPanel games={['sats2048']} />
    </main>
  );
}
