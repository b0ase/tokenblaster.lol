'use client';

/**
 * Sat Stack 2048: slide and merge sat stacks until you cut a 1 BSV tile (2048), then keep going.
 * Game design: Gabriele Cirulli's 2048 (MIT); this is a fresh React implementation with a sat/coin theme
 * (src/lib/sats2048.ts holds the rules). Arrows / WASD or swipe the board.
 *
 * Coin-op: PLAY · 10p buys one credit = one game (src/lib/coinop.ts). PRACTICE is free.
 * LIVE blasting (optional, paid runs only): every move is one tiny real transaction (src/lib/useActionPay.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HighScores, useRunClock } from './HighScores';
import { CoinOpButtons, useCoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';
import { ActionAmmo, ActionHud, AmmoAlerts } from './ActionAmmo';
import { useActionPay } from '@/lib/useActionPay';
import { sfx } from '@/lib/sfx';
import { best as bestTile, canMove, GOAL, move, newGame, SIZE, TIERS, type Dir, type Tile } from '@/lib/sats2048';

/** Copper -> silver -> gold -> hot red, by power of two. */
const PALETTE = [
  ['#3a2a24', '#d9b8a8'], // 2 dust
  ['#5a3a2a', '#f1d2bd'], // 4
  ['#8a4a2a', '#fff0e2'], // 8 copper
  ['#a8612f', '#fff6ea'], // 16
  ['#7d7f88', '#ffffff'], // 32 silver
  ['#a3a7b3', '#10121a'], // 64
  ['#c9a227', '#2a1c00'], // 128 gold
  ['#e6b422', '#2a1c00'], // 256
  ['#f5c518', '#2a1c00'], // 512
  ['#ff9a1f', '#2a1000'], // 1024
  ['#ff5a48', '#ffffff'], // 2048 1 BSV
  ['#ff2e63', '#ffffff'], // 4096
  ['#d81b8a', '#ffffff'], // 8192
  ['#7a3cff', '#ffffff'], // 16384
];
const style = (v: number) => PALETTE[Math.min(PALETTE.length - 1, Math.max(0, Math.log2(v) - 1))];
const fontFor = (v: number) => (v < 100 ? '10cqw' : v < 1000 ? '8cqw' : v < 10000 ? '6.5cqw' : '5.2cqw');

const KEYS: Record<string, Dir> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };

