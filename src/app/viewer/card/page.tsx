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
        <p className="mt-1 text-dim">Phi-Phi, the canonical Erobot, as a rigged 3D model standing in her own S3 card.</p>
      </header>
      <LiveCard base="/npg/cards/phi-phi" name="Phi-Phi" />
    </main>
  );
}
