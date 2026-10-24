import { GameShell } from '@/components/GameShell';
import { FROGGER_CARD, shareImages } from '@/lib/og';

import { HighScoresPanel } from '@/components/HighScores';
import { Frogger3D as Frogger } from '@/components/Frogger3D';

const description = 'Frogger where the traffic is the BSV mainnet, live: every car is a real transaction. Cross the chain.';
export const metadata = {
  title: 'Chain Frogger · TokenBlaster.lol',
  description,
  // Its own card: it used to inherit /arcade's old file-convention image, which is gone.
  openGraph: { title: 'Chain Frogger', description, url: '/arcade/frogger', images: shareImages(FROGGER_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'Chain Frogger', description, images: shareImages(FROGGER_CARD).twitter },
};

export default function FroggerPage() {
  return (
    <GameShell game="frogger"
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
