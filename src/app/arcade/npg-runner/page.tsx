import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { NpgRunner } from '@/components/NpgRunner';

const description = 'Ninja Punk Girls platformer: wall-jump, dash and throw shuriken through three stages and three Erobot bosses. Live token transfers float in as tokens to grab; in LIVE mode every jump is a real BSV transaction.';
export const metadata = {
  title: 'Ninja Punk Girls: Erobot Uprising · TokenBlaster.lol',
  description,
  openGraph: { title: 'Ninja Punk Girls: Erobot Uprising', description, url: '/arcade/npg-runner' },
  twitter: { card: 'summary_large_image', title: 'Ninja Punk Girls: Erobot Uprising', description },
};

export default function NpgRunnerPage() {
  return (
    <GameShell
      title="Ninja Punk Girls: Erobot Uprising"
      below={
        <>
          <p className="panel text-dim">The Erobots have taken Neo-Tokyo. Pick an NPG girl and fight through the docks, the Exclusion Zone and the Foundry.</p>
        <HighScoresPanel games={['npg']} />
        </>
      }
    >
        <NpgRunner />
    </GameShell>
  );
}
