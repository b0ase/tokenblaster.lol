import Link from 'next/link';
import { BRacer } from '@/components/BRacer';
import { HighScoresPanel } from '@/components/HighScores';
import { GAME_NAME, GAME_SLUG, GAME_TAGLINE } from '@/lib/hyper/brand';

const description = `${GAME_TAGLINE}: rival ships are live BSV transactions, the bigger the move the faster the ship. Loops, corkscrews, half-pipes, boost pads, weapons, barrel rolls.`;
// The share card has its own file name, so apps that cached the old card fetch this one fresh. Give a
// redesigned card a NEW name (…-v3.jpg etc.) rather than overwriting this file.
const SHARE = {
  url: '/arcade/bracer-og-audiowide.jpg',
  width: 1200,
  height: 630,
  alt: 'bRacer on TokenBlaster.lol: the bRACER logotype in a wide racing font with a red lowercase b, over a ship at full boost on a neon megacity track, hazard stripes, chevrons and the slogan BUY NOW / BLAST MORE',
};

export const metadata = {
  title: `${GAME_NAME} · TokenBlaster.lol`,
  description,
  openGraph: { title: GAME_NAME, description, url: `/arcade/${GAME_SLUG}`, images: [SHARE] },
  twitter: { card: 'summary_large_image', title: GAME_NAME, description, images: [SHARE] },
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
      <HighScoresPanel games={['bracer-canyon', 'bracer-spiral', 'bracer-void', 'bracer-canyon-hc', 'bracer-spiral-hc', 'bracer-void-hc']} titles={['GENESIS CANYON', 'ORPHAN SPIRAL', 'COINBASE VOID', 'CANYON HARDCORE', 'SPIRAL HARDCORE', 'VOID HARDCORE']} sorts={['score', 'time']} label="SCORE" />
    </main>
  );
}
