'use client';

/**
 * Token Snake: a 3D snake that eats the live BSV chain. Every bite is a transaction that just hit the network (sized by
 * bytes, coloured by kind); token transfers are token food wearing their logo and collected as loot; TokenBlaster blasts
 * are gold. Combo multiplier, power-ups (OVERDRIVE / PHASE / MAGNET), and an arena whose block monoliths rise as real
 * blocks land. This file is the shell (HUD, title and results posters, coin-op); the game is src/lib/snake/.
 *
 * Coin-op: PLAY · 10p pays and starts, a credit is one game of 3 lives, the house keeps the coin (src/lib/coinop.ts).
 * PRACTICE is free and puts nothing on chain.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useChainFeed } from '@/lib/useChainFeed';
import { useLoot, type Haul } from '@/lib/loot';
import { COINOP_HOUSE, LIVES_PER_CREDIT } from '@/lib/coinop';
import { useBlaster } from '@/lib/useBlaster';
import { TOKEN_FEE } from '@/lib/gun';
import { GAME_COINS, houseFirst } from '@/lib/gameCoins';
import { WalletChooser } from './WalletChooser';
import { BuyHouse, HouseBadge } from './HouseAmmo';
import { DR } from '@/lib/dr/tokens';
import { foodFromTx, KIND_CSS, POWER_NAME, SnakeEngine, type CamMode, type Hud, type Phase, type Quality, type RunResult, type Toast } from '@/lib/snake/engine';
import { LIVES, N } from '@/lib/snake/sim';
import { HighScores, useRunClock } from './HighScores';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { GameAudio } from './SoundToggle';
import { ChevronBar, Display, HazardBar, Kana, PosterFrame, ProductCode, Sticker, gridBg } from './dr';
import { drDisplay, drFontClass, drJp, drMono } from './dr/fonts';

type QualityPref = 'auto' | 'low' | 'high';
const PREFS = 'tokenblaster:snake-prefs';
const BEST = 'tokenblaster:snake-best';
const HOUSE = COINOP_HOUSE;
const PER_ACTION = 1; // sats to the house per bite / power-up
const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB (GorillaPool ARC minimum)
const LOADS = [1_000, 10_000, 100_000];
const TOKEN_LOADS = [10, 100, 1_000];
/** The house coin for live mode: TokenBlaster's own BSVGUN, listed first; any other token in the wallet works too. */
const HOUSE_COIN = GAME_COINS.bsvgun;
const hudFont = { fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase' } as const;

const isMobileish = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Boolean(coarse) || mem <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 720;
};

/** HUD nodes written straight to the DOM from the engine loop, without React renders. */
class HudDom {
  private n: Record<string, HTMLElement | null> = {};
  ref = (k: string) => (el: HTMLElement | null) => {
    this.n[k] = el;
  };
  text(k: string, t: string) {
    const el = this.n[k];
    if (el && el.textContent !== t) el.textContent = t;
  }
  css(k: string, st: Partial<CSSStyleDeclaration>) {
    const el = this.n[k];
    if (el) Object.assign(el.style, st);
  }
  private txCount = 0;
  setTx(n: number) {
    this.txCount = n;
    this.text('tx', String(n));
  }
  update(h: Hud) {
    this.text('score', h.score.toLocaleString('en-GB'));
    this.text('len', String(h.length));
    this.text('mult', `×${h.mult}`);
    this.text('combo', h.combo > 1 ? `${h.combo} CHAIN` : 'EAT TO CHAIN');
    this.css('comboBar', { width: `${Math.round(h.comboFrac * 100)}%`, background: h.comboFrac < 0.25 ? DR.colour.signal : DR.colour.acid });
    this.css('multBox', { background: h.mult >= 6 ? DR.colour.magenta : h.mult >= 3 ? DR.colour.amber : h.mult >= 2 ? DR.colour.cyan : '#2b2b33', transform: `scale(${h.combo > 0 ? 1 : 0.92})` });
    this.text('speed', `${h.speed.toFixed(1)}×`);
    this.text('tx', String(this.txCount));
    for (const k of ['overdrive', 'ghost', 'magnet'] as const) {
      const f = h.fx[k] / h.fxMax[k];
      this.css(`fx_${k}`, { display: f > 0 ? 'flex' : 'none' });
      this.css(`fxBar_${k}`, { width: `${Math.round(Math.min(1, f) * 100)}%` });
    }
    this.css('shield', { display: h.fx.shield > 0 ? 'block' : 'none' });
    for (let i = 0; i < LIVES; i++) this.css(`life${i}`, { opacity: i < h.lives ? '1' : '0.2', background: i < h.lives ? DR.colour.signal : '#444' });
  }
}

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST) ?? 0) || 0;
  } catch {
    return 0;
  }
};

