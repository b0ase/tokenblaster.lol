import Link from 'next/link';
import { LiveCard, type CardBox } from '@/components/LiveCard';

export const metadata = { title: 'Live cards · TokenBlaster.lol' };

/** Canonical NPG characters as Tripo models in their S3 cards. `box` is the 2D girl's pixel box on the 961×1441 card. */
const CARDS: { slug: string; name: string; box: CardBox }[] = [
  { slug: 'phi-phi', name: 'Phi-Phi', box: [44, 157, 922, 1164] },
  { slug: 'hikaru', name: 'Hikaru', box: [182, 351, 828, 1164] },
  { slug: 'joy', name: 'Joy', box: [236, 385, 719, 1167] },
  { slug: 'yamarashii', name: 'Yamarashii', box: [203, 191, 758, 1165] },
  { slug: 'miyuki', name: 'Miyuki', box: [38, 315, 923, 1168] },
  { slug: 'payne', name: 'Payne', box: [110, 246, 848, 1169] },
  { slug: 'peggy', name: 'Peggy', box: [218, 402, 857, 1162] },
  { slug: 'scarlet', name: 'Scarlet', box: [208, 355, 754, 1167] },
  { slug: 'matoko', name: 'Matoko', box: [118, 438, 848, 1157] },
  { slug: 'ayumi', name: 'Ayumi', box: [147, 337, 829, 1163] },
  { slug: 'kimiko', name: 'Kimiko', box: [279, 414, 710, 1160] },
  { slug: 'kazuyo', name: 'Kazuyo', box: [204, 242, 763, 1177] },
  { slug: 'nao', name: 'Nao', box: [46, 380, 916, 1171] },
  { slug: 'aika', name: 'Aika', box: [243, 341, 906, 1163] },
  { slug: 'doctor', name: 'Doctor', box: [249, 389, 706, 1161] },
  // Generic Erobots: the five bot bodies in the sample Erobot outfit (the game's grunts)
  { slug: 'bot', name: 'Bot', box: [262, 449, 681, 1158] },
  { slug: 'tech', name: 'Tech', box: [262, 450, 680, 1155] },
  { slug: 'graf-bot', name: 'Graf-Bot', box: [262, 438, 680, 1155] },
  { slug: 'frog-bot', name: 'Frog-Bot', box: [262, 450, 680, 1155] },
  { slug: 'stripey-bot', name: 'Stripey-Bot', box: [262, 449, 680, 1154] },
];

export default function LiveCardPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Live cards<span className="blink">_</span>
          </h1>
          <Link href="/viewer" className="text-dim hover:text-hot">
            &lt; Model viewer
          </Link>
        </div>
        <p className="mt-1 text-dim">
          Canonical NPG characters as rigged 3D models standing in their own S3 cards. Click or press Space to swing, drag to
          turn them.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <LiveCard key={c.slug} base={`/npg/cards/${c.slug}`} name={c.name} box={c.box} />
        ))}
      </div>
    </main>
  );
}
