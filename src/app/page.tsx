import Link from 'next/link';
import { Highway } from '@/components/Highway';
import { Leaderboard } from '@/components/Leaderboard';

export default function Home() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-mono text-4xl font-bold text-[#ffd24d]">TokenBlaster.lol</h1>
        <p className="text-[#a8a8b8]">Live BSV traffic, chain games, and token-blasting competitions.</p>
      </header>
      <Highway />
      <Leaderboard />
      <nav className="grid gap-3 sm:grid-cols-2">
        <Link href="/blast" className="rounded-xl border border-[#2a2a35] bg-[#14141c] p-5 hover:border-[#ffd24d]">
          <div className="font-mono text-lg font-bold text-white">Blast →</div>
          <div className="text-sm text-[#a8a8b8]">Fire your tokens at the chain. Most confirmed in a round wins.</div>
        </Link>
        <div className="rounded-xl border border-[#2a2a35] bg-[#14141c] p-5 opacity-60">
          <div className="font-mono text-lg font-bold text-white">Arcade</div>
          <div className="text-sm text-[#a8a8b8]">Games played on live chain traffic. Coming soon.</div>
        </div>
      </nav>
    </main>
  );
}
