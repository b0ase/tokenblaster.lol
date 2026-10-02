import Link from 'next/link';
import { Gun } from '@/components/Gun';
import { Leaderboard } from '@/components/Leaderboard';

export default function Blast() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-[#a8a8b8]">← TokenBlaster.lol</Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-3xl font-bold text-[#ffd24d]">Blast</h1>
        <p className="text-[#a8a8b8]">Load a pack, fire it at the chain for your token, and climb the board.</p>
      </header>
      <Gun />
      <Leaderboard />
    </main>
  );
}
