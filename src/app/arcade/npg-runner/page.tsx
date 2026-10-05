import Link from 'next/link';
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
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Ninja Punk Girls: Erobot Uprising<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">The Erobots have taken Neo-Tokyo. Pick an NPG girl and fight through the docks, the Exclusion Zone and the Foundry.</p>
      </header>
      <NpgRunner />
      <HighScoresPanel games={['npg']} />
    </main>
  );
}
