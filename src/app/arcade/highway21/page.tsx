import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { Highway21 } from '@/components/Highway21';

const description = 'Highway 21M: an OutRun-style racer against the clock. Traffic is coloured by live transaction kind; billboards scroll real BSV-21 token moves.';
export const metadata = {
  title: 'Highway 21M · TokenBlaster.lol',
  description,
  openGraph: { title: 'Highway 21M', description, url: '/arcade/highway21' },
  twitter: { card: 'summary_large_image', title: 'Highway 21M', description },
};

export default function Highway21Page() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Highway 21M<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Floor it down a sunset highway: beat each checkpoint, pass the traffic (live transaction kinds), read the billboards (live token moves).</p>
      </header>
      <Highway21 />
      <HighScoresPanel games={['highway21']} />
    </main>
  );
}
