import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { TokenSnake } from '@/components/TokenSnake';

const description = 'A 3D snake that eats the live BSV chain: every bite is a transaction that just hit the network, token transfers are coins you collect, TokenBlaster blasts are gold. Combo multiplier, power-ups, block monoliths, and a LIVE mode where every bite is a tiny real transaction.';
export const metadata = {
  title: 'Token Snake · TokenBlaster.lol',
  description,
  openGraph: { title: 'Token Snake', description, url: '/arcade/snake' },
  twitter: { card: 'summary_large_image', title: 'Token Snake', description },
};

export default function SnakePage() {
  return (
    <GameShell
      title="Token Snake"
      below={
        <>
          <p className="panel text-dim">Eat mainnet as it happens in 3D. Every bite is a transaction that just hit the network; token food is collected as loot.</p>
        <HighScoresPanel games={['snake']} />
        </>
      }
    >
        <TokenSnake />
    </GameShell>
  );
}
