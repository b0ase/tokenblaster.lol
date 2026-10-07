import Link from 'next/link';
import { ARENA_CARD, shareImages } from '@/lib/og';
import { Arena } from '@/components/Arena';
import { GitHubLink } from '@/components/GitHubLink';

const description = 'A DOOM-style arena where your ammo is the tokens in your wallet. Pick a gun, load your tokens, and every bullet is a real BSV transaction.';
export const metadata = {
  title: 'Arena · TokenBlaster.lol',
  description,
  openGraph: { title: 'TokenBlaster Arena', description, url: '/arena', images: shareImages(ARENA_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Arena', description, images: shareImages(ARENA_CARD).twitter },
};

export default function ArenaPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Arena<span className="blink">_</span>
          </h1>
          <span className="flex items-center gap-3">
            <GitHubLink />
            <Link href="/" className="text-dim hover:text-hot">
              &lt; TokenBlaster.lol
            </Link>
          </span>
        </div>
        <p className="mt-1 text-dim">Pick a gun and a token, then mow down demons. Every bullet is a real blast on BSV. Multiplayer is next.</p>
      </header>
      <Arena />
      <p className="text-center text-xs text-muted">
        3D models by ArtistForge16, LxNazarov, Aleksandr, nodoxi, Rasmus, Nik Vega, Richard Speight, Manny Ruiz, curichenkow, Ferocious Industries and Jerome Angeles (CC-BY 4.0),
        Kay Lousberg and Poly Haven (CC0).{' '}
        <a href="/arena/CREDITS.md" className="text-dim hover:text-hot">
          Full credits
        </a>
      </p>
    </main>
  );
}
