import { GameShell } from '@/components/GameShell';

const FROGGER_CARD = { url: '/arcade/frogger.jpg', width: 1200, height: 630, alt: 'Chain Frogger on TokenBlaster.lol: cross a 3D city avenue where every vehicle is a live BSV transaction' };
import { HighScoresPanel } from '@/components/HighScores';
import { Frogger3D as Frogger } from '@/components/Frogger3D';

const description = 'Frogger where the traffic is the BSV mainnet, live: every car is a real transaction. Cross the chain.';
export const metadata = {
  title: 'Chain Frogger · TokenBlaster.lol',
  description,
  // Its own card: it used to inherit /arcade's old file-convention image, which is gone.
  openGraph: { title: 'Chain Frogger', description, url: '/arcade/frogger', images: [FROGGER_CARD] },
  twitter: { card: 'summary_large_image', title: 'Chain Frogger', description, images: [FROGGER_CARD] },
};

export default function FroggerPage() {
  return (
    <GameShell
      title="Chain Frogger"
      below={
        <>
          <p className="panel text-dim">Every car is a real BSV transaction, live from mainnet. Lanes are what each one carries; token transfers show their token.</p>
        <HighScoresPanel games={['frogger']} label="CROSSINGS" />
        </>
      }
    >
        <Frogger />
    </GameShell>
  );
}
