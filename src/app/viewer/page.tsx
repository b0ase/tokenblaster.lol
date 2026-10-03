import Link from 'next/link';
import { ModelViewer } from '@/components/ModelViewer';
import { StackBuilder } from '@/components/StackBuilder';

export const metadata = { title: 'Model viewer · TokenBlaster.lol' };

export default function ViewerPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Model viewer<span className="blink">_</span>
          </h1>
          <Link href="/arena" className="text-dim hover:text-hot">
            &lt; Arena
          </Link>
        </div>
        <p className="mt-1 text-dim">Inspect the arena&apos;s characters: orbit, zoom, play and scrub animations, walk them about.</p>
      </header>
      <StackBuilder />
      <ModelViewer />
    </main>
  );
}
