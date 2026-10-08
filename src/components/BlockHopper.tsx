'use client';

/**
 * Block Hopper: a 2.5D platformer where the level is the live BSV chain. Every incoming transaction becomes
 * the next platform (size from its bytes, look from its kind), token transfers walk out as enemies wearing
 * their token, social posts are springs, data txs crumble, and mined blocks are checkpoint gates. A wall of
 * reorg static chases you. This file is the shell (title poster, HUD, game over, touch controls, coin-op);
 * the game itself is src/lib/hopper/engine.ts. Visual language: src/components/dr.
 * Coin-op: one credit = one game of three lives (src/lib/coinop.ts); PRACTICE is free and sends nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HighScores } from './HighScores';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { ChevronBar, Display, HazardBar, Kana, Pictogram, PosterFrame, ProductCode, Sticker, gridBg, halftone } from './dr';
import { drDisplay, drFontClass, drMono } from './dr/fonts';
import { HopperLogo } from './hopper-logo';
import { DR } from '@/lib/dr/tokens';
import { useChainFeed } from '@/lib/useChainFeed';
import { useBlaster } from '@/lib/useBlaster';
import { TOKEN_FEE } from '@/lib/gun';
import { houseFirst } from '@/lib/gameCoins';
import { WalletChooser } from './WalletChooser';
import { lootFrom, useLoot, type Haul } from '@/lib/loot';
import { KIND_STYLE, GAME_KANA, GAME_NAME, GAME_SLUG, GAME_TAGLINE, type BlockInfo } from '@/lib/hopper/brand';
import { HopperEngine, setFonts, type Banner, type Hud, type Phase, type Quality, type Result, type Toast } from '@/lib/hopper/engine';

type QualityPref = 'auto' | 'low' | 'high';
const PREFS = `tokenblaster:${GAME_SLUG}-prefs`;
const BEST = `tokenblaster:${GAME_SLUG}-best`;
/** LIVE mode: every jump / wall jump / dash is 1 sat (or 1 token) to the house + the network fee, same path as Chain Frogger. */
const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS ?? '';
const PER_ACTION = 1;
const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB
const LOADS = [1_000, 10_000, 100_000];
const TOKEN_LOADS = [10, 100, 1_000];
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
  update(h: Hud) {
    this.text('score', h.score.toLocaleString('en-GB'));
    this.text('dist', `${h.dist.toLocaleString('en-GB')} M`);
    this.text('coins', String(h.coins));
    this.text('kmh', String(h.kmh));
    this.text('gap', `${h.gap} M`);
    this.text('blocks', String(h.blocks));
    this.css('dash', { width: `${Math.round(h.dash * 100)}%`, background: h.dash >= 1 ? DR.colour.cyan : DR.colour.grey });
    const danger = Math.max(0, 1 - h.gap / 22);
    this.css('gapBar', { width: `${Math.round(Math.min(1, h.gap / 40) * 100)}%`, background: h.gap < 10 ? DR.colour.signal : h.gap < 20 ? DR.colour.amber : DR.colour.acid });
    this.css('gapTag', { opacity: danger > 0.5 ? String(0.5 + 0.5 * (Math.floor(performance.now() / 160) % 2)) : '1', color: h.gap < 10 ? DR.colour.signal : DR.colour.paper });
    this.css('combo', { opacity: h.combo > 1 ? '1' : '0' });
    this.text('comboN', `x${h.combo}`);
  }
}

const readBest = (): number => {
  try {
    return Number(localStorage.getItem(BEST) ?? 0) || 0;
  } catch {
    return 0;
  }
};

