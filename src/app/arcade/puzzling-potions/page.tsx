import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { PixiOpenGame } from '@/components/PixiOpenGame';

const description = 'Token Potions: the PixiJS open-source match-3 Puzzling Potions, brewed for TokenBlaster. Swap potions, chain combos and beat the 60-second clock. 10p a game, or practice free.';
export const metadata = {
  title: 'Token Potions · TokenBlaster.lol',
  description,
  openGraph: { title: 'Token Potions', description, url: '/arcade/puzzling-potions' },
  twitter: { card: 'summary_large_image', title: 'Token Potions', description },
};

export default function TokenPotionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Token Potions<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Match three or more potions, make specials from bigger matches and chain combos into the cauldron before the 60 seconds run out.</p>
      </header>
      <PixiOpenGame slug="puzzling-potions" title="Token Potions" game="potions" tag="potions" blurb="Drag a potion onto its neighbour to swap. Match three or more in a row. Scores here count in Normal mode." />
      <HighScoresPanel games={['potions']} />
      <p className="text-center text-xs text-muted">
        Based on{' '}
        <a className="underline" href="https://github.com/pixijs/open-games/tree/main/puzzling-potions" target="_blank" rel="noreferrer">
          Puzzling Potions
        </a>{' '}
        by PixiJS (MIT), reskinned here; the Spine dragon and cauldron are replaced with static sprites. Art by PixiJS, sound and music original to TokenBlaster (CC0). Full credits in{' '}
        <a className="underline" href="/arcade/puzzling-potions/CREDITS.md">
          CREDITS.md
        </a>
        .
      </p>
    </main>
  );
}
