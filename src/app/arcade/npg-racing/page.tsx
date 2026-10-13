import { GameShell } from '@/components/GameShell';
import { BRacer } from '@/components/BRacer';
import { HighScoresPanel } from '@/components/HighScores';
import { npgRacingScoreGame, TRACK_LIST } from '@/lib/hyper/content';

// NPG Racing is bRacer in the NPG skin: same sim, coin-op, multiplayer rooms and score boards.
const BOARDS = [false, true].flatMap((hc) => TRACK_LIST.map((t) => ({ game: npgRacingScoreGame(t.id, hc), title: `${t.name.toUpperCase()}${hc ? ' HARDCORE' : ''}` })));

const description = 'Ninja Punk Girls vs the Erobots: fat toon anti-gravity karts, NPG girls in the cockpit, and every Erobot rival is a live BSV transaction.';
const SHARE = { url: '/arcade/npg.jpg', alt: 'Ninja Punk Girls' };

export const metadata = {
  title: 'NPG Racing · TokenBlaster.lol',
  description,
  openGraph: { title: 'NPG Racing', description, url: '/arcade/npg-racing', images: [SHARE] },
  twitter: { card: 'summary_large_image', title: 'NPG Racing', description, images: [SHARE] },
};

export default function NpgRacingPage() {
  return (
    <GameShell
      title="NPG Racing"
      below={
        <>
          <p className="panel text-dim">Ninja Punk Girls race the evil Erobots. Every Erobot rides a live mainnet transaction; the biggest moves are the fastest.</p>
          <HighScoresPanel games={BOARDS.map((b) => b.game)} titles={BOARDS.map((b) => b.title)} sorts={['score', 'time']} label="SCORE" />
        </>
      }
    >
      <BRacer skin="npg" />
    </GameShell>
  );
}
