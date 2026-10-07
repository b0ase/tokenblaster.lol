'use client';

/**
 * Ninja Punk Girls: Erobot Uprising on TokenBlaster. Same engine + levels as ninjapunkgirls.com
 * (src/lib/npgRunner, copied from that repo), plus the arcade layer:
 * - LIVE blasting (optional, on paid runs): every jump / wall jump and every shuriken is one tiny real
 *   transaction from loaded ammo, sats or a token (src/lib/useActionPay.ts).
 * - Token loot: live token transfers on chain float into the level ahead of you as tokens to grab.
 * - High scores, shared mute/volume prefs, NPG music (Pixel Dreams) as an mp3 loop.
 */
import { useEffect, useRef, useState } from 'react';
import { HEROES, H, loadAssets, NpgGame, W, type Assets, type Key, type Phase, type Sfx, type Stats } from '@/lib/npgRunner/engine';
import { useChainFeed } from '@/lib/useChainFeed';
import { lootFrom, useLoot, type Haul } from '@/lib/loot';
import { drawLoot, refreshLoot } from '@/lib/lootCanvas';
import { getAudioPrefs, installAudio, sfx, subscribeAudio, type SfxName } from '@/lib/sfx';
import { HighScores, useRunClock } from './HighScores';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { SoundToggle } from './SoundToggle';
import { ActionAmmo, ActionHud, AmmoAlerts } from './ActionAmmo';
import { useActionPay } from '@/lib/useActionPay';

const BASE = '/arcade/npg-runner';
const GAME = 'NPG Erobot Uprising';

const SFX: Record<Sfx, SfxName> = {
  start: 'start', jump: 'jump', walljump: 'spring', dash: 'laser', throw: 'shot', coin: 'coin', heart: 'pickup',
  stomp: 'stomp', kill: 'hit', hurt: 'hurt', checkpoint: 'stamp', boss: 'sonar', bosshit: 'hit', bossdown: 'explosion',
  clear: 'level', gameover: 'gameover', win: 'level', token: 'token',
};

const KEYMAP: Record<string, Key> = {
  ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', z: 'jump', Z: 'jump',
  ArrowDown: 'down', s: 'down', S: 'down',
  Shift: 'dash', k: 'dash', K: 'dash', c: 'dash', C: 'dash',
  j: 'attack', J: 'attack', x: 'attack', X: 'attack',
};

