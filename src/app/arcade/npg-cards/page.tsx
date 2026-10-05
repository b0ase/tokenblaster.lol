import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { NpgCards } from '@/components/NpgCards';

const description = 'Ninja Punk Girls card battle: pick your NPG girl, build a deck of NPG element cards, fight the AI or a friend online. LIVE mode: every card you play is a real BSV transaction.';
export const metadata = {
  title: 'Ninja Punk Girls: Card Battle · TokenBlaster.lol',
  description,
  openGraph: { title: 'Ninja Punk Girls: Card Battle', description, url: '/arcade/npg-cards' },
  twitter: { card: 'summary_large_image', title: 'Ninja Punk Girls: Card Battle', description },
};

export default function NpgCardsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Ninja Punk Girls: Card Battle<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Card stats come from each NPG card&apos;s six attributes. Win streaks vs the AI go on the board; send a room link to fight a friend.</p>
      </header>
      <NpgCards />
      <HighScoresPanel games={['npgcards']} label="WINS" />
    </main>
  );
}
