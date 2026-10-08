import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { Highway21 } from '@/components/Highway21';

const description = 'Highway 21M: an OutRun-style racer against the clock. Traffic is coloured by live transaction kind; billboards scroll real BSV-21 token moves.';
export const metadata = {
  title: 'Highway 21M · TokenBlaster.lol',
  description,
  openGraph: { title: 'Highway 21M', description, url: '/arcade/highway21' },
  twitter: { card: 'summary_large_image', title: 'Highway 21M', description },
};

export default function Highway21Page() {
  return (
    <GameShell
      title="Highway 21M"
      below={
        <>
          <p className="panel text-dim">Floor it down a sunset highway: beat each checkpoint, pass the traffic (live transaction kinds), read the billboards (live token moves).</p>
        <HighScoresPanel games={['highway21']} />
        </>
      }
    >
        <Highway21 />
    </GameShell>
  );
}
