import Link from 'next/link';
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
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            BSVGun<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">
          Range: a night shooting range where payments, posts, tokens and ordinals fly as clay, ducks and coins, straight off the live chain. Blast Zone: the original mass blaster, tens of thousands of real mainnet transactions in parallel lanes.
        </p>
      </header>
      <BSVGun />
      <HighScoresPanel games={['bsvgun-range']} label="RANGE SCORE" />
    </main>
  );
}
