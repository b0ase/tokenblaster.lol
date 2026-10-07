import Link from 'next/link';
import { BRacer } from '@/components/BRacer';
import { HighScoresPanel } from '@/components/HighScores';
import { GAME_NAME, GAME_SLUG, GAME_TAGLINE } from '@/lib/hyper/brand';

const description = `${GAME_TAGLINE}: rival ships are live BSV transactions, the bigger the move the faster the ship. Loops, corkscrews, half-pipes, boost pads, weapons, barrel rolls.`;
export const metadata = {
  title: `${GAME_NAME} · TokenBlaster.lol`,
  description,
  openGraph: { title: GAME_NAME, description, url: `/arcade/${GAME_SLUG}` },
  twitter: { card: 'summary_large_image', title: GAME_NAME, description },
};

export default function BRacerPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            {GAME_NAME}
            <span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Anti-gravity racing at 700 km/h. Every rival ship is a live mainnet transaction; the biggest moves are the fastest.</p>
      </header>
      <BRacer />
      <HighScoresPanel games={['bracer-canyon', 'bracer-spiral', 'bracer-void']} titles={['GENESIS CANYON', 'ORPHAN SPIRAL', 'COINBASE VOID']} sorts={['score', 'time']} label="SCORE" />
    </main>
  );
}
