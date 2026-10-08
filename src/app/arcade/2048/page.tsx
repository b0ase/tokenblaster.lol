import { GameShell } from '@/components/GameShell';
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
    <GameShell
      title="Sat Stack 2048"
      below={
        <>
          <p className="panel text-dim">The merge puzzle with a coin purse: equal stacks of sats combine, doubling every time, up to the 1 BSV tile and beyond.</p>
        <HighScoresPanel games={['sats2048']} />
        </>
      }
    >
        <SatStack2048 />
    </GameShell>
  );
}
