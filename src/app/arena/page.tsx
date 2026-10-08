import { GameShell } from '@/components/GameShell';
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
    <GameShell
      title="Arena" back="/" backLabel="HOME"
      below={
        <>
          <p className="panel text-dim">Pick a gun and a token, then mow down demons. Every bullet is a real blast on BSV. Multiplayer is next.</p>
          <GitHubLink />
        <p className="text-center text-xs text-muted">
          3D models by ArtistForge16, LxNazarov, Aleksandr, nodoxi, Rasmus, Nik Vega, Richard Speight, Manny Ruiz, curichenkow, Ferocious Industries and Jerome Angeles (CC-BY 4.0),
          Kay Lousberg and Poly Haven (CC0).{' '}
          <a href="/arena/CREDITS.md" className="text-dim hover:text-hot">
            Full credits
          </a>
        </p>
        </>
      }
    >
        <Arena />
    </GameShell>
  );
}