function Pad({ k, game, label, className }: { k: Key; game: React.RefObject<NpgGame | null>; label: string; className: string }) {
  return (
    <button
      type="button"
      className={`btn select-none ${className}`}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        game.current?.key(k, true);
      }}
      onPointerUp={() => game.current?.key(k, false)}
      onPointerCancel={() => game.current?.key(k, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function NpgRunner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<NpgGame | null>(null);
  // Coin-op: 10p buys a credit (src/lib/coinop.ts); practice is free and puts nothing on chain.
  const co = useCoinOp(GAME, 'npg');
  const ap = useActionPay('npg', GAME);
  const pay = ap.pay;
  const setLiveRun = ap.setRun;
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  const loot = useLoot('npg');
  const lootRef = useRef(loot);
  useEffect(() => {
    feedRef.current = feed;
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);

  const [assets, setAssets] = useState<Assets | null>(null);
  const [hero, setHero] = useState<string>(HEROES[0].id);
  const [phase, setPhase] = useState<Phase | 'ready'>('ready');
  const [stats, setStats] = useState<Stats | null>(null);
  const [lastRun, setLastRun] = useState<Haul>({});
  const runSecs = useRunClock(phase === 'play' || phase === 'clear');
  const music = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    void loadAssets(BASE).then((a) => alive && setAssets(a));
    return () => {
      alive = false;
    };
  }, []);

  // Music follows the arcade-wide mute + music volume.
  useEffect(() => {
    installAudio();
    const a = new Audio(`${BASE}/music.mp3`);
    a.loop = true;
    music.current = a;
    const apply = () => {
      const pr = getAudioPrefs();
      a.volume = Math.max(0, Math.min(1, pr.music * 0.8));
      a.muted = pr.muted;
    };
    apply();
    const un = subscribeAudio(apply);
    return () => {
      un();
      a.pause();
      music.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets) return;
    const g = new NpgGame(canvas, assets, {
      sfx: (s) => sfx(SFX[s]),
      onHud: setStats,
      canJump: () => pay.current(['jump']),
      canThrow: () => pay.current(['shuriken']),
      onPhase: (p, s) => {
        setPhase(p);
        setStats(s);
        if (p === 'over' || p === 'win') {
          setLiveRun(false);
          setLastRun({ ...lootRef.current.run });
          lootRef.current.end();
          music.current?.pause();
        }
      },
      pollDrop: () => {
        // Pull live txs until a token transfer turns up; that's the next token in the level.
        for (let i = 0; i < 30; i++) {
          const f = feedRef.current.take();
          if (!f) return null;
          const l = lootFrom(f);
          if (!l) continue;
          let item = l;
          return {
            label: l.sym,
            draw: (ctx, x, y, size, t) => drawLoot(ctx, item, x, y, size, t),
            onGet: () => {
              item = refreshLoot(item);
              lootRef.current.pickup(item);
            },
          };
        }
        return null;
      },
    });
    game.current = g;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __npg?: NpgGame }).__npg = g;
    return () => {
      g.destroy();
      game.current = null;
    };
  }, [assets, pay, setLiveRun]);

  useEffect(() => {
    const on = (down: boolean) => (e: KeyboardEvent) => {
      const k = KEYMAP[e.key];
      if (!k) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      game.current?.key(k, down);
    };
    const kd = on(true);
    const ku = on(false);
    const blur = () => game.current?.releaseAll();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** Start a game: a credit game spends one credit (its coin's txid goes with the run), practice is free. */
  const start = (paid: boolean) => {
    const g = game.current;
    if (!g) return;
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    setRun({ paid, txid });
    ap.setRun(paid);
    lootRef.current.end();
    setLastRun({});
    g.hero = hero;
    g.releaseAll();
    g.start(0);
    const a = music.current;
    if (a) {
      a.currentTime = 0;
      void a.play().catch(() => {});
    }
  };

  const score = stats?.score ?? 0;
  const done = phase === 'over' || phase === 'win';

  return (
    <section className="panel">
      <SoundToggle className="fixed bottom-3 right-3 z-[60]" />
      <div className="relative mx-auto w-full max-w-[960px] overflow-hidden border border-[var(--border-canvas)] bg-canvas" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" />
        <ActionHud ap={ap} className="absolute right-2 top-2 z-10" />
        <div className="pointer-events-none absolute bottom-1 left-2">
          <LootHud haul={loot.run} max={3} />
        </div>
        {(phase === 'play' || phase === 'clear') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
            <span className="border border-[var(--border-canvas)] bg-black/60 px-3 py-0.5 text-xs font-bold tracking-widest text-dim">{coinOpModeLabel(run.paid, co.credits)}</span>
          </div>
        )}
        {!assets && <div className="absolute inset-0 flex items-center justify-center bg-black text-dim">loading…</div>}
        {assets && phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-black/60 p-2 text-center">
            <p className="text-xs text-dim">NINJA PUNK GIRLS</p>
            <p className="text-2xl font-bold text-hot">EROBOT UPRISING</p>
            <div className="grid grid-cols-6 gap-1">
              {HEROES.map((h) => (
                <button key={h.id} type="button" onClick={() => setHero(h.id)} aria-pressed={hero === h.id} className={`flex flex-col items-center border p-0.5 ${hero === h.id ? 'border-[var(--hot)] bg-white/10' : 'border-white/10'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${BASE}/chars/${h.id}.png`} alt={h.name} className="h-10 w-auto sm:h-14" />
                  <span className="text-[9px] text-dim sm:text-[11px]">{h.name}</span>
                </button>
              ))}
            </div>
            <p className="hidden px-3 text-xs text-dim sm:block">←/→ run · SPACE jump (hold = higher) · SHIFT/K dash · J/X shuriken · ↓+jump drop through</p>
            <CoinOpButtons co={co} start={start} perCredit="1 credit = 1 game, until your hearts run out." />
          </div>
        )}
        {done && stats && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-black/75 p-2 text-center">
            <p className="text-3xl font-bold text-hot">{phase === 'win' ? 'NEO-TOKYO IS FREE' : 'GAME OVER'}</p>
            <p className="text-sm text-fg">
              Score {score.toLocaleString()} · stage {stats.level}/{stats.levels} · {stats.coins} coins · {stats.kills} Erobots
            </p>
            <LootLine haul={lastRun} />
            <HighScores game="npg" score={score} secs={runSecs} live={run.paid} txid={run.txid} meta={run.paid ? { coinop: 1 } : undefined} />
            <CoinOpButtons co={co} start={start} perCredit="1 credit = 1 game, until your hearts run out." />
          </div>
        )}
      </div>
      <div className="mt-2 flex select-none items-center justify-between gap-2 sm:hidden" style={{ touchAction: 'none' }}>
        <div className="flex gap-1.5">
          <Pad k="left" game={game} label="◀" className="h-14 w-14 text-xl" />
          <Pad k="right" game={game} label="▶" className="h-14 w-14 text-xl" />
          <Pad k="down" game={game} label="▼" className="h-14 w-10" />
        </div>
        <div className="flex gap-1.5">
          <Pad k="attack" game={game} label="✦" className="h-14 w-12 text-lg" />
          <Pad k="dash" game={game} label="DASH" className="h-14 w-14 !px-1 text-xs" />
          <Pad k="jump" game={game} label="JUMP" className="btn-fire h-14 w-16 !px-1" />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Three stages, three Erobot bosses. Wall jump, air dash (cuts through Erobots), shuriken. Live token transfers on chain float into the level ahead of you as tokens to grab. A credit (10p) buys one game; practice is free.
      </p>
      <div className="mt-2 flex flex-col items-center gap-1">{phase === 'play' || phase === 'clear' ? <AmmoAlerts ap={ap} /> : <ActionAmmo ap={ap} actions="jump and shuriken" />}</div>
      <LootPanel run={done ? lastRun : loot.run} allTime={loot.allTime} />
      {co.chooserEl}
    </section>
  );
}