export function SatStack2048() {
  const co = useCoinOp('Sat Stack 2048', 'sats2048');
  const ap = useActionPay('sats2048', 'Sat Stack 2048');
  const pay = ap.pay;
  const setLiveRun = ap.setRun;
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [score, setScore] = useState(0);
  const [hi, setHi] = useState(0);
  const [reached, setReached] = useState(false);
  const runSecs = useRunClock(phase === 'play');
  const boardRef = useRef<HTMLDivElement>(null);
  const live = useRef({ phase, tiles, score });
  useEffect(() => {
    live.current = { phase, tiles, score };
  });

  const step = useCallback((dir: Dir) => {
    const s = live.current;
    if (s.phase !== 'play') return;
    const r = move(s.tiles, dir);
    if (!r.moved) return;
    if (!pay.current(['move', dir])) return; // LIVE: 1 tx per move
    const total = s.score + r.gained;
    live.current = { ...s, tiles: r.tiles, score: total };
    setTiles(r.tiles);
    setScore(total);
    sfx(r.gained ? 'coin' : 'pickup', r.gained ? 0.7 : 0.3);
    if (r.won) {
      setReached(true);
      sfx('level');
    }
    if (r.gained) setTimeout(() => setTiles((t) => t.filter((x) => !x.gone)), 130);
    if (!canMove(r.tiles)) {
      sfx('gameover');
      live.current.phase = 'over';
      setPhase('over');
      setLiveRun(false);
      setHi((h) => Math.max(h, total));
    }
  }, [pay, setLiveRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEYS[e.key];
      if (!d) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (live.current.phase === 'play') e.preventDefault();
      step(d);
    };
    window.addEventListener('keydown', onKey);
    const el = boardRef.current;
    let t0: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => {
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const tm = (e: TouchEvent) => {
      if (live.current.phase === 'play') e.preventDefault();
      if (!t0) return;
      const dx = e.touches[0].clientX - t0.x;
      const dy = e.touches[0].clientY - t0.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
      step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      t0 = null;
    };
    el?.addEventListener('touchstart', ts, { passive: true });
    el?.addEventListener('touchmove', tm, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      el?.removeEventListener('touchstart', ts);
      el?.removeEventListener('touchmove', tm);
    };
  }, [step]);

  const start = (paid: boolean) => {
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    setRun({ paid, txid });
    ap.setRun(paid);
    const t = newGame();
    live.current = { phase: 'play', tiles: t, score: 0 };
    setTiles(t);
    setScore(0);
    setReached(false);
    setPhase('play');
  };

  const top = bestTile(tiles);
  return (
    <section className="panel game-root">
      <GameAudio track="snake" />
      <style>{`
        @keyframes s48pop { 0% { transform: scale(0); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes s48bump { 0% { transform: scale(1) } 45% { transform: scale(1.18) } 100% { transform: scale(1) } }
        .s48-slot { position: absolute; width: 25%; height: 25%; transition: transform 110ms ease-out; will-change: transform; }
        .s48-slot.gone { z-index: 0; }
        .s48-in { position: absolute; inset: 1.6%; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 10%;
          font-weight: 800; line-height: 1; box-shadow: inset 0 2px 0 rgba(255,255,255,.22), inset 0 -3px 0 rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.5); }
        .s48-in.fresh { animation: s48pop 160ms ease-out 100ms backwards; }
        .s48-in.merged { animation: s48bump 180ms ease-out 100ms; }
        .s48-tier { font-size: 2.4cqw; font-weight: 600; letter-spacing: .08em; opacity: .75; margin-top: 3%; text-transform: uppercase; }
      `}</style>
      <div className="mx-auto flex w-full max-w-[480px] items-end justify-between gap-2 pb-2 text-sm">
        <div>
          <p className="text-2xl font-bold text-hot">SAT STACK</p>
          <p className="text-xs text-dim">Merge equal stacks. Cut a 1 BSV tile (2048) and keep going.</p>
        </div>
        <div className="flex gap-2">
          <div className="inset px-2 py-1 text-center">
            <p className="text-[10px] text-dim">SCORE</p>
            <p className="text-hot">{score.toLocaleString()}</p>
          </div>
          <div className="inset px-2 py-1 text-center">
            <p className="text-[10px] text-dim">BEST</p>
            <p className="text-hot">{Math.max(hi, score).toLocaleString()}</p>
          </div>
        </div>
      </div>
      <div
        ref={boardRef}
        className="game-stage-fit relative mx-auto w-full max-w-[480px] select-none overflow-hidden border border-[var(--border-canvas)] bg-[#150a09]"
        style={{ aspectRatio: '1 / 1', touchAction: 'none', borderRadius: 6, containerType: 'inline-size', ['--ar' as string]: 1 }}
      >
        {Array.from({ length: SIZE * SIZE }, (_, i) => (
          <div key={i} className="absolute" style={{ width: '25%', height: '25%', left: `${(i % SIZE) * 25}%`, top: `${Math.floor(i / SIZE) * 25}%` }}>
            <div className="absolute rounded-[10%] bg-[#24100e]" style={{ inset: '1.6%' }} />
          </div>
        ))}
        {tiles.map((t) => {
          const [bg, fg] = style(t.v);
          return (
            <div key={t.id} className={`s48-slot${t.gone ? ' gone' : ''}`} style={{ left: 0, top: 0, transform: `translate(${t.c * 100}%, ${t.r * 100}%)` }}>
              <div className={`s48-in${t.fresh ? ' fresh' : ''}${t.merged ? ' merged' : ''}`} style={{ background: `linear-gradient(160deg, ${bg}, ${bg}dd)`, color: fg }}>
                <span style={{ fontSize: fontFor(t.v) }}>
                  {t.v.toLocaleString('en-GB')}
                </span>
                {TIERS[t.v] && <span className="s48-tier">{TIERS[t.v]}</span>}
              </div>
            </div>
          );
        })}
        <ActionHud ap={ap} className="absolute right-1 top-1 z-10" />
        {phase === 'play' && reached && top >= GOAL && (
          <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center">
            <span className="border border-[var(--border)] bg-black/70 px-3 py-0.5 text-xs font-bold tracking-widest text-hot">1 BSV TILE · KEEP STACKING</span>
          </div>
        )}
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-3 text-center">
            <p className="text-2xl font-bold text-hot">SAT STACK 2048</p>
            <p className="text-xs text-dim">Arrows / WASD or swipe. Equal stacks merge: dust, sat, stack, coin ... all the way to 1 BSV.</p>
            <CoinOpButtons co={co} start={start} />
          </div>
        )}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-black/75 px-3 text-center">
            <p className="text-3xl font-bold text-hot">{top >= GOAL ? '1 BSV STACKED' : 'NO MOVES LEFT'}</p>
            <p className="text-sm text-fg">
              Score {score.toLocaleString()} · top tile {top.toLocaleString('en-GB')}.
            </p>
            <HighScores game="sats2048" score={score} secs={runSecs} live={run.paid} txid={run.txid} meta={run.paid ? { coinop: 1, top } : { top }} />
            <CoinOpButtons co={co} start={start} />
          </div>
        )}
      </div>
      <div className="mx-auto mt-2 flex w-full max-w-[480px] items-center justify-between text-xs text-muted">
        <span>{phase === 'play' ? (run.paid ? 'CREDIT GAME · 10p paid' : 'PRACTICE · free, nothing on chain') : 'one credit = one game'} · CREDITS: {co.credits}</span>
        {phase === 'play' && (
          <button
            className="btn px-2 py-0.5 text-xs"
            onClick={() => {
              live.current.phase = 'over';
              setPhase('over');
              ap.setRun(false);
              setHi((h) => Math.max(h, score));
            }}
          >
            END RUN
          </button>
        )}
      </div>
      <div className="mx-auto mt-2 flex w-full max-w-[480px] flex-col items-center gap-1">
        {phase !== 'play' ? <ActionAmmo ap={ap} actions="move" /> : <AmmoAlerts ap={ap} />}
      </div>
      {co.chooserEl}
    </section>
  );
}
