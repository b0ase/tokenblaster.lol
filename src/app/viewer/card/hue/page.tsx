import Link from 'next/link';
import { HueLab } from './HueLab';

export const metadata = { title: 'Hue spinner · Live cards · TokenBlaster.lol' };

export default function HuePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Hue spinner<span className="blink">_</span>
          </h1>
          <Link href="/viewer/card" className="text-dim hover:text-hot">
            &lt; Live cards
          </Link>
        </div>
        <p className="mt-1 text-dim">
          The original NPG series spun the hue of card backgrounds and elements (and, sparingly, the assets) for variety. Spin
          all, or spin and fine-tune one card at a time.
        </p>
      </header>
      <HueLab />
    </main>
  );
}
