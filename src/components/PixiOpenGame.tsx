'use client';

/**
 * A PixiJS Open Game (MIT, https://github.com/pixijs/open-games) built to static files under
 * public/arcade/<slug>/ and run in an iframe on our own origin, with our coin slot and high-score
 * board around it. The page owns the money: PLAY · 10p pays a coin (src/lib/coinop.ts) and then posts
 * { tb: 'start' } to the frame; PRACTICE starts it free. The game posts back { tb: 'ready' | 'gameover'
 * | 'menu' } (see the tb.ts patch in each game's source), same-origin only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { HighScores } from './HighScores';
import type { ScoreGame } from '@/lib/scores';

type Phase = 'loading' | 'ready' | 'play' | 'over';
type Msg = { tb?: string; score?: number; secs?: number };

export function PixiOpenGame({ slug, title, game, tag, blurb }: { slug: string; title: string; game: ScoreGame; tag: string; blurb: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const co = useCoinOp(title, tag);
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const [result, setResult] = useState({ score: 0, secs: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as Msg | null;
      if (!m || typeof m.tb !== 'string') return;
      if (m.tb === 'ready') setPhase((p) => (p === 'loading' ? 'ready' : p));
      else if (m.tb === 'menu') setPhase('ready');
      else if (m.tb === 'gameover') {
        setResult({ score: Math.max(0, Math.floor(Number(m.score) || 0)), secs: Math.max(0, Number(m.secs) || 0) });
        setPhase('over');
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  // If the frame never says ready (blocked script, offline), let the player retry instead of waiting forever.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => setStuck(true), 20_000);
    return () => clearTimeout(t);
  }, [phase, attempt]);

  const start = useCallback(
    (paid: boolean) => {
      setRun({ paid, txid: paid ? co.consume() : null });
      setPhase('play');
      frame.current?.contentWindow?.postMessage({ tb: 'start' }, window.location.origin);
    },
    [co],
  );

  const covered = phase !== 'play';
  return (
    <section className="panel flex flex-col items-center gap-2">
      <div className="relative h-[min(80vh,880px)] w-full max-w-[480px] overflow-hidden border border-line bg-black">
        <iframe
          key={attempt}
          ref={frame}
          src={`/arcade/${slug}/index.html?tb=1`}
          title={title}
          allow="autoplay; fullscreen"
          className="h-full w-full border-0"
        />
        {covered && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/90 p-3 text-center">
            <h2 className="text-xl font-bold text-hot">{phase === 'over' ? 'GAME OVER' : title}</h2>
            {phase === 'loading' && (
              <>
                <p className="text-dim">{stuck ? 'The game is taking a while to load.' : 'Loading the game…'}</p>
                {stuck && (
                  <button
                    className="btn px-3 py-1 text-sm"
                    onClick={() => {
                      setStuck(false);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    RELOAD
                  </button>
                )}
              </>
            )}
            {phase === 'ready' && <p className="max-w-xs text-sm text-dim">{blurb}</p>}
            {phase === 'over' && (
              <>
                <p className="text-lg text-accent">
                  Score <span className="font-bold text-fg">{result.score.toLocaleString('en-GB')}</span>
                </p>
                <HighScores game={game} score={result.score} secs={result.secs} live={run.paid} txid={run.txid} meta={run.paid ? { coinop: 1 } : undefined} />
              </>
            )}
            {(phase === 'ready' || phase === 'over') && <CoinOpButtons co={co} start={start} perCredit="1 coin = 1 game." playLabel={phase === 'over' ? 'PLAY AGAIN' : 'PLAY'} />}
            {co.chooserEl}
          </div>
        )}
      </div>
      <p className="text-[10px] text-dim">{coinOpModeLabel(run.paid, co.credits)}</p>
    </section>
  );
}
