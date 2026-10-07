'use client';

/**
 * The hall of fame page body. The server hands over every period's data (cached 60 s) so the 24H / 7D / ALL switch is
 * instant and the ALL view is already in the HTML. Sections: overall ranking, per-game champions, most blasted tokens,
 * BlastPad leaders, most transactions on chain.
 */
import Link from 'next/link';
import { useState } from 'react';
import { PageHead, SectionHead } from '@/components/dr/site';
import { byTitle } from '@/lib/alpha';
import { CABINETS, HALL_PERIODS, overallRanking, type Cabinet, type CabinetBoard, type HallData, type PadCoin, type TopToken, type TxPlayer } from '@/lib/hallOfFame';
import type { ScorePeriod } from '@/lib/scores';
import { Empty, PlayerTag, ScoreLine } from './ScoreLine';

export type HallProps = {
  boards: HallData;
  tokens: Record<ScorePeriod, TopToken[]>;
  pad: PadCoin[] | null;
  tx: Record<ScorePeriod, TxPlayer[] | null>;
};

const METHOD =
  'Each game is its own championship. Placings 1 to 10 on a game’s board score 25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 points. ' +
  'A game with several boards (levels, tracks) counts a player’s best placing once. Points add up across games; ties go to the most #1s, then the most games. ' +
  'Players are identified by the name on the score, or by their X handle when the game sends one, so names are self-chosen: a green tick marks a run verified on chain and a blue tick an X handle proven with bWalletX.';

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="How the ranking works" aria-describedby="method-tip" className="dr-stamp !px-1.5 !text-[10px] text-dim hover:text-[var(--accent)] focus-visible:text-[var(--accent)]">
        How?
      </button>
      <span id="method-tip" role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-[min(22rem,80vw)] border-2 border-[var(--hot)] bg-[var(--panel)] p-2 text-left text-[11px] normal-case leading-snug tracking-normal text-dim shadow-[4px_4px_0_var(--accent-fill)] group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