export function BlockHopper() {
  const mount = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const takeRef = useRef(feed.take);
  useEffect(() => {
    takeRef.current = feed.take;
  });
  // Coin-op: 10p buys a credit (src/lib/coinop.ts); practice is free and puts nothing on chain.
  const co = useCoinOp(GAME_NAME, GAME_SLUG);
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const loot = useLoot(GAME_SLUG);
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  // Leaving mid-run still banks what was grabbed.
  useEffect(() => () => lootRef.current.end(), []);
  const [lastRun, setLastRun] = useState<Haul>({});

  // ── LIVE token-blasting: queue one tiny tx per action, drained in batches off the frame loop ──
  const b = useBlaster();
  const [liveRun, setLiveRun] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [payWith, setPayWith] = useState<'sats' | 'token'>('sats');
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const payTok = payWith === 'token' && !!b.token && b.mode === 'tokens';
  const tokHeld = Math.floor(b.tokens.find((t) => t.id === b.token?.id)?.balance ?? 0);
  const payRef = useRef({ live: false, sats: 0, queued: 0, tok: false, tokens: 0 });
  useEffect(() => {
    payRef.current.sats = b.ammo;
    payRef.current.tok = payTok;
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
        setOnChain((n) => n + txids.length);
        if (txids.length) setLastTx(txids[txids.length - 1]);
        setPayErr(null);
        if (!txids.length) throw new Error('Out of ammo: load more to keep jumping.');
      } catch (e) {
        setPayErr(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  const payApi = useRef({
    live: () => payRef.current.live,
    can: () => {
      const pr = payRef.current;
      const n = pr.queued + 1;
      return pr.tok ? pr.tokens >= n && pr.sats >= n * TOKEN_FEE : pr.sats - n * (PER_ACTION + EST_FEE) >= 0;
    },
    spend: (action: string[]) => {
      queue.current.push(['hopper', ...action]);
      payRef.current.queued = queue.current.length;
      void drain.current();
    },
  });
  const actionsLoaded = payTok ? Math.min(Math.floor(b.tokenAmmo), Math.floor(b.ammo / TOKEN_FEE)) : Math.floor(b.ammo / (PER_ACTION + EST_FEE));

  const engine = useRef<HopperEngine | null>(null);
  const [hud] = useState(() => new HudDom());
  const [phase, setPhase] = useState<Phase>('loading');
  const [loading, setLoading] = useState({ msg: 'Starting', pct: 0 });
  const [lives, setLives] = useState(3);
  const [result, setResult] = useState<Result | null>(null);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [banner, setBanner] = useState<(Banner & { id: number }) | null>(null);
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [ready, setReady] = useState(false);
  const [touch, setTouch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [built, setBuilt] = useState(0);
  const [perf, setPerf] = useState<{ fps: number; level: number } | null>(null);
  const toastId = useRef(0);
  const livesRef = useRef(3);
  const bestRef = useRef(0);

  // Recent blocks → checkpoint gates. The newest few open the run; new blocks join as they are mined.
  const blocksRef = useRef<{ seen: number; pending: BlockInfo[] }>({ seen: 0, pending: [] });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/blocks');
        if (!r.ok) return;
        const d = (await r.json()) as { blocks?: { height: number; txCount: number; miner: string }[] };
        const list = (d.blocks ?? []).slice().sort((a, c) => a.height - c.height);
        const br = blocksRef.current;
        if (!br.seen) br.pending.push(...list.slice(-3));
        else br.pending.push(...list.filter((x) => x.height > br.seen));
        if (list.length) br.seen = Math.max(br.seen, list[list.length - 1].height);
      } catch {
        /* blocks are a bonus; the tx feed still builds the level */
      }
    };
    void poll();
    const t = setInterval(() => alive && void poll(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setFonts({ display: drDisplay.style.fontFamily, mono: drMono.style.fontFamily });
    void Promise.resolve().then(() => {
      setBest(readBest());
      bestRef.current = readBest();
      setTouch(Boolean(window.matchMedia?.('(pointer: coarse)').matches));
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { q?: QualityPref };
        if (p.q) setQualityPref(p.q);
      } catch {
        /* storage blocked */
      }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(PREFS, JSON.stringify({ q: qualityPref }));
    } catch {
      /* storage blocked */
    }
  }, [ready, qualityPref]);

  const pushToast = useCallback((t: Toast) => {
    const id = ++toastId.current;
    setToasts((a) => [...a.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 2400);
  }, []);

  const onHud = useCallback(
    (h: Hud) => {
      hud.update(h);
      if (h.lives !== livesRef.current) {
        livesRef.current = h.lives;
        setLives(h.lives);
      }
    },
    [hud],
  );

  useEffect(() => {
    const host = mount.current;
    if (!host || !ready) return;
    const life = { dead: false };
    const q: Quality = qualityPref === 'auto' ? (isMobileish() ? 'low' : 'high') : qualityPref;
    void Promise.resolve().then(() => {
      if (life.dead) return;
      setPhase('loading');
      setLoading({ msg: 'Starting', pct: 0 });
      setError(null);
      setResult(null);
    });
    const eng = new HopperEngine(host, {
      quality: q,
      touchDevice: isMobileish() && Boolean(window.matchMedia?.('(pointer: coarse)').matches),
      take: (pred) => takeRef.current(pred),
      lootOf: lootFrom,
      takeBlock: () => blocksRef.current.pending.shift() ?? null,
      pay: { live: () => payApi.current.live(), can: () => payApi.current.can(), spend: (a) => payApi.current.spend(a) },
      cb: {
        onPhase: (p) => !life.dead && setPhase(p),
        onHud,
        onToast: (t) => !life.dead && pushToast(t),
        onBanner: (b) => {
          if (life.dead) return;
          const id = ++toastId.current;
          setBanner({ ...b, id });
          setTimeout(() => !life.dead && setBanner((cur) => (cur && cur.id === id ? null : cur)), 3000);
        },
        onLoading: (msg, pct) => !life.dead && setLoading({ msg, pct }),
        onPickup: (l) => lootRef.current.pickup(l),
        onOver: (r) => {
          if (life.dead) return;
          payRef.current.live = false;
          setResult(r);
          setBuilt(r.built);
          setLastRun({ ...lootRef.current.run });
          lootRef.current.end();
          const isBest = r.score > bestRef.current;
          if (isBest) {
            bestRef.current = r.score;
            setBest(r.score);
            try {
              localStorage.setItem(BEST, String(r.score));
            } catch {
              /* storage blocked */
            }
          }
          setNewBest(isBest);
        },
        onPerf: (p) => !life.dead && setPerf(p),
      },
    });
    engine.current = eng;
    eng
      .init()
      .then(() => {
        if (!life.dead && process.env.NODE_ENV !== 'production') (window as unknown as { __hopper?: HopperEngine }).__hopper = eng;
      })
      .catch((e: unknown) => {
        if (!life.dead) setError(e instanceof Error ? e.message : 'Could not start the 3D scene');
      });
    return () => {
      life.dead = true;
      eng.dispose();
      if (engine.current === eng) engine.current = null;
    };
  }, [ready, qualityPref, session, onHud, pushToast]);

  /** Start a game: a credit game spends one credit (its coin's txid goes with the run), practice is free, LIVE pays per action. */
  const start = (paid: boolean, live = false) => {
    const eng = engine.current;
    if (!eng) return;
    if (live && (!HOUSE || actionsLoaded < 1)) return;
    const txid = paid && !live ? co.consume() : null;
    if (paid && !live && !txid) return;
    setRun({ paid: paid && !live, txid });
    setLiveRun(live);
    payRef.current.live = live;
    setPayErr(null);
    setOnChain(0);
    setLastTx(null);
    lootRef.current.end();
    setLastRun({});
    setResult(null);
    setNewBest(false);
    livesRef.current = 3;
    setLives(3);
    setBanner(null);
    eng.begin();
  };

  /** The LIVE token-blasting picker: one plain flow, connect → pick SATS or a token → load → start. */
  const liveEl = (
    <div className="inset flex max-w-[31rem] flex-col gap-2 border border-[var(--border-canvas)] px-3 py-2 text-sm" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="flex items-center gap-2">
        <Sticker bg={DR.colour.cyan} size={14} rot={-2}>
          LIVE BLAST
        </Sticker>
        <span className="text-xs text-dim">Every jump, wall jump and dash is a tiny real transaction.</span>
      </div>
      {!HOUSE ? (
        <p className="text-xs text-dim">Live mode is not switched on yet. Practice and credit games work.</p>
      ) : !b.wallet ? (
        <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on self-start px-3 py-1">
          {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-dim">PAY:</span>
            <button onClick={() => (b.setMode('sats'), setPayWith('sats'))} disabled={!!b.busy} className={`btn ${!payTok ? 'btn-on' : ''}`}>
              SATS
            </button>
            <button
              onClick={() => (b.setMode('tokens'), setPayWith('token'))}
              disabled={!!b.busy || !b.tokens.length}
              title={b.tokens.length ? '1 token per action' : 'Your wallet has no tokens'}
              className={`btn ${payTok ? 'btn-on' : ''} disabled:opacity-40`}
            >
              $TOKEN
            </button>
            {payWith === 'token' && b.tokens.length > 0 && (
              <select value={b.token?.id ?? ''} onChange={(e) => b.setToken(b.tokens.find((t) => t.id === e.target.value) ?? null)} className="btn max-w-[9rem] px-1 py-1 text-xs">
                {houseFirst(b.tokens).map((t) => (
                  <option key={t.id} value={t.id}>
                    ${t.sym}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(payTok ? TOKEN_LOADS.filter((n) => n <= tokHeld) : LOADS).map((n) => (
              <button key={n} onClick={() => (payTok ? void b.loadTokenAmmo(n) : b.load(n, `Block Hopper: ${n.toLocaleString()} sats of jumps`))} disabled={!!b.busy} className="btn">
                {b.busy === 'loading' || b.busy === 'loading-tokens' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} ${payTok ? `$${b.token?.sym ?? ''}` : 'sats'}`}
              </button>
            ))}
            {(b.ammo > 0 || b.gunTokens.length > 0) && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn">
                UNLOAD
              </button>
            )}
          </div>
          <p className="text-xs text-dim">
            {payTok ? `1 $${b.token?.sym ?? 'token'} + ~${TOKEN_FEE} sats fee` : `${PER_ACTION} sat + ~${EST_FEE} sats fee`} per action ·{' '}
            <span className="text-hot">{Math.max(0, actionsLoaded).toLocaleString()} actions</span> loaded
          </p>
          <button onClick={() => start(true, true)} disabled={!!b.busy || actionsLoaded < 1} className="btn btn-on self-start px-4 py-2 text-lg disabled:opacity-40">
            {actionsLoaded < 1 ? 'LOAD AMMO FIRST' : '▶ PLAY LIVE'}
          </button>
        </>
      )}
      {(payErr || b.error) && <p className="text-xs text-hot">⚠ {payErr ?? b.error}</p>}
    </div>
  );

  const hold = (k: 'left' | 'right' | 'jump' | 'dash') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (engine.current) engine.current.touch[k] = true;
    },
    onPointerUp: () => {
      if (engine.current) engine.current.touch[k] = false;
    },
    onPointerCancel: () => {
      if (engine.current) engine.current.touch[k] = false;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const playing = phase === 'playing' || phase === 'paused';
  const accent = DR.colour.signal;

  return (
    <section className={`panel game-root ${drFontClass}`} style={{ fontFamily: DR.font.mono }}>
      <GameAudio track="hopper" />
      <div className="panel-header">
        <span className="panel-title">{GAME_NAME}</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE: EVERY PLATFORM IS A MAINNET TX
            </>
          ) : feed.status === 'off' ? (
            'no feed configured: quiet-mempool filler'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="game-stage relative" style={{ height: 'min(84vh, 820px)', minHeight: 460 }}>
        <div ref={wrap} className={`select-none overflow-hidden bg-black ${playing ? 'fixed inset-0 z-[90]' : 'absolute inset-0'}`} style={playing ? { height: '100dvh' } : undefined}>
          <div ref={mount} className="absolute inset-0 touch-none" />

          {/* ── HUD ── */}
          <div className={`pointer-events-none absolute inset-0 transition-opacity ${phase === 'playing' || phase === 'paused' ? 'opacity-100' : 'opacity-0'}`}>
            <div className="absolute left-3 top-3 flex items-stretch">
              <div className="px-3 py-1" style={{ background: accent, ...hudFont }}>
                <div ref={hud.ref('score')} className="text-4xl tabular-nums text-white sm:text-6xl" style={{ lineHeight: 0.86 }}>
                  0
                </div>
              </div>
              <div className="flex flex-col justify-between bg-black/70 px-2 py-1" style={hudFont}>
                <div className="flex gap-1">
                  {Array.from({ length: Math.max(3, lives) }, (_, i) => (
                    <Pictogram key={i} name="hex" size={20} colour={i < lives ? DR.colour.cyan : '#333'} />
                  ))}
                </div>
                <span ref={hud.ref('dist')} className="text-lg tabular-nums text-white sm:text-xl">
                  0 M
                </span>
              </div>
            </div>
            <div className="absolute left-3 top-[4.6rem] flex items-center gap-2 sm:top-[5.6rem]" style={hudFont}>
              <span className="flex items-center gap-1 bg-black/60 px-2 py-0.5 text-sm" style={{ color: DR.colour.amber }}>
                <Pictogram name="star" size={14} colour={DR.colour.amber} />
                <span ref={hud.ref('coins')}>0</span>
              </span>
              <span ref={hud.ref('combo')} className="opacity-0 transition-opacity">
                <Sticker bg={DR.colour.acid} size={20} rot={-4}>
                  COMBO <span ref={hud.ref('comboN')}>x2</span>
                </Sticker>
              </span>
            </div>
            <div className="absolute right-3 top-3 flex w-[44vw] max-w-[260px] flex-col items-end gap-1">
              <div className="flex w-full items-center justify-between bg-black/70 px-2 py-1" style={hudFont}>
                <span ref={hud.ref('gapTag')} className="text-sm">
                  REORG
                </span>
                <span ref={hud.ref('gap')} className="text-xl tabular-nums text-white">
                  0 M
                </span>
              </div>
              <div className="h-2 w-full bg-black/70" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 11px, rgba(0,0,0,0.9) 11px 12px)' }}>
                <div ref={hud.ref('gapBar')} className="h-full" style={{ width: '100%', background: DR.colour.acid }} />
              </div>
              <div className="flex items-center gap-2 bg-black/60 px-2 py-0.5 text-xs" style={hudFont}>
                <Pictogram name="flag" size={14} colour={DR.colour.cyan} />
                <span style={{ color: DR.colour.cyan }}>
                  BLOCKS <span ref={hud.ref('blocks')}>0</span>
                </span>
              </div>
            </div>
            <div className="absolute bottom-3 left-3 flex flex-col gap-1 max-sm:bottom-[5.8rem]">
              <div className="flex items-end gap-2 bg-black/60 px-3 py-1">
                <span ref={hud.ref('kmh')} className="text-4xl tabular-nums text-white sm:text-6xl" style={{ ...hudFont, lineHeight: 0.84 }}>
                  0
                </span>
                <span className="pb-0.5 text-xs" style={{ ...hudFont, color: DR.colour.amber }}>
                  KM/H
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 text-xs" style={{ ...hudFont, color: DR.colour.cyan }}>
                  DASH
                </span>
                <div className="h-2.5 w-28 bg-black/70" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 9px, rgba(0,0,0,0.9) 9px 10px)' }}>
                  <div ref={hud.ref('dash')} className="h-full" style={{ width: '100%', background: DR.colour.cyan }} />
                </div>
              </div>
            </div>
            <div className="absolute bottom-3 right-3 max-sm:hidden">
              <LootHud haul={loot.run} max={3} />
            </div>
            {liveRun && (
              <div className="absolute left-3 top-[7.4rem] flex items-center gap-2 bg-black/70 px-2 py-0.5 text-sm max-sm:top-[8.2rem]" style={{ ...hudFont, color: DR.colour.cyan }}>
                <Pictogram name="bolt" size={14} colour={DR.colour.cyan} />
                TXS {onChain.toLocaleString('en-GB')}
                <span className="text-[10px] opacity-70">{actionsLoaded.toLocaleString()} LEFT</span>
              </div>
            )}
            {phase === 'playing' && !liveRun && (
              <div data-hopper-mode={run.paid ? 'paid' : 'practice'} className={`absolute left-1/2 top-1 -translate-x-1/2 border bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest max-sm:hidden sm:text-xs ${run.paid ? 'border-[#ffd36a] text-[#ffd36a]' : 'border-white/20 text-dim'}`}>
                {coinOpModeLabel(run.paid, co.credits)}
              </div>
            )}
            <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 sm:bottom-20">
              {toasts.map((t) => (
                <Sticker key={t.id} bg={t.tone === 'good' ? DR.colour.acid : t.tone === 'bad' ? DR.colour.signal : DR.colour.paper} fg={t.tone === 'bad' ? '#fff' : '#111'} size={18} rot={-2}>
                  {t.text}
                </Sticker>
              ))}
            </div>
          </div>

          {/* ── Block banner ── */}
          {banner && (
            <div key={banner.id} className="pointer-events-none absolute inset-x-0 top-[26%] overflow-hidden" style={{ animation: 'hopBanner 3s cubic-bezier(.2,.8,.2,1) both' }}>
              <style>{`@keyframes hopBanner { 0% { transform: translateX(-60%) skewX(-12deg); opacity: 0 } 12% { transform: translateX(0) skewX(-12deg); opacity: 1 } 80% { transform: translateX(0) skewX(-12deg); opacity: 1 } 100% { transform: translateX(40%) skewX(-12deg); opacity: 0 } }`}</style>
              <HazardBar colour={banner.color} h={8} />
              <div className="bg-black/80 px-4 py-2 text-center">
                <Display size="clamp(34px,8vw,92px)" colour={DR.colour.paper} style={{ textShadow: `0 0 28px ${banner.color}` }}>
                  {banner.title}
                </Display>
                <div className="text-[10px] tracking-[0.25em] sm:text-sm" style={{ color: banner.color, fontFamily: DR.font.mono }}>
                  {banner.sub}
                </div>
              </div>
              <HazardBar colour={banner.color} h={8} />
            </div>
          )}

          {/* ── Touch controls ── */}
          {touch && phase === 'playing' && (
            <>
              <div className="absolute bottom-3 left-3 flex gap-2">
                <button {...hold('left')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Run left">
                  ◀
                </button>
                <button {...hold('right')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Run right">
                  ▶
                </button>
              </div>
              <div className="absolute bottom-3 right-3 flex items-end gap-2">
                <button {...hold('dash')} className="btn h-14 w-16 touch-none text-xs sm:h-16 sm:w-20" aria-label="Dash">
                  DASH
                </button>
                <button {...hold('jump')} className="btn btn-on h-20 w-24 touch-none text-base sm:h-24 sm:w-28" aria-label="Jump">
                  JUMP
                </button>
              </div>
            </>
          )}
          {playing && (
            <div className="absolute right-3 top-[7.4rem] flex gap-1 max-sm:top-[8.2rem]">
              <button onClick={() => engine.current?.pause(phase !== 'paused')} className="btn px-2 py-1 text-xs" aria-label="Pause">
                {phase === 'paused' ? '▶' : 'Ⅱ'}
              </button>
            </div>
          )}
          {phase === 'paused' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
              <Display size="clamp(48px,10vw,110px)">PAUSED</Display>
              <div className="flex gap-2">
                <button onClick={() => engine.current?.pause(false)} className="btn btn-on px-4 py-2 text-lg">
                  RESUME
                </button>
              </div>
              <p className="text-[11px] text-dim">P / ESC resume · a paused credit game keeps its credit</p>
            </div>
          )}

          {/* ── Loading poster ── */}
          {phase === 'loading' && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black" style={gridBg()}>
              <HopperLogo size="clamp(34px,7vw,76px)" />
              <Kana size={14} colour={DR.colour.amber}>
                {GAME_KANA}
              </Kana>
              <div className="w-[min(80vw,420px)]">
                <ChevronBar n={30} h={14} colour={DR.colour.amber} />
                <div className="mt-1 h-1.5 bg-white/10">
                  <div className="h-full transition-all" style={{ width: `${Math.round(loading.pct * 100)}%`, background: DR.colour.signal }} />
                </div>
              </div>
              <p className="text-xs tracking-widest text-dim">{loading.msg.toUpperCase()}…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center">
              <p className="text-2xl font-bold text-hot">Could not start the 3D scene</p>
              <p className="max-w-md text-sm text-dim">
                {error}. {GAME_NAME} needs WebGL: try a recent Chrome, Edge, Firefox or Safari with hardware acceleration on.
              </p>
              <button onClick={() => setSession((s) => s + 1)} className="btn btn-on">
                RETRY
              </button>
            </div>
          )}

          {/* ── Title poster ── */}
          {phase === 'title' && (
            <div className="absolute inset-0 overflow-y-auto p-2 sm:p-5" style={{ background: 'linear-gradient(90deg, rgba(5,5,8,0.94) 0%, rgba(5,5,8,0.74) 44%, rgba(5,5,8,0) 76%)' }}>
              <div className="flex max-w-[31rem] flex-col gap-3">
                <div className="relative pt-1">
                  <HopperLogo size="clamp(40px,7.4vw,86px)" />
                  <div className="absolute right-0 top-1 hidden flex-col items-end gap-1 sm:flex">
                    <Kana size={12} colour={DR.colour.amber}>
                      {GAME_KANA}
                    </Kana>
                    <ProductCode code="BH-2026" label="TB" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Sticker bg={DR.colour.amber} size={15} rot={-2}>
                      EVERY PLATFORM IS A TX
                    </Sticker>
                    <Sticker bg={DR.colour.paper} size={12} rot={2}>
                      {GAME_TAGLINE}
                    </Sticker>
                  </div>
                  <div className="mt-2 w-[min(90%,22rem)]">
                    <ChevronBar n={26} h={10} colour={DR.colour.signal} />
                  </div>
                </div>
                <p className="max-w-md text-xs text-fg">
                  Run and jump across mainnet as it happens. Each platform is a real transaction, sized by its bytes. Stomp or dash token transfers, bounce off social posts, beat the reorg wall to every block gate.
                </p>
                <div className="flex flex-wrap gap-1 text-[10px]" style={{ fontFamily: DR.font.mono }}>
                  {(['payment', 'blast', 'token', 'inscription', 'social', 'data'] as const).map((k) => (
                    <span key={k} className="flex items-center gap-1 bg-black/50 px-1.5 py-0.5" title={KIND_STYLE[k].name}>
                      <span className="inline-block h-2.5 w-2.5" style={{ background: KIND_STYLE[k].color, boxShadow: `0 0 6px ${KIND_STYLE[k].color}` }} />
                      <span className="text-white">{KIND_STYLE[k].tag}</span>
                      <span className="text-dim">{k === 'payment' ? 'coins' : k === 'blast' ? 'coin row' : k === 'token' ? 'enemy' : k === 'inscription' ? 'slab' : k === 'social' ? 'spring' : 'crumbles'}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim" style={{ fontFamily: DR.font.mono }}>
                  <span>
                    <b className="text-white">←→ / A D</b> run
                  </span>
                  <span>
                    <b className="text-white">SPACE / W</b> jump (hold = higher)
                  </span>
                  <span>
                    <b className="text-white">SHIFT / X</b> dash
                  </span>
                  <span>
                    <b className="text-white">AT A WALL</b> slide + jump to kick off
                  </span>
                </div>
                <CoinOpButtons co={co} start={(p) => start(p)} />
                <button onClick={() => setShowLive((v) => !v)} aria-pressed={showLive} className={`btn self-start px-3 py-1 text-sm ${showLive ? 'btn-on' : ''}`}>
                  ⚡ LIVE BLAST · every jump is a tx {showLive ? '▴' : '▾'}
                </button>
                {showLive && liveEl}
                <div className="flex flex-wrap items-center gap-2 text-[10px] tracking-widest text-dim">
                  <span>QUALITY</span>
                  {(['auto', 'low', 'high'] as const).map((qp) => (
                    <button key={qp} onClick={() => setQualityPref(qp)} aria-pressed={qp === qualityPref} className="border px-2 py-0.5" style={{ borderColor: qp === qualityPref ? DR.colour.amber : '#333', color: qp === qualityPref ? DR.colour.amber : '#999', ...(qp === qualityPref ? halftone(DR.colour.amber, 8, 0.2) : {}) }}>
                      {qp.toUpperCase()}
                    </button>
                  ))}
                  {perf && <span className="ml-auto">{perf.fps} FPS</span>}
                </div>
                {best > 0 && (
                  <p className="text-[11px] tracking-widest" style={{ color: DR.colour.amber }}>
                    YOUR BEST {best.toLocaleString('en-GB')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Game over poster ── */}
          {phase === 'over' && (
            <div className="absolute inset-0 overflow-y-auto bg-black/80 p-2 sm:p-4">
              <PosterFrame accent={accent} code="BH-OVER" kana="ゲームオーバー" className="mx-auto max-w-[44rem]">
                <div className="flex flex-col items-center gap-3 p-3 text-center sm:p-5">
                  <Display size="clamp(44px,9vw,104px)" colour={DR.colour.signal} style={{ textShadow: '0.04em 0.04em 0 #000' }}>
                    REORGED
                  </Display>
                  {newBest && (
                    <Sticker bg={DR.colour.acid} size={18} rot={-3}>
                      NEW PERSONAL BEST
                    </Sticker>
                  )}
                  <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4" style={hudFont}>
                    {[
                      ['SCORE', result ? result.score.toLocaleString('en-GB') : '0', DR.colour.signal],
                      ['DISTANCE', `${(result?.dist ?? 0).toLocaleString('en-GB')} M`, DR.colour.paper],
                      ['BLOCKS', String(result?.blocks ?? 0), DR.colour.cyan],
                      ['STOMPS', String(result?.stomps ?? 0), DR.colour.acid],
                    ].map(([k, v, c]) => (
                      <div key={k} className="bg-black/70 px-2 py-1.5">
                        <div className="text-[10px] tracking-widest" style={{ color: c, fontFamily: DR.font.mono, fontStyle: 'normal' }}>
                          {k}
                        </div>
                        <div className="text-3xl tabular-nums text-white">{v}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-dim">
                    {(result?.coins ?? 0).toLocaleString('en-GB')} coins · {result?.tokens ?? 0} tokens · {built.toLocaleString('en-GB')} live transactions became ground · best {best.toLocaleString('en-GB')}
                  </p>
                  {liveRun && (
                    <p className="text-xs" style={{ color: DR.colour.cyan }}>
                      {onChain.toLocaleString('en-GB')} transactions on chain this run
                      {lastTx && (
                        <>
                          {' · '}
                          <a href={`https://whatsonchain.com/tx/${lastTx}`} target="_blank" rel="noopener noreferrer" className="underline">
                            last tx ↗
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  <LootLine haul={lastRun} />
                  {result && <HighScores game="hopper" score={result.score} secs={Math.max(1, Math.round(result.secs))} live={run.paid} txid={run.txid} meta={run.paid ? { coinop: 1 } : undefined} />}
                  <CoinOpButtons co={co} start={(p) => start(p)} />
                  <button onClick={() => setShowLive((v) => !v)} aria-pressed={showLive} className={`btn px-3 py-1 text-sm ${showLive ? 'btn-on' : ''}`}>
                    ⚡ LIVE BLAST · every jump is a tx {showLive ? '▴' : '▾'}
                  </button>
                  {showLive && liveEl}
                </div>
              </PosterFrame>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        The level is mainnet, live: width is tx size; payments leave coins in the gaps, blasts are coin rows, token transfers walk out as enemies wearing their token (stomp or dash them, then grab the token), social posts are springs to bonus slabs, data txs crumble, and every new block is a checkpoint gate with an extra life. The reorg wall always moves a little slower than you can run.
      </p>
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      {co.chooserEl}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}
