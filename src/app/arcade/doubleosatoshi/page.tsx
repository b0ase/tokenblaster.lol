import { GameShell } from '@/components/GameShell';
import { HighScoresPanel } from '@/components/HighScores';
import { DoubleO } from '@/components/DoubleO';
import { GitHubLink } from '@/components/GitHubLink';

const description = 'A GoldenEye-style 3D spy shooter. Special Agent Kweg Wong fires PNEE (or any token in your wallet) at cartoon crypto villains: every bullet is one token in a real BSV transaction.';
export const metadata = {
  title: 'Double-O Satoshi · TokenBlaster.lol',
  description,
  openGraph: { title: 'Double-O Satoshi', description, url: '/arcade/doubleosatoshi' },
  twitter: { card: 'summary_large_image', title: 'Double-O Satoshi', description },
};

export default function DoubleOPage() {
  return (
    <GameShell
      title="Double-O Satoshi"
      below={
        <>
          <p className="panel text-dim">Licensed to blast. Five missions, parody villains, and a gadget gun that fires your tokens: practice off-chain, or go LIVE and every bullet is a real transaction.</p>
          <GitHubLink />
        <HighScoresPanel games={['doubleo-facility', 'doubleo-tower', 'doubleo-vault', 'doubleo-farm', 'doubleo-yacht']} titles={['Facility', 'Tower', 'Vault', 'Hash Farm', 'Yacht']} sorts={['score', 'time']} label="REKT" />
        <p className="text-center text-xs text-muted">
          Characters (CC BY 4.0, via Sketchfab): &ldquo;Business Man&rdquo; by manoeldarochadeoliveira, &ldquo;Mob_Suit&rdquo; by xdddddqwue12h31, &ldquo;Evil Robot&rdquo; by charliecatling. Villains are cartoon parodies.
        </p>
        </>
      }
    >
        <DoubleO />
    </GameShell>
  );
}
