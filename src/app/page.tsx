import Link from 'next/link';
import { Highway } from '@/components/Highway';
import { Leaderboard } from '@/components/Leaderboard';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            TokenBlaster.lol<span className="blink">_</span>
          </h1>
          <span className="text-dim">live BSV traffic · chain games · token blasting</span>
        </div>
      </header>
      <Highway />
      <Leaderboard />
      <nav className="grid gap-3 sm:grid-cols-2">
        <Link href="/blast" className="panel group hover:border-fg">
          <div className="panel-header">
            <span className="panel-title group-hover:text-hot">&gt; Blast</span>
            <span className="text-dim">[ENTER]</span>
          </div>
          <div className="text-dim">Fire your tokens at the chain. Most confirmed in a round wins.</div>
        </Link>
        <Link href="/arena" className="panel group hover:border-fg">
          <div className="panel-header">
            <span className="panel-title group-hover:text-hot">&gt; Arena</span>
            <span className="text-dim">[ENTER]</span>
          </div>
          <div className="text-dim">DOOM-style maze. Hunt drones with your token, every shot a real blast. Multiplayer soon.</div>
        </Link>
      </nav>
      <footer className="py-2 text-center text-xs text-muted">
        free entry · bragging rights only · no prizes, no fees
      </footer>
    </main>
  );
}
