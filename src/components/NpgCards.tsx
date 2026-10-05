'use client';

/**
 * Ninja Punk Girls: Card Battle on TokenBlaster: the NPG card engine with a starter pool of NPG
 * element cards, vs AI or online (Room 'npgcards-<slug>'). LIVE mode: every card you play is a real
 * tx (['npgcards','play']). High score = win streak vs the AI.
 */
import dynamic from 'next/dynamic';
import { useCallback, useMemo } from 'react';
import { usePaidPlay } from '@/lib/usePaidPlay';
import { sfx, type SfxName } from '@/lib/sfx';
import { deriveCard } from '@/lib/npgcards/engine';
import { CARD_IMG_BASE, RAW_CARDS } from '@/lib/npgcards/catalog';
import { heroesFor } from '@/lib/npgcards/heroes';
import { roomNet } from '@/lib/npgcards/roomNet';
import type { GameResult, SoundName } from './npgcards/CardBattle';
import { HighScores } from './HighScores';
import { ModeBadge, PaidPanel } from './PaidPanel';
import { GameAudio } from './SoundToggle';

const CardBattle = dynamic(() => import('./npgcards/CardBattle'), { ssr: false, loading: () => <div className="panel text-dim">Shuffling the deck…</div> });

const SOUND: Record<SoundName, SfxName> = { play: 'stamp', attack: 'shot', hit: 'hit', die: 'explosion', power: 'level', turn: 'click', win: 'level', lose: 'gameover', click: 'click', draw: 'pickup' };

export function NpgCards() {
  const pp = usePaidPlay('Out of sats: load more to keep playing cards.', 'npgcards');
  const payFor = pp.payFor;
  const pool = useMemo(() => RAW_CARDS.map((r) => deriveCard(r, CARD_IMG_BASE)), []);
  const heroes = useMemo(() => heroesFor(), []);
  const payPlay = useCallback(() => payFor.current(['npgcards', 'play']), [payFor]);
  const play = useCallback((n: SoundName) => sfx(SOUND[n]), []);
  const over = useCallback(
    (r: GameResult) =>
      r.vsAI && r.won ? (
        <HighScores game="npgcards" score={r.streak} secs={r.streakSecs} live={pp.paid} txid={pp.lastTx} label="WINS" meta={{ difficulty: r.difficulty ?? '' }} />
      ) : r.vsAI ? (
        <p className="text-xs text-zinc-400">Streak over. Win in a row against the AI to climb the board.</p>
      ) : null,
    [pp.paid, pp.lastTx],
  );
  return (
    <>
      <GameAudio track="arena" />
      <CardBattle
        pool={pool}
        heroes={heroes}
        storageKey="tb:npgcards"
        net={roomNet}
        roomPrefix="npgcards-"
        payPlay={payPlay}
        sfx={play}
        renderGameOver={over}
        badge={<ModeBadge pp={pp} action="card played" actions="cards" />}
      />
      <PaidPanel pp={pp} game="NPG Card Battle" action="card played" actions="cards" />
    </>
  );
}
