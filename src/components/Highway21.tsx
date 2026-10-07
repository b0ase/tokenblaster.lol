'use client';

/**
 * Highway 21M: an OutRun-style pseudo-3D racer against the clock. Traffic is coloured by live
 * transaction kind, and the roadside billboards scroll live BSV-21 token moves from the chain feed.
 * Engine: src/lib/highway/engine.ts (road projection after Jake Gordon's javascript-racer, MIT, with our
 * own track, code-drawn art and rules). Checkpoints add time; overtakes and distance score.
 *
 * Coin-op: PLAY · 10p buys one credit = one game (src/lib/coinop.ts). PRACTICE is free.
 */
import { useEffect, useRef, useState } from 'react';
import { KINDS } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';
import { sfx } from '@/lib/sfx';
import { billboardSprite, carSprite, columnSprite, crystalSprite, makeBackdrop, paintBillboard, pineSprite, rackSprite, truckSprite } from '@/lib/highway/art';
import { Highway, STEP, type Art, type Inputs } from '@/lib/highway/engine';
import { HighScores, useRunClock } from './HighScores';
import { HoldButton } from './HoldButton';
import { CoinOpButtons, useCoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';

const W = 800;
const H = 450;
const BOARDS = 8;
const FALLBACK: [string, string][] = [
  ['TOKENBLASTER.LOL', 'BLAST 50,000 TX'],
  ['HIGHWAY 21M', '21,000,000 BSV'],
  ['10p A CREDIT', 'PLAY NOW'],
  ['BSV-21 TOKENS', 'LIVE ON MAINNET'],
  ['SATOSHI CITY', 'EXIT 21'],
  ['BLASTPAD', 'LAUNCH A COIN'],
  ['SAT STACK 2048', 'MERGE TO 1 BSV'],
  ['1SAT ORDINALS', 'INSCRIBE IT'],
];
const ACCENTS = ['#ffd36a', '#ff5a48', '#7ae0c0', '#ff9a85'];

function buildArt(): Art {
  const bd = makeBackdrop();
  return {
    player: { straight: carSprite('#ffc83a', { player: true }), left: carSprite('#ffc83a', { player: true, lean: -1 }), right: carSprite('#ffc83a', { player: true, lean: 1 }) },
    cars: KINDS.map((k) => carSprite(k.color)),
    trucks: KINDS.slice(1, 4).map((k) => truckSprite(k.color)),
    billboards: Array.from({ length: BOARDS }, () => billboardSprite()),
    pines: [pineSprite()],
    racks: [rackSprite()],
    columns: [columnSprite()],
    crystals: [crystalSprite('#ff7a3a'), crystalSprite('#c05cff'), crystalSprite('#4fe0c0')],
    ...bd,
  };
}

type HUD = { score: number; time: number; kmh: number; lap: number; cp: number };
const KEYMAP: Record<string, keyof Inputs> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake' };
const TOUCH: Record<string, keyof Inputs> = { left: 'left', right: 'right', up: 'gas', down: 'brake' };

export function Highway21() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const co = useCoinOp('Highway 21M', 'highway21');
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [hud, setHud] = useState<HUD>({ score: 0, time: 0, kmh: 0, lap: 1, cp: 0 });
  const [final, setFinal] = useState({ score: 0, overtakes: 0, laps: 1 });
  const [hi, setHi] = useState(0);
  const runSecs = useRunClock(phase === 'play');
  const control = useRef<{ restart: () => void; key: (k: string, down: boolean) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const art = buildArt();
    const game = new Highway(art, W, H);
    const keys: Inputs = { left: false, right: false, gas: false, brake: false };
    const tickers: [string, string][] = [];
    let boardAt = 0;
    let lastTick = 0;
    let playing = false;

    const repaint = (i: number) => {
      const t = tickers[i];
      const [head, main] = t ?? FALLBACK[i % FALLBACK.length];
      paintBillboard(art.billboards[i], head, main, ACCENTS[i % ACCENTS.length]);
    };
    for (let i = 0; i < BOARDS; i++) repaint(i);

    game.onEvent = (e) => {
      if (e === 'overtake') sfx('pickup', 0.5);
      else if (e === 'checkpoint') sfx('level');
      else if (e === 'crash') sfx('rekt', 0.7);
      else if (e === 'timeup') {
        sfx('gameover');
        playing = false;
        const s = Math.floor(game.score);
        setFinal({ score: s, overtakes: game.overtakes, laps: game.lap });
        setHi((h) => Math.max(h, s));
        setPhase('over');
      }
    };

    control.current = {
      restart: () => {
        game.start();
        playing = true;
        setPhase('play');
        setHud({ score: 0, time: game.time, kmh: 0, lap: 1, cp: 0 });
      },
      key: (k, down) => {
        const m = TOUCH[k];
        if (m) keys[m] = down;
      },
    };
    const onKey = (e: KeyboardEvent) => {
      const m = KEYMAP[e.key];
      if (!m) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      keys[m] = e.type === 'keydown';
    };
    const clear = () => {
      keys.left = keys.right = keys.gas = keys.brake = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', clear);

    let raf = 0;
    let prev = 0;
    let acc = 0;
    let n = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      acc += dt;
      while (acc >= STEP) {
        game.update(STEP, keys);
        acc -= STEP;
      }
      game.render(ctx, keys.left ? -1 : keys.right ? 1 : 0);
      // Billboards: pull a live token move every couple of seconds and repaint one board.
      if (now - lastTick > 2200) {
        lastTick = now;
        const f = feedRef.current.take((x) => x.kind === 'token' && !!x.token);
        if (f?.token) {
          const sym = (tokenMeta(f.token)?.sym ?? f.token.slice(0, 6)).slice(0, 10).toUpperCase();
          tickers[boardAt % BOARDS] = ['LIVE BSV-21 MOVE', `${sym} ${f.op ? f.op.toUpperCase().slice(0, 8) : 'XFER'}`];
          repaint(boardAt % BOARDS);
          boardAt++;
        }
      }
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __tbHighway?: unknown }).__tbHighway = game;
      if (playing && ++n % 6 === 0) setHud({ score: Math.floor(game.score), time: Math.max(0, game.time), kmh: game.kmh, lap: game.lap, cp: game.checkpoints });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const start = (paid: boolean) => {
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    setRun({ paid, txid });
    control.current?.restart();
  };

  return (
    <section className="panel">
      <GameAudio track="hopper" />
      <div className="relative mx-auto w-full max-w-[900px] overflow-hidden border border-[var(--border-canvas)] bg-canvas" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }}>
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" />
        {phase === 'play' && (
          <>
            <div className="pointer-events-none absolute left-2 top-1 flex flex-wrap items-center gap-3 text-xs text-hot">
              <span>SCORE {hud.score.toLocaleString()}</span>
              <span>LAP {hud.lap}</span>
              <span>CP {hud.cp}</span>
            </div>
            <div className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 px-3 text-3xl font-bold ${hud.time < 8 ? 'text-fg' : 'text-hot'}`}>{Math.ceil(hud.time)}</div>
            <div className="pointer-events-none absolute right-2 top-1 text-xs text-hot">{hud.kmh} KM/H</div>
            <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
              <span className="border border-[var(--border-canvas)] bg-black/60 px-3 py-0.5 text-xs font-bold tracking-widest text-dim">
                {run.paid ? 'CREDIT GAME · 10p paid' : 'PRACTICE · free, nothing on chain'} · CREDITS: {co.credits}
              </span>
            </div>
          </>
        )}
        <div className="pointer-events-none absolute right-2 bottom-1 text-xs text-dim">{phase !== 'play' ? `chain: ${feed.status}` : ''}</div>
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 px-3 text-center">
            <p className="text-3xl font-bold text-hot">HIGHWAY 21M</p>
            <p className="max-w-md text-xs text-dim">Race the clock. Arrows / WASD to drive, up for gas, down to brake. Checkpoints add time; every car you pass scores. Traffic is coloured by transaction kind.</p>
            <CoinOpButtons co={co} start={start} />
          </div>
        )}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-black/70 px-3 text-center">
            <p className="text-3xl font-bold text-hot">TIME UP</p>
            <p className="text-sm text-fg">
              Score {final.score.toLocaleString()} · {final.overtakes} cars passed · lap {final.laps}. Best: {Math.max(hi, final.score).toLocaleString()}.
            </p>
            <HighScores game="highway21" score={final.score} secs={runSecs} live={run.paid} txid={run.txid} meta={run.paid ? { coinop: 1, passed: final.overtakes } : { passed: final.overtakes }} />
            <CoinOpButtons co={co} start={start} />
          </div>
        )}
      </div>
      <div className="mx-auto mt-2 grid w-full max-w-[420px] select-none grid-cols-4 gap-1 sm:hidden" style={{ touchAction: 'none' }}>
        <HoldButton ctl={control} k="left" className="btn h-14 text-xl">
          ◀
        </HoldButton>
        <HoldButton ctl={control} k="right" className="btn h-14 text-xl">
          ▶
        </HoldButton>
        <HoldButton ctl={control} k="down" className="btn h-14 text-sm">
          BRAKE
        </HoldButton>
        <HoldButton ctl={control} k="up" className="btn h-14 text-sm">
          GAS
        </HoldButton>
      </div>
      <p className="mt-2 text-xs text-muted">
        Reach each checkpoint before the clock runs out; every one adds time (a little less each time). Clip a roadside prop or a car and you lose speed. The billboards scroll real BSV-21 token moves from
        the live chain feed; the cars are coloured by transaction kind.
      </p>
      {co.chooserEl}
    </section>
  );
}
