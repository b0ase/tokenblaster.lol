import Link from 'next/link';

/** Blast arena (bare bones): how a round works and an empty scoreboard until the referee exists. */
export default function Blast() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-[#a8a8b8]">← TokenBlaster.lol</Link>
      <h1 className="font-mono text-3xl font-bold text-[#ffd24d]">Blast</h1>
      <ol className="list-decimal space-y-2 pl-5 text-[#d8d8e0]">
        <li>A round opens for a fixed time (for example 60 seconds).</li>
        <li>Each player fires transactions tagged with the round and their name, from the blaster.</li>
        <li>The referee counts only transactions the network accepted. Most wins.</li>
      </ol>
      <section className="rounded-xl border border-[#2a2a35] bg-[#14141c] p-5">
        <h2 className="mb-3 font-mono text-lg font-bold text-white">Scoreboard</h2>
        <p className="text-sm text-[#a8a8b8]">No rounds yet.</p>
      </section>
      <section className="rounded-xl border border-[#2a2a35] bg-[#14141c] p-5 text-sm text-[#a8a8b8]">
        <h2 className="mb-2 font-mono text-lg font-bold text-white">Blaster</h2>
        <p>
          A phone can&apos;t sign thousands of transactions a second, so blasting runs from a computer:{' '}
          <code className="text-[#ffd24d]">pnpm blast --round test --player you --count 100</code>. It is a dry run
          unless you add <code className="text-[#ffd24d]">--broadcast</code>.
        </p>
      </section>
    </main>
  );
}
