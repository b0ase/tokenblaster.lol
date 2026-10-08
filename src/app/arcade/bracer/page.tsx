import { GameShell } from '@/components/GameShell';
import { BRacer } from '@/components/BRacer';
import { HighScoresPanel } from '@/components/HighScores';
import { GAME_NAME, GAME_SLUG, GAME_TAGLINE } from '@/lib/hyper/brand';
import { bracerScoreGame, TRACK_LIST } from '@/lib/hyper/content';

// Boards for every track pack: normal first, then hardcore.
const BOARDS = [false, true].flatMap((hc) => TRACK_LIST.map((t) => ({ game: bracerScoreGame(t.id, hc), title: `${t.name.toUpperCase()}${hc ? ' HARDCORE' : ''}` })));

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
    <GameShell
      title={GAME_NAME}
      below={
        <>
          <p className="panel text-dim">Anti-gravity racing at 700 km/h. Every rival ship is a live mainnet transaction; the biggest moves are the fastest.</p>
        <HighScoresPanel games={BOARDS.map((b) => b.game)} titles={BOARDS.map((b) => b.title)} sorts={['score', 'time']} label="SCORE" />
        </>
      }
    >
        <BRacer />
    </GameShell>
  );
}
