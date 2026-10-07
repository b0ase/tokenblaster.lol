import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { MempoolInvaders } from '@/components/MempoolInvaders';

const description = 'A 3D shooter on the live BSV chain: every ship is a real transaction, token ships wear their token and drop it when shot. Combos, power-ups, boss blocks, beat-synced; or go LIVE and fire real transactions.';
export const metadata = {
  title: 'Mempool Invaders · TokenBlaster.lol',
  description,
  openGraph: { title: 'Mempool Invaders', description, url: '/arcade/invaders' },
  twitter: { card: 'summary_large_image', title: 'Mempool Invaders', description },
};

export default function InvadersPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Mempool Invaders<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Hold the line against mainnet. Every ship is a transaction that just hit the network; shoot the gold ones for their tokens, or go LIVE and make every shot a tiny real tx.</p>
      </header>
      <MempoolInvaders />
      <HighScoresPanel games={['invaders']} />
    </main>
  );
}
