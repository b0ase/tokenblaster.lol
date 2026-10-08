import { RALLY_CARD, shareImages } from '@/lib/og';
import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { TokenRally } from '@/components/TokenRally';

const description = 'A 3D rally game where the rivals are live BSV transactions: the bigger the move on chain, the faster the car. Gravel, drift, handbrake, three stages.';
export const metadata = {
  title: 'Token Rally · TokenBlaster.lol',
  description,
  openGraph: { title: 'Token Rally', description, url: '/arcade/rally', images: shareImages(RALLY_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'Token Rally', description, images: shareImages(RALLY_CARD).twitter },
};

export default function RallyPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Token Rally<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Race the tokens moving on chain right now. Every rival car is a live mainnet transaction; the biggest moves are the fastest.</p>
      </header>
      <TokenRally />
      <HighScoresPanel games={['rally-forest', 'rally-desert', 'rally-snow']} titles={['MAINNET PINES', 'MEMPOOL MESA', 'ORPHAN RIDGE']} sorts={['score', 'time']} label="SCORE" />
    </main>
  );
}
