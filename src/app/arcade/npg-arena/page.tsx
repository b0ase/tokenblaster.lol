import { GameShell } from '@/components/GameShell';
import { NpgArena } from '@/components/NpgArena';

const description = 'Ninja Punk Girls Arena: a 3D one-on-one fighter on a neon rooftop dojo. Twelve Ninja Punk Girls in real motion capture: light combos, heavies, blocks, rolls, best of three rounds against the CPU or a friend.';
export const metadata = {
  title: 'Ninja Punk Girls: Arena · TokenBlaster.lol',
  description,
  openGraph: { title: 'Ninja Punk Girls: Arena', description, url: '/arcade/npg-arena' },
  twitter: { card: 'summary_large_image', title: 'Ninja Punk Girls: Arena', description },
};

export default function NpgArenaPage() {
  return (
    <GameShell game="npg-arena"
      title="Ninja Punk Girls: Arena"
      below={
        <p className="panel text-dim">
          Pick your girl and an opponent, then fight best of three. Fighter stats come from each NPG card: strength hits harder, speed moves faster, stamina adds health, skill
          shrinks block damage, stealth lengthens the roll. Animation: Quaternius Universal Animation Library (CC0).
        </p>
      }
    >
      <NpgArena />
    </GameShell>
  );
}
