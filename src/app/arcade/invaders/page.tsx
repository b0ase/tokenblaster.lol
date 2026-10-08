import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { MempoolInvaders } from '@/components/MempoolInvaders';

const description = 'A 3D shooter on the live BSV chain: every ship is a real transaction, token ships wear their token and drop it when shot. Combos, power-ups, boss blocks, beat-synced; or go LIVE and fire real transactions.';
export const metadata = {
  title: 'Mempool Invaders · TokenBlaster.lol',
  description,
  openGraph: { title: 'Mempool Invaders', description, url: '/arcade/invaders' },
  twitter: { card: 'summary_large_image', title: 'Mempool Invaders', description },
};

export default function InvadersPage() {
  return (
    <GameShell
      title="Mempool Invaders"
      below={
        <>
          <p className="panel text-dim">Hold the line against mainnet. Every ship is a transaction that just hit the network; shoot the gold ones for their tokens, or go LIVE and make every shot a tiny real tx.</p>
        <HighScoresPanel games={['invaders']} />
        </>
      }
    >
        <MempoolInvaders />
    </GameShell>
  );
}
