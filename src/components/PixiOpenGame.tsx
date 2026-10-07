'use client';

/**
 * A PixiJS Open Game (MIT, https://github.com/pixijs/open-games) built to static files under
 * public/arcade/<slug>/ and run in an iframe on our own origin, with our coin slot and high-score
 * board around it. The page owns the money: PLAY · 10p pays a coin (src/lib/coinop.ts) and then posts
 * { tb: 'start' } to the frame; PRACTICE starts it free. The game posts back { tb: 'ready' | 'gameover'
 * | 'menu' | 'action' } (see the tb.ts patch in each game's source), same-origin only.
 *
 * LIVE blasting (optional, paid runs): each { tb: 'action' } (Coin Pop: a bubble fired; Token Potions: a valid
 * swap) is one tiny real tx (src/lib/useActionPay.ts). The frame can't wait for an answer, so when the ammo runs
 * out the page covers the game (input blocked) until the player loads more or turns LIVE off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { HighScores } from './HighScores';
import type { ScoreGame } from '@/lib/scores';
import { useActionPay } from '@/lib/useActionPay';
import { ActionAmmo, ActionHud } from './ActionAmmo';

const ACTION: Record<string, string> = { 'bubbo-bubbo': 'bubble fired', 'puzzling-potions': 'swap' };

type Phase = 'loading' | 'ready' | 'play' | 'over';
type Msg = { tb?: string; score?: number; secs?: number; a?: string };

export function PixiOpenGame({ slug, title, game, tag, blurb }: { slug: string; title: string; game: ScoreGame; tag: string; blurb: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const co = useCoinOp(title, tag);
  const ap = useActionPay(tag, title);
  const pay = ap.pay;
  const setLiveRun = ap.setRun;
  const [dry, setDry] = useState(false); // LIVE and out of ammo: the game is covered
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const [result, setResult] = useState({ score: 0, secs: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as Msg | null;
      if (!m || typeof m.tb !== 'string') return;
      if (m.tb === 'action') {
        if (!pay.current([String(m.a ?? 'action').slice(0, 16)])) setDry(true);
      } else if (m.tb === 'ready') setPhase((p) => (p === 'loading' ? 'ready' : p));
      else if (m.tb === 'menu') {
        setPhase('ready');
        setLiveRun(false);
      } else if (m.tb === 'gameover') {
        setLiveRun(false);
        setResult({ score: Math.max(0, Math.floor(Number(m.score) || 0)), secs: Math.max(0, Number(m.secs) || 0) });
        setPhase('over');
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [pay, setLiveRun]);

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
      setLiveRun(paid);
      setDry(false);
      setPhase('play');
      frame.current?.contentWindow?.postMessage({ tb: 'start' }, window.location.origin);
    },
    [co, setLiveRun],
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
        <ActionHud ap={ap} className="absolute left-1 top-1 z-10" />
        {!covered && dry && ap.live && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/90 p-3 text-center">
            <p className="text-lg font-bold text-accent">Out of ammo: load more to keep blasting.</p>
            <ActionAmmo ap={ap} actions={ACTION[slug] ?? 'action'} />
            <button className="btn btn-on" disabled={ap.armed && ap.loaded < 1} onClick={() => (setDry(false), ap.resume())}>
              {ap.armed ? 'CONTINUE' : 'CONTINUE WITHOUT LIVE'}
            </button>
          </div>
        )}
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
            {(phase === 'ready' || phase === 'over') && <ActionAmmo ap={ap} actions={ACTION[slug] ?? 'action'} />}
            {co.chooserEl}
          </div>
        )}
      </div>
      <p className="text-[10px] text-dim">{coinOpModeLabel(run.paid, co.credits)}</p>
    </section>
  );
}