function Overall({ boards, period }: { boards: HallData; period: ScorePeriod }) {
  const by: Record<string, CabinetBoard[]> = boards[period];
  const ranking = overallRanking(Object.fromEntries(Object.entries(by).map(([id, bs]) => [id, bs.map((b) => b.rows)]))).slice(0, 15);
  const title = (id: string) => CABINETS.find((c) => c.id === id)?.title ?? id;
  if (!ranking.length) return <Empty href="/arcade" />;
  return (
    <ol className="flex flex-col">
      {ranking.map((r, i) => (
        <li key={r.player.key} className={`flex items-center gap-3 border-b border-[var(--border-dim)] py-1.5 ${i === 0 ? 'bg-[var(--input)] px-2' : ''}`}>
          <span className={`dr-display w-8 shrink-0 text-right ${i === 0 ? 'text-3xl text-[var(--accent)]' : 'text-xl text-dim'}`}>{i + 1}</span>
          <span className={`min-w-0 flex-1 ${i === 0 ? 'text-lg' : 'text-sm'}`}>
            <PlayerTag row={{ name: r.player.handle ? '' : r.player.name, meta: r.player.handle ? { x: r.player.handle, xv: r.player.verified ? 1 : 0 } : {} }} size={i === 0 ? 32 : 24} />
            <span className="mt-0.5 hidden truncate text-[10px] text-dim sm:block">
              {r.best.slice(0, 4).map((b) => `${title(b.game)} #${b.rank}`).join(' · ')}
              {r.best.length > 4 ? ` · +${r.best.length - 4}` : ''}
            </span>
          </span>
          <span className="shrink-0 text-right text-[11px] leading-tight text-dim">
            <span className="block">{r.wins} × #1</span>
            <span className="block">{r.games} {r.games === 1 ? 'game' : 'games'}</span>
          </span>
          <span className="dr-display w-16 shrink-0 text-right text-2xl text-hot">
            {r.points}
            <span className="ml-0.5 text-[10px] text-dim">PTS</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function CabinetCard({ c, boards }: { c: Cabinet; boards: CabinetBoard[] }) {
  const filled = boards.filter((b) => b.rows.length);
  const lead = filled[0];
  const rest = filled.slice(1);
  const share = lead ? `https://x.com/intent/post?text=${encodeURIComponent(`${playerName(lead)} is #1 in ${c.title} on TokenBlaster.lol`)}&url=${encodeURIComponent(`https://www.tokenblaster.lol/leaderboard/${lead.game}`)}` : null;
  return (
    <article className="flex flex-col border-2 border-[var(--border)] bg-panel">
      <Link href={c.href} className="group relative block aspect-[1200/315] overflow-hidden border-b-2 border-[var(--border)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.img} alt="" loading="lazy" className="h-full w-full object-cover opacity-80 transition-transform duration-300 group-hover:scale-105" />
        <span className="dr-display absolute inset-x-0 bottom-0 bg-black/75 px-2 py-0.5 text-xl text-white">{c.title}</span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        {lead ? (
          <>
            <div>
              <p className="dr-code flex items-center justify-between">
                <span>CHAMPION{boards.length > 1 ? ` · ${lead.title.replace(/^.*· /, '')}` : ''}</span>
                {share && (
                  <a href={share} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                    SHARE ↗
                  </a>
                )}
              </p>
              <ol>
                {lead.rows.slice(0, 5).map((r, i) => (
                  <ScoreLine key={r.id} rank={i + 1} row={r} unit={c.unit} big={i === 0} size={i === 0 ? 28 : 18} />
                ))}
              </ol>
            </div>
            {rest.length > 0 && (
              <ul className="flex flex-col gap-0.5 border-t border-[var(--border-dim)] pt-1.5 text-xs">
                {rest.map((b) => (
                  <li key={b.game}>
                    <Link href={`/leaderboard/${b.game}`} className="flex items-center gap-2 hover:text-[var(--accent)]">
                      <span className="min-w-0 flex-1 truncate text-dim">{b.title.replace(/^.*· /, '')}</span>
                      <span className="min-w-0 truncate text-fg">{playerName(b)}</span>
                      <span className="tabular-nums text-hot">{b.rows[0].score.toLocaleString('en-US')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/leaderboard/${lead.game}`} className="dr-code mt-auto self-end hover:text-[var(--accent)]">
              FULL BOARD &raquo;
            </Link>
          </>
        ) : (
          <div className="mt-1">
            {c.tags.length ? <Empty href={c.href} /> : <Empty href={c.href} label="No score board for this game yet." />}
          </div>
        )}
      </div>
    </article>
  );
}

const playerName = (b: CabinetBoard) => {
  const r = b.rows[0];
  const h = typeof r.meta?.x === 'string' ? r.meta.x.replace(/^@/, '') : null;
  return h ? `@${h}` : r.name;
};

function Tokens({ list }: { list: TopToken[] }) {
  if (!list.length) return <Empty href="/blast" label="No blasts yet. Be first on the board." />;
  const top = list[0].blasts;
  return (
    <ol className="flex flex-col gap-1">
      {list.map((t, i) => (
        <li key={t.tokenId} className="flex items-center gap-2 text-sm">
          <span className="dr-display w-6 text-right text-dim">{i + 1}</span>
          {t.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.icon} alt="" width={24} height={24} loading="lazy" className="h-6 w-6 shrink-0 border border-[var(--border)] object-cover" />
          ) : (
            <span className="h-6 w-6 shrink-0 border border-[var(--border)] bg-[var(--input)]" aria-hidden />
          )}
          <span className="w-20 shrink-0 truncate text-hot sm:w-28">${t.ticker}</span>
          <span className="relative h-3 min-w-0 flex-1 bg-[var(--input)]" aria-hidden>
            <span className="absolute inset-y-0 left-0 bg-[var(--accent-fill)]" style={{ width: `${Math.max(2, (t.blasts / top) * 100)}%` }} />
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums text-hot">{t.blasts.toLocaleString('en-US')}</span>
        </li>
      ))}
    </ol>
  );
}

const bsv = (sats: number) => `${(sats / 1e8).toFixed(sats >= 1e8 ? 2 : 4)} BSV`;

function PadList({ title, items, value }: { title: string; items: PadCoin[]; value: (c: PadCoin) => string }) {
  return (
    <div className="inset p-2.5">
      <p className="dr-code mb-1.5">{title}</p>
      {items.length ? (
        <ol className="flex flex-col gap-0.5 text-sm">
          {items.map((c, i) => (
            <li key={c.tokenId}>
              <Link href={`/launch/${c.tokenId}`} className="flex items-center gap-2 hover:text-[var(--accent)]">
                <span className="dr-display w-5 text-right text-dim">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://ordfs.network/${c.tokenId.split('_')[0]}_0`} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 shrink-0 border border-[var(--border)] object-cover" />
                <span className="min-w-0 flex-1 truncate text-hot">${c.sym}</span>
                <span className="tabular-nums text-fg">{value(c)}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-dim">Nothing yet.</p>
      )}
    </div>
  );
}

function Pad({ pad }: { pad: PadCoin[] | null }) {
  if (!pad) return <p className="text-xs text-dim">BlastPad leaders are unavailable right now.</p>;
  const vol = [...pad].filter((c) => c.vol24 > 0).sort((a, b) => b.vol24 - a.vol24).slice(0, 5);
  const mov = [...pad].filter((c) => c.trades24 > 0).sort((a, b) => b.change24 - a.change24).slice(0, 5);
  const hold = [...pad].filter((c) => c.holders > 0).sort((a, b) => b.holders - a.holders).slice(0, 5);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <PadList title="VOLUME · 24H" items={vol} value={(c) => bsv(c.vol24)} />
      <PadList title="BIGGEST MOVERS · 24H" items={mov} value={(c) => `${c.change24 >= 0 ? '+' : ''}${c.change24.toFixed(c.change24 >= 100 ? 0 : 1)}%`} />
      <PadList title="MOST HOLDERS" items={hold} value={(c) => `${c.holders.toLocaleString('en-US')} holders`} />
    </div>
  );
}

function TxPlayers({ list }: { list: TxPlayer[] | null }) {
  if (list === null)
    return (
      <div className="inset p-3 text-xs text-dim">
        <p className="text-sm text-hot">Waiting for the database.</p>
        <p className="mt-1">The games now report each LIVE run’s transaction count (checked against its last transaction on chain), but the tx log table is not live on the server yet. This board fills in as soon as it is.</p>
      </div>
    );
  if (!list.length) return <Empty href="/arcade" label="No LIVE transactions recorded in this period. Go LIVE and be first." />;
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {list.map((p, i) => (
        <li key={p.name} className="flex items-center gap-2">
          <span className="dr-display w-6 text-right text-dim">{i + 1}</span>
          <PlayerTag row={{ name: p.name.startsWith('@') ? '' : p.name, meta: p.name.startsWith('@') ? { x: p.name.slice(1), xv: p.idv ? 1 : 0 } : {} }} />
          <span className="ml-auto text-[11px] text-dim">{p.games} games</span>
          {p.last_txid && (
            <a href={`https://whatsonchain.com/tx/${p.last_txid}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-dim hover:underline" title="Latest transaction">
              tx
            </a>
          )}
          <span className="w-20 text-right tabular-nums text-hot">{p.txs.toLocaleString('en-US')}</span>
        </li>
      ))}
    </ol>
  );
}

export function HallBody({ boards, tokens, pad, tx }: HallProps) {
  const [period, setPeriod] = useState<ScorePeriod>('all');
  const label = HALL_PERIODS.find((p) => p.id === period)!.label;
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-2.5">
      <PageHead
        title={
          <>
            Hall of fame<span className="blink text-[var(--accent)]">_</span>
          </>
        }
        code="TB-HOF / ALL GAMES"
        kana="殿堂入り"
        icon="star"
        back={['/', 'TokenBlaster.lol']}
        sub="The arcade’s best players, game by game and overall, with every verified run linked to its transaction on chain."
      >
        <div role="group" aria-label="Period" className="flex flex-wrap items-center gap-1">
          {HALL_PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} className={`btn !px-4 !py-1.5 text-sm ${period === p.id ? 'btn-on' : ''}`}>
              {p.label}
            </button>
          ))}
          <span className="dr-code ml-2" aria-live="polite">
            {period === 'all' ? 'ALL TIME' : period === '7d' ? 'LAST 7 DAYS' : 'LAST 24 HOURS'}
          </span>
        </div>
      </PageHead>

      <SectionHead n="01" right={<Tip text={METHOD} />}>
        Top players overall
      </SectionHead>
      <section className="panel" aria-label="Top players overall">
        <Overall boards={boards} period={period} />
      </section>

      <SectionHead n="02" right={<span className="dr-code">{CABINETS.length} cabinets · {label}</span>}>
        Champions by game
      </SectionHead>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {byTitle(CABINETS).map((c) => (
          <CabinetCard key={c.id} c={c} boards={boards[period][c.id] ?? []} />
        ))}
      </div>

      <SectionHead n="03" right={<span className="dr-code">{label}</span>}>
        Most blasted tokens
      </SectionHead>
      <section className="panel" aria-label="Most blasted tokens">
        <Tokens list={tokens[period]} />
        <p className="mt-2 text-right text-xs">
          <Link href="/" className="text-dim hover:text-[var(--accent)]">
            Live board on the home page &raquo;
          </Link>
        </p>
      </section>

      <SectionHead n="04" right={<Link href="/launch/leaders" className="dr-code hover:text-[var(--accent)]">ALL LEADERS &raquo;</Link>}>
        BlastPad leaders
      </SectionHead>
      <section aria-label="BlastPad leaders">
        <Pad pad={pad} />
      </section>

      <SectionHead n="05" right={<span className="dr-code">{label}</span>}>
        Most transactions on chain
      </SectionHead>
      <section className="panel" aria-label="Most transactions on chain">
        <TxPlayers list={tx[period]} />
      </section>
      <p className="text-xs text-dim">Scores refresh every minute. Verified ticks open the run’s last transaction on WhatsOnChain.</p>
    </main>
  );
}
