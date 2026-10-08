import { GameShell } from '@/components/GameShell';
import { BSVGun } from '@/components/BSVGun';
import { HighScoresPanel } from '@/components/HighScores';

const description = 'A 3D night shooting range where every target is a live BSV transaction. Choose your weapon, shoot the chain, or open the Blast Zone and fire 50,000 real transactions in one go.';
export const metadata = {
  title: 'BSVGun · TokenBlaster.lol',
  description,
  openGraph: { title: 'BSVGun', description, url: '/arcade/bsvgun' },
  twitter: { card: 'summary_large_image', title: 'BSVGun', description },
};

export default function BSVGunPage() {
  return (
    <GameShell
      title="BSVGun"
      below={
        <>
          <p className="panel text-dim">Range: a night shooting range where payments, posts, tokens and ordinals fly as clay, ducks and coins, straight off the live chain. Blast Zone: the original mass blaster, tens of thousands of real mainnet transactions in parallel lanes.</p>
        <HighScoresPanel games={['bsvgun-range', 'bsvgun-versus']} titles={['RANGE', 'VERSUS']} label="SCORE" />
        </>
      }
    >
        <BSVGun />
    </GameShell>
  );
}
