import { HallBody } from '@/components/hall/HallBody';
import { hallBoards, padCoins, topTokensFor, topTxPlayers } from '@/lib/hallOfFame';
import { HALL_CARD, shareImages } from '@/lib/og';
import type { ScorePeriod } from '@/lib/scores';

/** Server-rendered, rebuilt at most once a minute. */
export const revalidate = 60;

const description = 'The TokenBlaster hall of fame: top players overall, the champion of every arcade game, the most blasted tokens and the BlastPad leaders. Every verified run links to its transaction on chain.';
export const metadata = {
  title: 'Hall of Fame · TokenBlaster.lol',
  description,
  alternates: { canonical: '/leaderboard' },
  openGraph: { title: 'TokenBlaster Hall of Fame', description, url: '/leaderboard', images: shareImages(HALL_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Hall of Fame', description, images: shareImages(HALL_CARD).twitter },
};

const PERIODS: ScorePeriod[] = ['24h', '7d', 'all'];

export default async function LeaderboardPage() {
  const [boards, pad, tokens, tx] = await Promise.all([
    hallBoards(),
    padCoins(),
    Promise.all(PERIODS.map((p) => topTokensFor(p))),
    Promise.all(PERIODS.map((p) => topTxPlayers(p))),
  ]);
  const by = <T,>(list: T[]) => Object.fromEntries(PERIODS.map((p, i) => [p, list[i]])) as Record<ScorePeriod, T>;
  return <HallBody boards={boards} pad={pad} tokens={by(tokens)} tx={by(tx)} />;
}
