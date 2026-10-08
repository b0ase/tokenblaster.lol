import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { BlockHopper } from '@/components/BlockHopper';

const description = 'A 3D platformer built from the live BSV chain: every transaction is a platform, token transfers walk out as enemies, blocks are checkpoint gates, and every jump can be a tiny real transaction in LIVE mode. Wall jump, dash, stomp, outrun the reorg.';
export const metadata = {
  title: 'Block Hopper · TokenBlaster.lol',
  description,
  openGraph: { title: 'Block Hopper', description, url: '/arcade/hopper' },
  twitter: { card: 'summary_large_image', title: 'Block Hopper', description },
};

export default function HopperPage() {
  return (
    <GameShell
      title="Block Hopper"
      below={
        <>
          <p className="panel text-dim">Run and jump across mainnet as it happens. Every platform ahead of you is a real transaction that just hit the network.</p>
        <HighScoresPanel games={['hopper']} />
        </>
      }
    >
        <BlockHopper />
    </GameShell>
  );
}
