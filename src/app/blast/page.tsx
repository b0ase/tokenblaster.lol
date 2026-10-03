import Link from 'next/link';
import { GunApp } from '@/components/GunApp';
import { Highway } from '@/components/Highway';
import { Leaderboard } from '@/components/Leaderboard';

export default function Blast() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Blast<span className="blink">_</span>
          </h1>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <p className="mt-1 text-dim">Load a pack, fire it at the chain for your token, and climb the board.</p>
      </header>
      <GunApp />
      <Highway />
      <Leaderboard />
    </main>
  );
}
