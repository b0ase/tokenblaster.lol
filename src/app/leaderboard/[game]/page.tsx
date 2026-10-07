import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHead, SectionHead } from '@/components/dr/site';
import { Empty, ScoreLine } from '@/components/hall/ScoreLine';
import { boardRows, cabinetOfBoard, HALL_PERIODS, playerOf } from '@/lib/hallOfFame';
import { isScoreGame, SCORE_GAMES } from '@/lib/scores';

export const revalidate = 60;
/** Boards render on first visit, then are cached and refreshed every minute. */
export const generateStaticParams = () => [];

type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props) {
  const { game } = await params;
  if (!isScoreGame(game)) return { title: 'Hall of Fame · TokenBlaster.lol' };
  const title = SCORE_GAMES[game].title;
  const top = (await boardRows(game, 'all', 1))[0];
  const description = top ? `${playerOf(top).name} holds the record in ${title}: ${top.score.toLocaleString('en-US')}. Think you can beat it? Play on the live BSV chain.` : `No record in ${title} yet. Be first on the board.`;
  // The share card comes from ./opengraph-image.tsx (the champion's name and score).
  return {
    title: `${title} · Hall of Fame · TokenBlaster.lol`,
    description,
    alternates: { canonical: `/leaderboard/${game}` },
    openGraph: { title: `${title}: Hall of Fame`, description, url: `/leaderboard/${game}` },
    twitter: { card: 'summary_large_image', title: `${title}: Hall of Fame`, description },
  };
}

export default async function BoardPage({ params }: Props) {
  const { game } = await params;
  if (!isScoreGame(game)) notFound();
  const cab = cabinetOfBoard(game);
  const href = cab?.href ?? '/arcade';
  const lists = await Promise.all(HALL_PERIODS.map((p) => boardRows(game, p.id, p.id === 'all' ? 25 : 10)));
  const champ = lists[2][0];
  const share = champ ? `https://x.com/intent/post?text=${encodeURIComponent(`${playerOf(champ).name} is #1 in ${SCORE_GAMES[game].title} on TokenBlaster.lol. Beat that.`)}&url=${encodeURIComponent(`https://www.tokenblaster.lol/leaderboard/${game}`)}` : null;
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-4 p-2.5">
      <PageHead title={SCORE_GAMES[game].title} size="h2" code={`TB-HOF / ${game.toUpperCase()}`} icon="star" back={['/leaderboard', 'Hall of fame']} sub="Top scores, with every verified run linked to its transaction on chain.">
        <div className="flex flex-wrap gap-2">
          <Link href={href} className="btn btn-on !px-4 !py-1.5">
            PLAY &raquo;
          </Link>
          {share && (
            <a href={share} target="_blank" rel="noopener noreferrer" className="btn !px-4 !py-1.5">
              SHARE THE CHAMPION ↗
            </a>
          )}
        </div>
      </PageHead>
      {HALL_PERIODS.map((p, i) => ({ p, rows: lists[i] }))
        .reverse()
        .map(({ p, rows }) => (
          <section key={p.id} className="flex flex-col gap-2">
            <SectionHead>{p.id === 'all' ? 'All time' : p.id === '7d' ? 'Last 7 days' : 'Last 24 hours'}</SectionHead>
            <div className="panel">
              {rows.length ? (
                <ol>
                  {rows.map((r, n) => (
                    <ScoreLine key={r.id} rank={n + 1} row={r} unit={cab?.unit} size={n === 0 ? 28 : 20} big={n === 0} />
                  ))}
                </ol>
              ) : (
                <Empty href={href} />
              )}
            </div>
          </section>
        ))}
    </main>
  );
}
