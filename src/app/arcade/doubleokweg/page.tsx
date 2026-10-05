import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { DoubleO } from '@/components/DoubleO';
import { GitHubLink } from '@/components/GitHubLink';

const description = 'A GoldenEye-style 3D spy shooter. Special Agent Kweg Wong fires PNEE (or any token in your wallet) at cartoon crypto villains: every bullet is one token in a real BSV transaction.';
export const metadata = {
  title: 'Double-O Kweg · TokenBlaster.lol',
  description,
  openGraph: { title: 'Double-O Kweg', description, url: '/arcade/doubleokweg' },
  twitter: { card: 'summary_large_image', title: 'Double-O Kweg', description },
};

export default function DoubleOPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Double-O Kweg<span className="blink">_</span>
          </h1>
          <span className="flex items-center gap-3">
            <GitHubLink />
            <Link href="/arcade" className="text-dim hover:text-hot">
              &lt; Arcade
            </Link>
          </span>
        </div>
        <p className="mt-1 text-dim">Licensed to blast. Five missions, parody villains, and a gadget gun that fires your tokens: practice off-chain, or go LIVE and every bullet is a real transaction.</p>
      </header>
      <DoubleO />
      <HighScoresPanel games={['doubleo-facility', 'doubleo-tower', 'doubleo-vault', 'doubleo-farm', 'doubleo-yacht']} titles={['Facility', 'Tower', 'Vault', 'Hash Farm', 'Yacht']} sorts={['score', 'time']} label="REKT" />
      <p className="text-center text-xs text-muted">
        Characters (CC BY 4.0, via Sketchfab): &ldquo;Business Man&rdquo; by manoeldarochadeoliveira, &ldquo;Mob_Suit&rdquo; by xdddddqwue12h31, &ldquo;Evil Robot&rdquo; by charliecatling. Villains are cartoon parodies.
      </p>
    </main>
  );
}
