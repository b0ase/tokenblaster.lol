import Link from 'next/link';
import { Arena } from '@/components/Arena';

export const metadata = { title: 'Arena · TokenBlaster.lol' };

export default function ArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Arena<span className="blink">_</span>
          </h1>
          <Link href="/" className="text-dim hover:text-hot">
            &lt; TokenBlaster.lol
          </Link>
        </div>
        <p className="mt-1 text-dim">Hunt drones with your token. Every shot is a real blast. Multiplayer is next.</p>
      </header>
      <Arena />
    </main>
  );
}
