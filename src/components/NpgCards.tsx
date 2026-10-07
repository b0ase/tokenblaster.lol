'use client';

/**
 * Ninja Punk Girls: Card Battle on TokenBlaster: the NPG card engine with a starter pool of NPG
 * element cards, vs AI or online (Room 'npgcards-<slug>'). Coin-op: INSERT COIN (10p) buys a credit,
 * one credit is one match vs the AI (src/lib/coinop.ts); PRACTICE is free and puts nothing on chain.
 * High score = win streak vs the AI, verified by the coin of the match that set it.
 */
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { sfx, type SfxName } from '@/lib/sfx';
import { deriveCard } from '@/lib/npgcards/engine';
import { CARD_IMG_BASE, RAW_CARDS } from '@/lib/npgcards/catalog';
import { heroesFor } from '@/lib/npgcards/heroes';
import { roomNet } from '@/lib/npgcards/roomNet';
import type { GameResult, SoundName } from './npgcards/CardBattle';
import { HighScores } from './HighScores';
import { InsertCoin, coinOpModeLabel, useCoinOp, type CoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';
import { streakAllPaid } from '@/lib/coinop';

const CardBattle = dynamic(() => import('./npgcards/CardBattle'), { ssr: false, loading: () => <div className="panel text-dim">Shuffling the deck…</div> });

const SOUND: Record<SoundName, SfxName> = { play: 'stamp', attack: 'shot', hit: 'hit', die: 'explosion', power: 'level', turn: 'click', win: 'level', lose: 'gameover', click: 'click', draw: 'pickup' };
const PER_CREDIT = '1 credit = 1 match vs the AI. Online matches are free.';

type Run = { paid: boolean; txid: string | null };

export function NpgCards() {
  const co = useCoinOp('NPG Card Battle', 'npgcards');
  const [credit, setCredit] = useState(false); // the next match vs the AI: a credit game (true) or practice
  const [run, setRun] = useState<Run>({ paid: false, txid: null });
  // True only while every match in the current win streak was a credit match.
  const [allPaid, setAllPaid] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pool = useMemo(() => RAW_CARDS.map((r) => deriveCard(r, CARD_IMG_BASE)), []);
  const heroes = useMemo(() => heroesFor(), []);
  const play = useCallback((n: SoundName) => sfx(SOUND[n]), []);
  /** Each match vs the AI: a credit game spends one credit (its coin's txid goes with the match). */
  const beforeStartAI = useCallback((streak: number) => {
    if (!credit) {
      setAllPaid(false);
      setRun({ paid: false, txid: null });
      setMsg(null);
      return true;
    }
    const txid = co.consume();
    if (!txid) {
      setMsg('No credits left: insert a coin, or switch to PRACTICE.');
      return false;
    }
    setAllPaid((p) => streakAllPaid(p, streak, true));
    setRun({ paid: true, txid });
    setMsg(null);
    return true;
  }, [credit, co]);
  const slot = <CoinSlot co={co} credit={credit} setCredit={setCredit} msg={msg} />;
  const over = (r: GameResult) =>
    r.vsAI ? (
      <div className="flex flex-col items-center gap-2">
        {r.won ? (
          <HighScores game="npgcards" score={r.streak} secs={r.streakSecs} live={run.paid && allPaid} txid={run.paid && allPaid ? run.txid : null} label="WINS" meta={run.paid && allPaid ? { difficulty: r.difficulty ?? '', coinop: 1 } : { difficulty: r.difficulty ?? '' }} />
        ) : null}
        {r.won && run.paid && !allPaid && <p className="text-xs text-zinc-400">This streak includes practice matches, so it posts as practice.</p>}
        {r.won ? null : (
          <p className="text-xs text-zinc-400">Streak over. Win in a row against the AI to climb the board.</p>
        )}
        {slot}
      </div>
    ) : null;
  return (
    <>
      <GameAudio track="arena" />
      <CardBattle
        pool={pool}
        heroes={heroes}
        storageKey="tb:npgcards"
        net={roomNet}
        roomPrefix="npgcards-"
        beforeStartAI={beforeStartAI}
        sfx={play}
        renderGameOver={over}
        menuExtra={slot}
        badge={
          <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex justify-center">
            <span className="border border-zinc-700 bg-black/60 px-3 py-0.5 text-xs font-bold tracking-widest text-zinc-400">{coinOpModeLabel(run.paid, co.credits)}</span>
          </div>
        }
      />
      {co.chooserEl}
    </>
  );
}

/** INSERT COIN plus the next match's mode: 1 CREDIT or PRACTICE (the VS AI buttons start it). */
function CoinSlot({ co, credit, setCredit, msg }: { co: CoinOp; credit: boolean; setCredit: (b: boolean) => void; msg: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2 font-mono">
      <InsertCoin co={co} perCredit={PER_CREDIT} />
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-xs text-zinc-400">Next match vs AI:</span>
        <button onClick={() => setCredit(true)} disabled={co.credits < 1 && !credit} aria-pressed={credit} className={`btn px-3 py-1 font-bold disabled:opacity-40 ${credit ? 'btn-on' : ''}`}>
          ▶ 1 CREDIT
        </button>
        <button onClick={() => setCredit(false)} aria-pressed={!credit} className={`btn px-3 py-1 ${!credit ? 'btn-on' : ''}`}>
          ▶ PRACTICE · FREE
        </button>
      </div>
      {msg && <p className="text-xs text-accent">{msg}</p>}
    </div>
  );
}