const FOOD_KEY: { id: keyof typeof KIND_CSS; label: string; pts: string }[] = [
  { id: 'payment', label: 'PAYMENT', pts: '10' },
  { id: 'data', label: 'DATA', pts: '10' },
  { id: 'social', label: 'SOCIAL', pts: '15' },
  { id: 'inscription', label: 'INSCRIPTION', pts: '20' },
  { id: 'token', label: 'TOKEN', pts: '50' },
  { id: 'blast', label: 'BLAST', pts: '100' },
];

export function TokenSnake() {
  const mount = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SnakeEngine | null>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const co = useCoinOp('Token Snake', 'snake');
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const loot = useLoot('snake');
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);
  const [lastRun, setLastRun] = useState<Haul>({});
  const [phase, setPhase] = useState<Phase>('ready');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [camMode, setCamMode] = useState<CamMode>('angle');
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [perf, setPerf] = useState<{ fps: number; level: number } | null>(null);
  const [eaten, setEaten] = useState(0);
  const [touch, setTouch] = useState(false);
  const toastId = useRef(0);
  const [hud] = useState(() => new HudDom());
  const runSecs = useRunClock(phase === 'play' || phase === 'paused');
  // ── LIVE mode: every bite and power-up is one tiny real transaction, paid from loaded ammo (same path as Chain Frogger) ──
  const b = useBlaster();
  const [live, setLive] = useState(false); // a live run is in progress
  const [liveOpen, setLiveOpen] = useState(false); // the pay panel is showing
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [needAmmo, setNeedAmmo] = useState(false);
  const [payWith, setPayWith] = useState<'sats' | 'token'>('sats');
  const payTok = payWith === 'token' && b.mode === 'tokens' && b.token ? b.token : null;
  const heldOf = (id: string) => Math.max(0, Math.floor(b.tokens.find((t) => t.id === id)?.balance ?? 0));
  const houseTok = b.tokens.find((t) => t.id === HOUSE_COIN.id);
  const chooseSats = () => {
    b.setMode('sats');
    setPayWith('sats');
  };
  const chooseToken = (id: string) => {
    const t = b.tokens.find((x) => x.id === id);
    if (!t) return;
    b.setToken(t);
    b.setMode('tokens');
    setPayWith('token');
  };
  const payRef = useRef({ live: false, sats: 0, queued: 0, tok: false, tokens: 0 });
  useEffect(() => {
    payRef.current.sats = b.ammo;
    payRef.current.tok = Boolean(payTok);
    payRef.current.tokens = b.tokenAmmo;
  }, [b.ammo, payTok, b.tokenAmmo]);
  const queue = useRef<string[][]>([]);
  const draining = useRef(false);
  const counter = useRef(0);
  const fireBatchRef = useRef(b.fireBatch);
  const fireTokensRef = useRef(b.fireTokens);
  useEffect(() => {
    fireBatchRef.current = b.fireBatch;
    fireTokensRef.current = b.fireTokens;
  }, [b.fireBatch, b.fireTokens]);
  /** Batches the queue into chained transactions in the background, so the frame loop never waits on the wallet. */
  const drain = useRef(async () => {
    if (draining.current) return;
    draining.current = true;
    while (queue.current.length) {
      const tok = payRef.current.tok;
      const batch = queue.current.slice(0, tok ? 25 : 40);
      try {
        const txids = tok ? await fireTokensRef.current(counter.current + 1, batch, HOUSE) : await fireBatchRef.current(counter.current + 1, batch, { address: HOUSE, sats: PER_ACTION });
        counter.current += txids.length;
        queue.current.splice(0, txids.length);
        payRef.current.queued = queue.current.length;
        hud.setTx(counter.current);
        setOnChain(counter.current);
        if (txids.length) setLastTx(txids[txids.length - 1]);
        setPayErr(null);
        if (!txids.length) throw new Error('Out of ammo: load more to keep playing.');
      } catch (e) {
        setPayErr(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  /** One real transaction for this action: tag + 1 sat (or 1 token) to the house + the network fee. */
  const payFor = useRef((action: string[]) => {
    const pr = payRef.current;
    if (!pr.live) return;
    queue.current.push(action);
    pr.queued = queue.current.length;
    void drain.current();
  });
  /** Can the loaded ammo cover the next couple of actions? (the game pauses itself when not) */
  const canPay = useRef(() => {
    const pr = payRef.current;
    if (!pr.live) return true;
    const n = pr.queued + 2;
    return pr.tok ? pr.tokens >= n && pr.sats >= n * TOKEN_FEE : pr.sats >= n * (PER_ACTION + EST_FEE);
  });
  const ammoOk = payTok ? Math.min(Math.floor(b.tokenAmmo), Math.floor(b.ammo / TOKEN_FEE)) >= 2 : Math.floor(b.ammo / (PER_ACTION + EST_FEE)) >= 2;
  const lastHud = useRef<Hud | null>(null);
  const phaseRef = useRef<Phase>('ready');

  useEffect(() => {
    void Promise.resolve().then(() => {
      setBest(readBest());
      setTouch(Boolean(window.matchMedia?.('(pointer: coarse)').matches));
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { cam?: CamMode; q?: QualityPref };
        if (p.cam === 'angle' || p.cam === 'chase' || p.cam === 'top') setCamMode(p.cam);
        if (p.q === 'auto' || p.q === 'low' || p.q === 'high') setQualityPref(p.q);
      } catch {
        /* storage blocked */
      }
      setPrefsLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(PREFS, JSON.stringify({ cam: camMode, q: qualityPref }));
    } catch {
      /* storage blocked */
    }
  }, [camMode, qualityPref, prefsLoaded]);

  const pushToast = useCallback((t: Toast) => {
    const id = ++toastId.current;
    setToasts((a) => [...a.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 1900);
  }, []);

  // Build the engine once prefs are known (and again on a retry).
  const initial = useRef({ cam: camMode, q: qualityPref });
  useEffect(() => {
    initial.current = { cam: camMode, q: qualityPref };
  });
  useEffect(() => {
    const el = mount.current;
    if (!el || !prefsLoaded) return;
    let dead = false;
    const quality: Quality = initial.current.q === 'auto' ? (isMobileish() ? 'low' : 'high') : initial.current.q;
    const eng = new SnakeEngine(el, {
      quality,
      camMode: initial.current.cam,
      touchDevice: isMobileish(),
      mini: mini.current,
      pay: (a) => payFor.current(a),
      canPay: () => canPay.current(),
      fonts: { display: drDisplay.style.fontFamily, mono: drMono.style.fontFamily, jp: drJp.style.fontFamily },
      supply: {
        take: () => {
          const f = feedRef.current.take((x) => x.kind === 'token' || x.kind === 'blast') ?? feedRef.current.take();
          return f ? foodFromTx(f) : null;
        },
        waiting: () => feedRef.current.waiting(),
      },
      cb: {
        onHud: (h) => {
          lastHud.current = h;
          hud.update(h);
        },
        onPhase: (p) => {
          phaseRef.current = p;
          setPhase(p);
        },
        onToast: (t) => !dead && pushToast(t),
        onPickup: (l) => lootRef.current.pickup(l),
        onOver: (r) => {
          setResult(r);
          setEaten((e) => e + r.chainBites);
          setBest((b) => {
            const nb = Math.max(b, r.score);
            setNewBest(r.score > b && r.score > 0);
            try {
              localStorage.setItem(BEST, String(nb));
            } catch {
              /* storage blocked */
            }
            return nb;
          });
          setLastRun({ ...lootRef.current.run });
          lootRef.current.end();
        },
        onPerf: (i) => setPerf(i),
        onNeedAmmo: () => setNeedAmmo(true),
      },
    });
    engine.current = eng;
    setError(null);
    eng
      .init()
      .then(() => {
        if (!dead) setReady(true);
      })
      .catch((e: unknown) => {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dead = true;
      engine.current = null;
      setReady(false);
      eng.dispose();
    };
  }, [prefsLoaded, session, hud, pushToast]);

  // Quality and camera changes apply live.
  useEffect(() => {
    if (!ready) return;
    engine.current?.setQuality(qualityPref === 'auto' ? (isMobileish() ? 'low' : 'high') : qualityPref);
  }, [qualityPref, ready]);
  useEffect(() => {
    const e = engine.current;
    if (ready && e && e.camMode !== camMode) e.setCam(camMode);
  }, [camMode, ready]);
  useEffect(() => {
    // The engine also changes camera on C / the pad: mirror it back.
    const t = setInterval(() => {
      const e = engine.current;
      if (e && e.camMode !== camMode) setCamMode(e.camMode);
    }, 400);
    return () => clearInterval(t);
  }, [camMode]);

  // New blocks become monoliths in the arena.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let seen = 0;
    const poll = async () => {
      try {
        const r = await fetch('/api/blocks');
        if (!r.ok) return;
        const d = (await r.json()) as { blocks?: { height: number; txCount: number }[] };
        const list = (d.blocks ?? []).slice().sort((a, c) => a.height - c.height);
        if (!alive || !list.length) return;
        const fresh = seen ? list.filter((x) => x.height > seen) : list.slice(-3);
        seen = Math.max(seen, list[list.length - 1].height);
        for (const b of fresh) engine.current?.addBlock(b.height, b.txCount);
      } catch {
        /* blocks are a bonus: the arena falls back to timed monoliths */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready]);

  /** Start a game: a credit game spends one credit (its coin's txid goes with the run), practice is free. */
  const start = (paid: boolean) => {
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    if (!engine.current) return;
    setRun({ paid, txid });
    begin(false);
  };
  /** LIVE: no coin; every bite and power-up is paid from the loaded ammo. */
  const startLive = () => {
    if (!engine.current || !ammoOk || !HOUSE) return;
    setRun({ paid: false, txid: null });
    begin(true);
  };
  const begin = (isLive: boolean) => {
    lootRef.current.end();
    setLastRun({});
    setResult(null);
    setNewBest(false);
    setNeedAmmo(false);
    setLive(isLive);
    payRef.current.live = isLive;
    queue.current.length = 0;
    payRef.current.queued = 0;
    counter.current = 0;
    hud.setTx(0);
    setOnChain(0);
    setLastTx(null);
    setPayErr(null);
    engine.current?.start(isLive);
  };
  const resume = () => {
    if (live && !canPay.current()) return;
    setNeedAmmo(false);
    engine.current?.pause(false);
  };
  const toTitle = () => {
    setResult(null);
    setLive(false);
    payRef.current.live = false;
    engine.current?.attract();
  };

  const playing = phase === 'play' || phase === 'paused';
  const liveStart =
    HOUSE ? (
      <div className="flex flex-col items-center gap-1">
        <button onClick={() => (liveOpen && ammoOk ? startLive() : setLiveOpen(true))} className={`btn px-4 py-2 text-base font-bold tracking-widest ${liveOpen && ammoOk ? 'btn-on' : ''}`} style={{ borderColor: DR.colour.acid, color: DR.colour.acid }}>
          {liveOpen && ammoOk ? '▶ START LIVE · EVERY BITE ON-CHAIN' : '⚡ LIVE MODE · A TINY TX PER BITE'}
        </button>
        <span className="text-[10px] text-dim">{liveOpen && !ammoOk ? 'Load ammo in the panel below the arena (sats or a token), then press START LIVE.' : 'Every bite and power-up is a real transaction paid from ammo you load. No coin needed.'}</span>
      </div>
    ) : null;
  const sym = payTok?.sym ?? '';
  const accent = DR.colour.cyan;
  const bestShown = Math.max(best, result?.score ?? 0);

  return (
    <section className={`panel ${drFontClass}`} style={{ fontFamily: DR.font.mono }}>
      <GameAudio track="snake" />
      <div className="panel-header">
        <span className="panel-title">TOKEN SNAKE</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE: THE FOOD IS MAINNET
            </>
          ) : feed.status === 'off' ? (
            'no feed configured: quiet-mempool food'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="relative mx-auto w-full select-none overflow-hidden bg-black" style={{ aspectRatio: touch ? '4 / 5' : '16 / 9', maxHeight: '84vh', touchAction: 'none' }}>
        <div ref={mount} className="absolute inset-0 touch-none" />

        {/* ── HUD ── */}
        <div className={`pointer-events-none absolute inset-0 transition-opacity ${playing ? 'opacity-100' : 'opacity-0'}`}>
          <div className="absolute left-2 top-2 flex flex-col gap-1 sm:left-3 sm:top-3">
            <div className="flex items-stretch">
              <div className="px-3 py-1" style={{ background: DR.colour.signal, ...hudFont }}>
                <div className="text-[9px] leading-none tracking-widest text-white/80" style={{ fontFamily: DR.font.mono, fontStyle: 'normal' }}>
                  SCORE
                </div>
                <div ref={hud.ref('score')} className="text-3xl tabular-nums leading-none text-white sm:text-5xl">
                  0
                </div>
              </div>
              <div ref={hud.ref('multBox')} className="flex min-w-[3.2rem] items-center justify-center px-2 text-white transition-colors" style={{ ...hudFont, background: '#2b2b33' }}>
                <span ref={hud.ref('mult')} className="text-2xl sm:text-4xl">
                  ×1
                </span>
              </div>
            </div>
            <div className="w-full bg-black/70 px-2 py-0.5">
              <div className="flex items-center justify-between text-[10px] tracking-widest text-white" style={{ fontFamily: DR.font.mono }}>
                <span ref={hud.ref('combo')}>EAT TO CHAIN</span>
                <LootHud haul={loot.run} max={3} />
              </div>
              <div className="mt-0.5 h-1.5 w-full bg-white/10">
                <div ref={hud.ref('comboBar')} className="h-full" style={{ width: '0%', background: DR.colour.acid }} />
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {(['overdrive', 'ghost', 'magnet'] as const).map((k) => (
                <div key={k} ref={hud.ref(`fx_${k}`)} className="hidden w-40 items-center gap-1 bg-black/70 px-1.5 py-0.5 text-[10px]" style={{ ...hudFont, color: k === 'overdrive' ? DR.colour.amber : k === 'ghost' ? DR.colour.magenta : '#6f9bff' }}>
                  <span className="w-20">{POWER_NAME[k]}</span>
                  <span className="h-1.5 flex-1 bg-white/10">
                    <span ref={hud.ref(`fxBar_${k}`)} className="block h-full" style={{ width: '0%', background: 'currentColor' }} />
                  </span>
                </div>
              ))}
              <div ref={hud.ref('shield')} className="hidden w-fit bg-black/70 px-1.5 py-0.5 text-[10px]" style={{ ...hudFont, color: DR.colour.cyan }}>
                SHIELD UP
              </div>
            </div>
          </div>
          <div className="absolute right-2 top-2 flex flex-col items-end gap-1 sm:right-3 sm:top-3">
            <div className="flex items-center gap-1 bg-black/70 px-2 py-1">
              {Array.from({ length: LIVES }, (_, i) => (
                <span key={i} ref={hud.ref(`life${i}`)} className="inline-block h-3.5 w-5 sm:h-4 sm:w-7" style={{ clipPath: 'polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%, 30% 50%)', background: DR.colour.signal }} />
              ))}
            </div>
            <div className="flex gap-3 bg-black/70 px-2 py-1 text-xs text-white" style={hudFont}>
              <span>
                LEN <span ref={hud.ref('len')}>5</span>
              </span>
              <span ref={hud.ref('speed')} style={{ color: DR.colour.amber }}>
                1.0×
              </span>
              {live && (
                <span style={{ color: DR.colour.acid }}>
                  TX <span ref={hud.ref('tx')}>0</span>
                </span>
              )}
            </div>
          </div>
          <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3">
            <canvas ref={mini} width={132} height={132} className="h-[84px] w-[84px] border border-white/20 sm:h-[132px] sm:w-[132px]" />
          </div>
          <div className="absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 sm:bottom-3">
            {toasts.map((t) => (
              <Sticker key={t.id} bg={t.tone === 'gold' ? DR.colour.amber : t.tone === 'good' ? DR.colour.acid : t.tone === 'bad' ? DR.colour.signal : DR.colour.paper} fg={t.tone === 'bad' ? '#fff' : '#111'} size={t.tone === 'gold' ? 22 : 16} rot={-2}>
                {t.text}
              </Sticker>
            ))}
            <span className="bg-black/60 px-2 py-0.5 text-[10px] tracking-widest text-dim">{live ? 'LIVE · every bite and power-up is a real tx · nothing else is charged' : coinOpModeLabel(run.paid, co.credits)}</span>
          </div>
        </div>

        {/* ── In-game controls ── */}
        {playing && (
          <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1 max-sm:bottom-2 max-sm:left-auto max-sm:right-2 max-sm:top-auto max-sm:translate-x-0 max-sm:flex-col sm:top-3">
            <button onClick={() => engine.current?.pause(phase === 'play')} className="btn px-2 py-1 text-xs" aria-label={phase === 'play' ? 'Pause' : 'Resume'}>
              {phase === 'play' ? 'Ⅱ PAUSE' : '▶ RESUME'}
            </button>
            <button onClick={() => engine.current?.cycleCam()} className="btn px-2 py-1 text-xs" aria-label="Camera">
              CAM · {camMode.toUpperCase()}
            </button>
          </div>
        )}
        {perf && perf.fps < 28 && playing && <span className="pointer-events-none absolute bottom-2 right-14 bg-black/60 px-1 text-[10px] text-dim">{perf.fps} fps · adapting</span>}

        {/* ── Loading / error ── */}
        {!ready && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black" style={gridBg()}>
            <Display size="clamp(40px,9vw,96px)">
              TOKEN <span style={{ color: DR.colour.acid }}>SNAKE</span>
            </Display>
            <div className="w-[min(80vw,380px)]">
              <ChevronBar n={30} h={12} colour={DR.colour.amber} />
            </div>
            <p className="text-xs tracking-widest text-dim">BUILDING THE ARENA…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center">
            <p className="text-2xl font-bold text-hot">Could not start the 3D scene</p>
            <p className="max-w-md text-sm text-dim">{error}. Token Snake needs WebGL: try a recent Chrome, Edge, Firefox or Safari with hardware acceleration on.</p>
            <button onClick={() => setSession((s) => s + 1)} className="btn btn-on">
              RETRY
            </button>
          </div>
        )}

        {/* ── Title poster ── */}
        {ready && phase === 'ready' && (
          <div className="absolute inset-0 overflow-y-auto p-2 sm:p-4" style={{ background: 'linear-gradient(90deg, rgba(5,5,8,0.93) 0%, rgba(5,5,8,0.74) 48%, rgba(5,5,8,0) 80%)' }}>
            <div className="flex max-w-[34rem] flex-col gap-2.5">
              <div className="relative">
                <div className="leading-none">
                  <Display size="clamp(44px,8vw,92px)">
                    TOKEN <span style={{ color: DR.colour.acid }}>SNAKE</span>
                  </Display>
                </div>
                <div className="absolute right-0 top-1 hidden flex-col items-end gap-1 sm:flex">
                  <Kana size={13} colour={DR.colour.cyan}>
                    トークン・スネーク
                  </Kana>
                  <ProductCode code="TB-SNK-003" label="TB" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Sticker bg={DR.colour.amber} size={15} rot={-2}>
                    EAT THE CHAIN
                  </Sticker>
                  <Sticker bg={DR.colour.paper} size={12} rot={2}>
                    EVERY BITE IS A TRANSACTION
                  </Sticker>
                </div>
                <div className="mt-2 w-[min(90%,22rem)]">
                  <ChevronBar n={26} h={10} colour={DR.colour.signal} />
                </div>
              </div>
              <p className="max-w-md text-xs text-fg max-sm:hidden">
                The food is mainnet, live: each orb is a transaction that just hit the network, sized by its bytes. Token transfers are coins wearing their logo (collected as loot), TokenBlaster blasts are gold. Chain bites for a ×8 multiplier, grab power-ups, and mind the monoliths: a new one rises every time a block lands.
              </p>
              <div className="flex flex-wrap gap-1">
                {FOOD_KEY.map((f) => (
                  <span key={f.id} className="flex items-center gap-1 bg-black/70 px-1.5 py-0.5 text-[10px] tracking-wider text-white">
                    <span className="inline-block h-2.5 w-2.5" style={{ background: KIND_CSS[f.id], boxShadow: `0 0 8px ${KIND_CSS[f.id]}`, borderRadius: f.id === 'token' ? '50%' : 0 }} />
                    {f.label} <span className="text-dim">{f.pts}</span>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 text-[10px] tracking-wider text-white max-sm:hidden">
                <span className="bg-black/70 px-1.5 py-0.5" style={{ color: DR.colour.amber }}>
                  OVERDRIVE · faster, ×2 points
                </span>
                <span className="bg-black/70 px-1.5 py-0.5" style={{ color: DR.colour.magenta }}>
                  PHASE · ghost through walls, blocks, yourself
                </span>
                <span className="bg-black/70 px-1.5 py-0.5" style={{ color: '#6f9bff' }}>
                  MAGNET · food slides to you
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-dim">
                <span>
                  CAMERA{' '}
                  {(['angle', 'chase', 'top'] as const).map((m) => (
                    <button key={m} onClick={() => setCamMode(m)} aria-pressed={camMode === m} className={`ml-1 border px-1.5 py-0.5 ${camMode === m ? 'border-[#27e6ff] text-white' : 'border-[#333]'}`}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </span>
                <span>
                  QUALITY{' '}
                  {(['auto', 'low', 'high'] as const).map((m) => (
                    <button key={m} onClick={() => setQualityPref(m)} aria-pressed={qualityPref === m} className={`ml-1 border px-1.5 py-0.5 ${qualityPref === m ? 'border-[#27e6ff] text-white' : 'border-[#333]'}`}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </span>
              </div>
              <p className="text-[11px] text-dim">
                {touch ? 'Swipe or drag anywhere to turn (a floating stick appears under your thumb).' : 'Arrows / WASD to turn · P pause · C camera · gamepad d-pad / stick.'} {camMode === 'chase' ? 'Chase camera: left / right turn relative to the snake.' : ''} Best {best.toLocaleString('en-GB')}.
              </p>
              <CoinOpButtons co={co} start={start} perCredit={`1 coin = 1 game, ${LIVES_PER_CREDIT} lives.`} />
              {liveStart}
            </div>
          </div>
        )}

        {/* ── Pause ── */}
        {phase === 'paused' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55">
            <Display size={64}>{needAmmo ? 'OUT OF AMMO' : 'PAUSED'}</Display>
            <p className="text-xs text-dim">{needAmmo ? 'LIVE mode pays per bite. Load more ammo in the panel below the arena, then resume.' : 'The chain keeps moving; the snake waits.'}</p>
            <button onClick={resume} disabled={live && !ammoOk} className="btn btn-on px-4 py-2 disabled:opacity-40">
              ▶ RESUME
            </button>
          </div>
        )}

        {/* ── Results ── */}
        {phase === 'over' && result && (
          <div className="absolute inset-0 overflow-y-auto bg-black/60 p-2 sm:p-4">
            <PosterFrame accent={accent} code="TB-SNK-003 / RESULT" kana="リザルト" className="mx-auto max-w-3xl" style={{ background: 'rgba(8,8,12,0.94)' }}>
              <div className="flex flex-col items-center gap-2 p-3 text-center">
                <Display size="clamp(36px,7vw,72px)" colour={DR.colour.signal}>
                  GAME OVER
                </Display>
                <div className="w-full max-w-md">
                  <ChevronBar n={30} h={9} colour={DR.colour.amber} />
                </div>
                <div className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-1">
                  <span>
                    <span className="block text-[10px] tracking-widest text-dim">SCORE</span>
                    <Display size={52}>{result.score.toLocaleString('en-GB')}</Display>
                  </span>
                  <span className="text-sm text-fg">
                    length {result.length} · best chain ×{Math.min(8, 1 + Math.floor(result.maxCombo / 4))} ({result.maxCombo}) · {result.chainBites.toLocaleString('en-GB')} real transactions eaten
                  </span>
                </div>
                {newBest && (
                  <Sticker bg={DR.colour.acid} size={18} rot={-2}>
                    NEW PERSONAL BEST
                  </Sticker>
                )}
                <p className="text-xs text-dim">Best {bestShown.toLocaleString('en-GB')}.</p>
                <LootLine haul={lastRun} />
                <HighScores game="snake" score={result.score} secs={runSecs} live={run.paid || live} txid={live ? lastTx : run.txid} meta={live ? { live: 1, txs: onChain } : run.paid ? { coinop: 1 } : undefined} />
                <HazardBar colour={DR.colour.amber} h={8} className="w-full max-w-md" />
                <CoinOpButtons co={co} start={start} perCredit={`1 coin = 1 game, ${LIVES_PER_CREDIT} lives.`} />
                {liveStart}
                <button onClick={toTitle} className="text-xs text-dim hover:text-fg">
                  back to title
                </button>
              </div>
            </PosterFrame>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        The food is mainnet, live: {eaten.toLocaleString('en-GB')} real transactions served this visit. Arena {N}×{N}. Bites chain into a ×8 multiplier; blasts and token coins pay the most; the monoliths are real blocks (new ones rise as they land).
      </p>

      {liveOpen && HOUSE && (
        <div className="inset mt-2 flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="font-bold text-hot">LIVE AMMO</span>
          {!b.wallet ? (
            <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on">
              {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
            </button>
          ) : (
            <>
              <span className="text-dim">PAY WITH:</span>
              <button onClick={chooseSats} disabled={!!b.busy} className={`btn ${!payTok ? 'btn-on' : ''}`}>
                SATS
              </button>
              <button onClick={() => chooseToken(HOUSE_COIN.id)} disabled={!!b.busy || !houseTok} title={houseTok ? `1 $${HOUSE_COIN.sym} per bite` : `Your wallet has no $${HOUSE_COIN.sym}`} className={`btn flex items-center gap-1 disabled:opacity-40 ${payTok?.id === HOUSE_COIN.id ? 'btn-on' : ''}`}>
                ${HOUSE_COIN.sym} <HouseBadge label="HOUSE" />
              </button>
              {b.tokens.length > (houseTok ? 1 : 0) && (
                <select value={payTok && payTok.id !== HOUSE_COIN.id ? payTok.id : ''} onChange={(e) => e.target.value && chooseToken(e.target.value)} disabled={!!b.busy} className="btn bg-black">
                  <option value="">other token…</option>
                  {houseFirst(b.tokens, HOUSE_COIN)
                    .filter((t) => t.id !== HOUSE_COIN.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        ${t.sym} ({Math.floor(t.balance ?? 0).toLocaleString()})
                      </option>
                    ))}
                </select>
              )}
              {!houseTok && <BuyHouse coin={HOUSE_COIN} />}
              {payTok ? (
                <span className="text-dim">
                  1 ${sym} to TokenBlaster + ~{TOKEN_FEE} sats network fee per bite · <span className="text-hot">{Math.max(0, Math.min(Math.floor(b.tokenAmmo), Math.floor(b.ammo / TOKEN_FEE))).toLocaleString()} actions</span> loaded ({Math.floor(b.tokenAmmo).toLocaleString()} ${sym} · {b.ammo.toLocaleString()} sats fuel)
                </span>
              ) : (
                <span className="text-dim">
                  {PER_ACTION} sat to TokenBlaster + ~{EST_FEE} sats network fee per bite · <span className="text-hot">{Math.floor(b.ammo / (PER_ACTION + EST_FEE)).toLocaleString()} actions</span> loaded ({b.ammo.toLocaleString()} sats)
                </span>
              )}
              {payTok
                ? TOKEN_LOADS.filter((n) => n <= heldOf(payTok.id)).map((n) => (
                    <button key={n} onClick={() => void b.loadTokenAmmo(n)} disabled={!!b.busy} className="btn">
                      {b.busy === 'loading-tokens' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} $${sym}`}
                    </button>
                  ))
                : LOADS.map((n) => (
                    <button key={n} onClick={() => b.load(n, `Token Snake: ${n.toLocaleString()} sats of bites`)} disabled={!!b.busy} className="btn">
                      {b.busy === 'loading' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} sats`}
                    </button>
                  ))}
              {payTok && b.tokenAmmo < 1 && <span className="font-bold text-hot">Press LOAD … ${sym}, approve it, then START LIVE.</span>}
              {(b.ammo > 0 || b.gunTokens.length > 0) && (
                <button onClick={b.unload} disabled={!!b.busy} className="btn">
                  UNLOAD
                </button>
              )}
            </>
          )}
          <span className="text-dim">
            on chain: <span className="text-hot">{onChain.toLocaleString()}</span>
            {lastTx && (
              <>
                {' · '}
                <a href={`https://whatsonchain.com/tx/${lastTx}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  last tx ↗
                </a>
              </>
            )}
          </span>
        </div>
      )}
      {(payErr || b.error) && <p className="mt-1 text-sm text-hot">⚠ {payErr ?? b.error}</p>}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      {co.chooserEl}
    </section>
  );
}
