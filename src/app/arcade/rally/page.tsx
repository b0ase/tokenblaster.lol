import { GameShell } from '@/components/GameShell';
import { RALLY_CARD, shareImages } from '@/lib/og';
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
    <GameShell
      title="Token Rally"
      below={
        <>
          <p className="panel text-dim">Race the tokens moving on chain right now. Every rival car is a live mainnet transaction; the biggest moves are the fastest.</p>
        <HighScoresPanel games={['rally-forest', 'rally-desert', 'rally-snow']} titles={['MAINNET PINES', 'MEMPOOL MESA', 'ORPHAN RIDGE']} sorts={['score', 'time']} label="SCORE" />
        </>
      }
    >
        <TokenRally />
    </GameShell>
  );
}
