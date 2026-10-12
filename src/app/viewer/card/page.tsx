import Link from 'next/link';
import { LiveCard } from '@/components/LiveCard';

export const metadata = { title: 'Live card · TokenBlaster.lol' };

export default function LiveCardPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Live card<span className="blink">_</span>
          </h1>
          <Link href="/viewer" className="text-dim hover:text-hot">
            &lt; Model viewer
          </Link>
        </div>
        <p className="mt-1 text-dim">Canonical NPG characters as 3D models standing in their own S3 cards. Phi-Phi is rigged; Aika isn&apos;t yet.</p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <LiveCard base="/npg/cards/phi-phi" name="Phi-Phi" box={[44, 157, 922, 1164]} />
        <LiveCard base="/npg/cards/aika" name="Aika" box={[243, 341, 906, 1163]} />
      </div>
    </main>
  );
}
