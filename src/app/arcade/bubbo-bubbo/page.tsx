import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { PixiOpenGame } from '@/components/PixiOpenGame';

const description = 'Coin Pop: the PixiJS open-source bubble shooter Bubbo Bubbo, reskinned with token coins. Aim, match three coins of a kind and clear the board. 10p a game, or practice free.';
export const metadata = {
  title: 'Coin Pop · TokenBlaster.lol',
  description,
  openGraph: { title: 'Coin Pop', description, url: '/arcade/bubbo-bubbo' },
  twitter: { card: 'summary_large_image', title: 'Coin Pop', description },
};

export default function CoinPopPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Coin Pop<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Aim the cannon, shoot token coins and pop groups of three or more before the ceiling comes down. Bombs, super coins and a clock to beat.</p>
      </header>
      <PixiOpenGame slug="bubbo-bubbo" title="Coin Pop" game="bubbo" tag="bubbo" blurb="Aim with the mouse or your finger, release to shoot. Match three or more coins of a kind." />
      <HighScoresPanel games={['bubbo']} />
      <p className="text-center text-xs text-muted">
        Based on{' '}
        <a className="underline" href="https://github.com/pixijs/open-games/tree/main/bubbo-bubbo" target="_blank" rel="noreferrer">
          Bubbo Bubbo
        </a>{' '}
        by AshsHub / PixiJS (MIT), reskinned here. Art by PixiJS, font Bungee (SIL OFL), sound and music original to TokenBlaster (CC0). Full credits in{' '}
        <a className="underline" href="/arcade/bubbo-bubbo/CREDITS.md">
          CREDITS.md
        </a>
        .
      </p>
    </main>
  );
}
