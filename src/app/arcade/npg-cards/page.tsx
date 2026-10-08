import { GameShell } from '@/components/GameShell';
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
    <GameShell
      title="Ninja Punk Girls: Card Battle"
      below={
        <>
          <p className="panel text-dim">Card stats come from each NPG card&apos;s six attributes. Win streaks vs the AI go on the board; send a room link to fight a friend.</p>
        <HighScoresPanel games={['npgcards']} label="WINS" />
        </>
      }
    >
        <NpgCards />
    </GameShell>
  );
}
