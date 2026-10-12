import Link from 'next/link';
import { LiveCard } from '@/components/LiveCard';
import { LIVE_CARDS, liveCardBase } from '@/lib/npgLiveCards';

export const metadata = { title: 'Live cards · TokenBlaster.lol' };


export default function LiveCardPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Live cards<span className="blink">_</span>
          </h1>
          <Link href="/viewer" className="text-dim hover:text-hot">
            &lt; Model viewer
          </Link>
        </div>
        <p className="mt-1 text-dim">
          Canonical NPG characters as rigged 3D models standing in their own S3 cards. Click or press Space to swing, drag to
          turn them.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {LIVE_CARDS.map((c) => (
          <LiveCard key={c.slug} base={liveCardBase(c.slug)} name={c.name} box={c.box} />
        ))}
      </div>
    </main>
  );
}
