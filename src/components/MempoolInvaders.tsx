'use client';

/**
 * Mempool Invaders: the shell (title poster, HUD, pause, results, touch) around the three.js game in
 * src/lib/invaders/engine.ts. Every invader is a live BSV transaction; shoot the gold token ships and catch the
 * BSV-21 token they drop. Coin-op: 10p buys a credit, a credit is one game of 3 lives (src/lib/coinop.ts);
 * PRACTICE is free. Visual language: src/components/dr.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HighScores } from './HighScores';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { GameAudio } from './SoundToggle';
import { useGameFullscreen } from '@/lib/useGameFullscreen';
import { ChevronBar, Display, HazardBar, Kana, Pictogram, PosterFrame, ProductCode, Sticker, gridBg } from './dr';
import { drDisplay, drFontClass, drJp, drMono } from './dr/fonts';
import { DR } from '@/lib/dr/tokens';
import { useLoot, type Haul } from '@/lib/loot';
import { useBlaster } from '@/lib/useBlaster';
import { TOKEN_FEE } from '@/lib/gun';
import { GAME_COINS, houseFirst, houseHeld, type GameCoin } from '@/lib/gameCoins';
import { WalletChooser } from './WalletChooser';
import { BuyHouse, HouseBadge } from './HouseAmmo';
import { useChainFeed } from '@/lib/useChainFeed';
import { setFonts } from '@/lib/invaders/art';
import { GAME_KANA, GAME_NAME, GAME_SLUG, GAME_TAGLINE } from '@/lib/invaders/brand';
import { InvadersEngine, type Banner, type BoardRow, type Hud, type Phase, type Result, type Toast } from '@/lib/invaders/engine';
import { INV_EVENTS, SHIP_COLOURS, validateInvCfg, type InvCfg } from '@/lib/invaders/mp';
import { cleanRoomCode, type RaceInfo, type RacePlayer } from '@/lib/racemp/session';
import { useRaceRoom } from '@/lib/racemp/useRaceRoom';
import { RaceLobby } from './racemp/RaceLobby';
import { IdentityPicker, PlayerBadge, useMyHandle } from './PlayerBadge';
import { KIND_HEX, KIND_NAME, KIND_ORDER, KIND_POINTS, POWER_META, POWERS, type Power } from '@/lib/invaders/sim';

/** LIVE token-blasting: every shot / purge / power-up is one tiny real tx (1 sat or 1 token to the house + network fee), paid from loaded ammo. */
const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU'; // bCorp's receiving address (public, not a key)
const PER_ACTION = 1;
const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB
const LOADS = [1_000, 10_000, 100_000];
const TOKEN_LOADS = [10, 100, 1_000];
/** This game's own coin, listed first when one exists in gameCoins (none yet: the wallet's own tokens are offered). */
const HOUSE_COIN = (GAME_COINS as Record<string, GameCoin | undefined>)[GAME_SLUG];
type QualityPref = 'auto' | 'low' | 'high';
const PREFS = `tokenblaster:${GAME_SLUG}-prefs`;
const BEST = `tokenblaster:${GAME_SLUG}-best`;
const hudFont = { fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase' } as const;
const PICTO: Record<Power, 'bolt' | 'arrow' | 'turbo' | 'shield' | 'mine'> = { spread: 'turbo', rail: 'arrow', overdrive: 'bolt', shield: 'shield', bomb: 'mine' };

const isMobileish = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Boolean(coarse) || mem <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 720;
};

/** HUD nodes written straight to the DOM from the engine loop, without React renders. */
class HudDom {
  private n: Record<string, HTMLElement | null> = {};
  private v: Record<string, string> = {};
  ref = (k: string) => (el: HTMLElement | null) => {
    this.n[k] = el;
  };
  text(k: string, t: string) {
    const el = this.n[k];
    if (el && this.v[k] !== t) {
      this.v[k] = t;
      el.textContent = t;
    }
  }
  css(k: string, st: Partial<CSSStyleDeclaration>) {
    const el = this.n[k];
    if (el) Object.assign(el.style, st);
  }
  update(h: Hud) {
    this.text('score', h.score.toLocaleString());
    this.text('hi', `HI ${Math.max(h.hi, h.score).toLocaleString()}`);
    this.text('wave', `WAVE ${h.wave}`);
    this.text('mult', `×${h.mult}`);
    this.css('mult', { transform: `scale(${1 + h.beat * 0.12 + (h.mult > 1 ? 0.1 : 0)}) skewX(-8deg)`, opacity: h.combo > 0 ? '1' : '0.35', color: h.mult >= 5 ? DR.colour.amber : h.mult >= 3 ? DR.colour.acid : DR.colour.paper });
    this.css('comboBar', { width: `${Math.round(h.comboT * 100)}%`, background: h.comboT < 0.3 ? DR.colour.signal : DR.colour.cyan });
    this.text('comboTxt', h.combo > 0 ? `${h.combo} CHAIN${h.nextAt ? ` · NEXT ×${h.mult + 1} AT ${h.nextAt}` : ' · MAX'}` : 'KILL TO CHAIN');
    this.css('press', { width: `${Math.round(h.pressure * 100)}%`, background: h.pressure > 0.66 ? DR.colour.signal : h.pressure > 0.33 ? DR.colour.amber : DR.colour.cyan });
    this.text('pressTxt', `${h.txs < 0.1 ? 'QUIET' : `${h.txs.toFixed(h.txs < 10 ? 1 : 0)} TX/S`}`);
    this.text('left', `${h.left} IN RANGE`);
    this.css('beat', { opacity: String(0.25 + h.beat * 0.75), transform: `scaleX(${1 + h.beat * 0.04})` });
    this.css('bossBox', { display: h.boss ? 'block' : 'none' });
    if (h.boss) {
      this.text('bossName', h.boss.name);
      this.css('bossBar', { width: `${Math.round(h.boss.hp * 100)}%`, background: h.boss.hp < 0.5 ? DR.colour.signal : DR.colour.amber });
    }
    for (const k of ['spread', 'rail', 'overdrive'] as const) {
      const p = h.powers.find((x) => x.key === k);
      this.css(`pw-${k}`, { display: p ? 'flex' : 'none' });
      if (p) this.css(`pwBar-${k}`, { width: `${Math.round(p.t * 100)}%` });
    }
  }
}

type Slow = { lives: number; bombs: number; shield: boolean };
type BannerState = Banner & { id: number };

export function MempoolInvaders() {
  const mount = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  // Coin-op: 10p buys a credit, a credit is one game of 3 lives (src/lib/coinop.ts). Practice is free.
  const co = useCoinOp(GAME_NAME, GAME_SLUG);
  const [run, setRun] = useState<{ paid: boolean; txid: string | null; live?: boolean }>({ paid: false, txid: null });
  const loot = useLoot(GAME_SLUG);
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);
  const engine = useRef<InvadersEngine | null>(null);
  const [lastRun, setLastRun] = useState<Haul>({});
  const [phase, setPhase] = useState<Phase>('loading');
  const [loading, setLoading] = useState({ msg: 'Starting', pct: 0 });
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [ready, setReady] = useState(false);
  const [best, setBest] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [slow, setSlow] = useState<Slow>({ lives: 3, bombs: 1, shield: false });
  const slowRef = useRef<Slow>(slow);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const toastId = useRef(0);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const bannerId = useRef(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [perf, setPerf] = useState<{ fps: number; level: number } | null>(null);
  const [touch, setTouch] = useState(false);
  const [hud] = useState(() => new HudDom());
  const bestRef = useRef(0);
  // ── LIVE mode: the same pay-per-action path as Chain Frogger (queue + drain, useBlaster ammo) ──
  const b = useBlaster();
  const [liveOn, setLiveOn] = useState(false);
  const [payWith, setPayWith] = useState<'sats' | 'token'>('sats');
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [needAmmo, setNeedAmmo] = useState(false);
  // ── Multiplayer: CO-OP / VERSUS rooms (lobby, quick match, private ?room=CODE) via src/lib/racemp ──
  const xHandle = useMyHandle();
  const [mpMode, setMpMode] = useState<InvCfg['mode']>('coop');
  const [joinCode, setJoinCode] = useState('');
  const [board, setBoard] = useState<{ rows: BoardRow[]; mode: InvCfg['mode']; team: number } | null>(null);
  const pendingGo = useRef<RaceInfo<InvCfg> | null>(null);
  const [goTick, setGoTick] = useState(0);
  const room = useRaceRoom<InvCfg>({
    game: 'invaders',
    enabled: ready,
    wallet: b.wallet?.client ?? null,
    profile: { name: xHandle ?? 'PILOT', vehicle: 'ship', team: '', x: xHandle ?? undefined },
    cfg: { mode: mpMode },
    quickKey: (c) => c.mode,
    sameCfg: (x, y) => x.mode === y.mode,
    validateCfg: validateInvCfg,
    events: INV_EVENTS,
    onRemoteCfg: (c) => setMpMode(c.mode),
    onGo: (race) => {
      pendingGo.current = race;
      setGoTick((t) => t + 1);
    },
  });
  const mpOn = room.info !== null;
  const meId = room.info?.id ?? null;
  const meRow = room.ui.players.find((x) => x.id === meId) ?? null;
  const locked = mpOn && !room.info?.quick && room.ui.leader !== meId && room.ui.players.length > 1;
  const payTok = payWith === 'token' && !!b.token && b.mode === 'tokens';
  const payRef = useRef({ paid: false, sats: 0, queued: 0, tok: false, tokens: 0 });
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
  /** One real transaction per action, chained in batches off the frame loop. */
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
        if (!txids.length) throw new Error('Out of ammo: load more to keep firing.');
      } catch (e) {
        setPayErr(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  /** Ask to pay for an action; false = no ammo, so the game refuses it. Practice and credit games are free here. */
  const payFor = useRef((action: string[]) => {
    const pr = payRef.current;
    if (!pr.paid) return true;
    const n = pr.queued + 1;
    if (pr.tok ? pr.tokens < n || pr.sats < n * TOKEN_FEE : pr.sats - n * (PER_ACTION + EST_FEE) < 0) return false;
    queue.current.push(['invaders', ...action]);
    pr.queued = queue.current.length;
    void drain.current();
    return true;
  });
  const heldTok = b.token ? houseHeld(b.tokens, { id: b.token.id } as GameCoin) : 0;
  const actionsLeft = payTok ? Math.min(Math.floor(b.tokenAmmo), Math.floor(b.ammo / TOKEN_FEE)) : Math.floor(b.ammo / (PER_ACTION + EST_FEE));
  const chooseSats = () => {
    b.setMode('sats');
    setPayWith('sats');
  };
  const chooseToken = (id?: string) => {
    const t = b.tokens.find((x) => x.id === (id ?? b.token?.id)) ?? b.tokens[0];
    if (!t) return;
    b.setToken(t);
    b.setMode('tokens');
    setPayWith('token');
  };

  useEffect(() => {
    setFonts({ display: drDisplay.style.fontFamily, mono: drMono.style.fontFamily, jp: drJp.style.fontFamily });
    void Promise.resolve().then(() => {
      setTouch(Boolean(window.matchMedia?.('(pointer: coarse)').matches));
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { q?: QualityPref };
        if (p.q === 'auto' || p.q === 'low' || p.q === 'high') setQualityPref(p.q);
        const b = Number(localStorage.getItem(BEST) ?? 0) || 0;
        bestRef.current = b;
        setBest(b);
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
      const s = slowRef.current;
      if (s.lives !== h.lives || s.bombs !== h.bombs || s.shield !== h.shield) {
        slowRef.current = { lives: h.lives, bombs: h.bombs, shield: h.shield };
        setSlow(slowRef.current);
      }
    },
    [hud],
  );

  useEffect(() => {
    const host = mount.current;
    if (!host || !ready) return;
    const life = { dead: false };
    const q: 'low' | 'high' = qualityPref === 'auto' ? (isMobileish() ? 'low' : 'high') : qualityPref;
    void Promise.resolve().then(() => {
      if (life.dead) return;
      setPhase('loading');
      setLoading({ msg: 'Starting', pct: 0 });
      setError(null);
    });
    const eng = new InvadersEngine(host, {
      quality: q,
      hi: bestRef.current,
      take: (p) => feedRef.current.take(p),
      payFor: (a) => payFor.current(a),
      waiting: () => feedRef.current.waiting(),
      status: () => feedRef.current.status,
      cb: {
        onPhase: (p) => !life.dead && setPhase(p),
        onHud,
        onToast: (t) => !life.dead && pushToast(t),
        onBanner: (b) => {
          if (life.dead) return;
          const id = ++bannerId.current;
          setBanner({ ...b, id });
          setTimeout(() => !life.dead && setBanner((x) => (x && x.id === id ? null : x)), 2300);
        },
        onLoading: (msg, pct) => !life.dead && setLoading({ msg, pct }),
        onLoot: (l) => lootRef.current.pickup(l),
        onFlash: (k) => {
          if (life.dead) return;
          setFlash(k);
          setTimeout(() => !life.dead && setFlash(null), 380);
        },
        onPerf: (p) => !life.dead && setPerf(p),
        onNoAmmo: () => !life.dead && setNeedAmmo(true),
        onBoard: (rows, mode, team) => !life.dead && setBoard({ rows, mode, team }),
        onOver: (r) => {
          if (life.dead) return;
          setResult(r);
          setLastRun({ ...lootRef.current.run });
          lootRef.current.end();
          if (r.score > bestRef.current) {
            bestRef.current = r.score;
            setBest(r.score);
            try {
              localStorage.setItem(BEST, String(r.score));
            } catch {
              /* storage blocked */
            }
          }
        },
      },
    });
    engine.current = eng;
    eng
      .init()
      .then(() => {
        if (life.dead) return;
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __invaders?: InvadersEngine }).__invaders = eng;
      })
      .catch((e: unknown) => {
        if (!life.dead) setError(e instanceof Error ? e.message : 'Could not start the 3D scene');
      });
    // Fonts used by the canvas labels (best effort, never blocks).
    void Promise.race([Promise.all([document.fonts.load(`900 40px ${drDisplay.style.fontFamily}`), document.fonts.load(`700 20px ${drMono.style.fontFamily}`)]), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
    return () => {
      life.dead = true;
      eng.dispose();
      if (engine.current === eng) engine.current = null;
    };
  }, [ready, qualityPref, session, onHud, pushToast, payFor]);

  /** Start a game: a credit game spends one credit (its coin's txid goes with the run), practice is free. */
  const start = (paid: boolean, live = false) => {
    const eng = engine.current;
    if (!eng) return;
    if (live && actionsLeft < 1) {
      setLiveOn(true);
      setNeedAmmo(true);
      return;
    }
    payRef.current.paid = live;
    setNeedAmmo(false);
    if (live) {
      counter.current = 0;
      setOnChain(0);
      setLastTx(null);
    }
    const txid = paid && !live ? co.consume() : null;
    if (paid && !live && !txid) return;
    lootRef.current.end();
    setLastRun({});
    setResult(null);
    setBoard(null);
    setRun({ paid: paid || live, txid, live });
    slowRef.current = { lives: 3, bombs: 1, shield: false };
    setSlow(slowRef.current);
    eng.begin();
  };

  // The room leader said GO: start as soon as this engine is idle at the title (or results) screen.
  const mpLiveReady = useRef(false);
  useEffect(() => {
    const race = pendingGo.current;
    const link = room.getLink();
    const eng = engine.current;
    if (!race || !link || !goTick || !eng) return;
    if (phase !== 'menu' && phase !== 'over') return;
    pendingGo.current = null;
    eng.opts.mp = link;
    eng.opts.me = { name: xHandle ?? 'PILOT', handle: xHandle };
    const live = mpLiveReady.current;
    void Promise.resolve().then(() => start(false, live));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTick, phase]);
  const mpBack = () => {
    setResult(null);
    setBoard(null);
    room.endRace();
    if (engine.current) engine.current.opts.mp = undefined;
    engine.current?.toMenu();
  };

  const playing = phase === 'playing' || phase === 'paused';
  const gfs = useGameFullscreen(wrap, {
    playing,
    ended: phase === 'over',
    payFailed: Boolean(co.msg && !co.msg.ok),
    onLeftWhilePlaying: () => engine.current?.pause(true),
  });
  const { fs, cover } = { fs: gfs.fs, cover: gfs.cover };
  const fullscreen = gfs.toggle;

  const accent = DR.colour.signal;
  const hullPips = Array.from({ length: 3 }, (_, i) => i < slow.lives);

  const hasWallet = !!b.wallet;
  const tokHeld = payTok && b.token ? Math.max(0, Math.floor(b.tokens.find((t) => t.id === b.token!.id)?.balance ?? heldTok)) : 0;
  const ammoPanel = (
    <div className="inset flex flex-col gap-2 bg-black/80 px-3 py-2 text-sm" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold tracking-widest text-hot">LIVE AMMO</span>
        <span className="text-dim">Every shot is a tiny real transaction.</span>
      </div>
      {!hasWallet ? (
        <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on self-start px-3 py-1">
          {b.busy === 'connecting' ? 'CONNECTING…' : '1 · CONNECT WALLET'}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-dim">PAY:</span>
            <button onClick={chooseSats} disabled={!!b.busy} className={`btn ${!payTok ? 'btn-on' : ''}`}>
              SATS
            </button>
            <button onClick={() => chooseToken()} disabled={!!b.busy || !b.tokens.length} title={b.tokens.length ? '1 token per action' : 'Your wallet holds no tokens'} className={`btn flex items-center gap-1 disabled:opacity-40 ${payTok ? 'btn-on' : ''}`}>
              ${b.token?.sym ?? 'TOKEN'} {HOUSE_COIN && b.token?.id === HOUSE_COIN.id && <HouseBadge label="HOUSE" />}
            </button>
            {payTok && b.tokens.length > 1 && (
              <select value={b.token?.id ?? ''} onChange={(e) => chooseToken(e.target.value)} className="border border-[var(--border-dim)] bg-input px-1 py-0.5 text-hot" aria-label="Token to pay with">
                {houseFirst(b.tokens, HOUSE_COIN).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.sym}
                  </option>
                ))}
              </select>
            )}
            {HOUSE_COIN && !houseHeld(b.tokens, HOUSE_COIN) && <BuyHouse coin={HOUSE_COIN} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-dim">{payTok ? `1 $${b.token?.sym} + ~${TOKEN_FEE} sats fee` : `${PER_ACTION} sat + ~${EST_FEE} sats fee`} per action ·</span>
            <span className="text-hot">{actionsLeft.toLocaleString()} actions loaded</span>
            {(payTok ? TOKEN_LOADS.filter((n) => n <= tokHeld) : LOADS).map((n) => (
              <button key={n} onClick={() => (payTok ? void b.loadTokenAmmo(n) : b.load(n, `Mempool Invaders: ${n.toLocaleString()} sats of ammo`))} disabled={!!b.busy} className="btn">
                {b.busy ? 'APPROVE…' : `LOAD ${n.toLocaleString()} ${payTok ? `$${b.token?.sym}` : 'sats'}`}
              </button>
            ))}
            {(b.ammo > 0 || b.gunTokens.length > 0) && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn">
                UNLOAD
              </button>
            )}
          </div>
          {payTok && b.tokenAmmo < 1 && <p className="font-bold text-hot">Load some ${b.token?.sym} first (and a few sats for fees), then press START LIVE.</p>}
        </>
      )}
      {needAmmo && actionsLeft < 1 && <p className="font-bold text-hot">Needs ammo: load some above, approve it, then START LIVE.</p>}
      {(payErr || b.error) && <p className="text-hot">⚠ {payErr ?? b.error}</p>}
      <button onClick={() => { if (actionsLeft >= 1 && hasWallet) gfs.enter(); start(true, true); }} disabled={actionsLeft < 1 || !hasWallet} className="btn btn-on self-start px-4 py-2 disabled:opacity-40">
        ⚡ START LIVE · {actionsLeft.toLocaleString()} ACTIONS
      </button>
    </div>
  );

  return (
    <section className={`panel ${drFontClass}`} style={{ fontFamily: DR.font.mono }}>
      <GameAudio track="invaders" />
      <div className="panel-header">
        <span className="panel-title">{GAME_NAME}</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE: INVADERS ARE MAINNET TXS
            </>
          ) : feed.status === 'off' ? (
            'no feed configured: ghost txs only'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="relative" style={{ height: 'min(80vh, 820px)', minHeight: 460 }}>
        <div ref={wrap} className={`select-none overflow-hidden bg-black ${cover ? 'fixed inset-0 z-[90]' : 'absolute inset-0'}`} style={cover ? { height: '100dvh' } : undefined}>
          <div ref={mount} data-invaders-canvas className="absolute inset-0 touch-none" />
          {flash && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: flash === 'hit' ? 'rgba(232,38,29,0.3)' : flash === 'bomb' ? 'rgba(255,184,0,0.35)' : flash === 'power' ? 'rgba(39,230,255,0.14)' : 'rgba(255,255,255,0.05)' }}
            />
          )}

          {/* ── HUD ── */}
          <div className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${playing ? 'opacity-100' : 'opacity-0'}`}>
            <style>{`@keyframes miBan { 0% { transform: translateX(-60px) skewX(-10deg); opacity: 0 } 14% { transform: translateX(0) skewX(-10deg); opacity: 1 } 80% { opacity: 1 } 100% { transform: translateX(40px) skewX(-10deg); opacity: 0 } }
              @keyframes miToast { 0% { transform: translateY(8px) rotate(-2deg); opacity: 0 } 12% { transform: none; opacity: 1 } 85% { opacity: 1 } 100% { opacity: 0 } }`}</style>
            {/* Score */}
            <div className="absolute left-2 top-2 flex items-stretch sm:left-3 sm:top-3">
              <div className="px-2 py-0.5 sm:px-3 sm:py-1" style={{ background: accent, ...hudFont }}>
                <div ref={hud.ref('score')} className="text-3xl tabular-nums text-white sm:text-6xl" style={{ lineHeight: 0.86 }}>
                  0
                </div>
              </div>
              <div className="flex flex-col justify-between bg-black/70 px-2 py-0.5" style={hudFont}>
                <span ref={hud.ref('wave')} className="text-base text-white sm:text-2xl">
                  WAVE 1
                </span>
                <span ref={hud.ref('hi')} className="text-[10px] sm:text-xs" style={{ color: DR.colour.amber }}>
                  HI 0
                </span>
              </div>
            </div>
            {/* Hull + bombs */}
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1 sm:right-3 sm:top-3">
              <div className="flex items-center gap-1.5 bg-black/65 px-2 py-1">
                <span className="text-[10px]" style={{ ...hudFont, color: DR.colour.grey }}>
                  HULL
                </span>
                {hullPips.map((on, i) => (
                  <span key={i} className="inline-block h-3.5 w-5 sm:h-4 sm:w-6" style={{ background: on ? DR.colour.acid : 'rgba(255,255,255,0.12)', clipPath: 'polygon(0 100%, 50% 0, 100% 100%, 50% 75%)' }} />
                ))}
                {slow.shield && <Pictogram name="shield" size={18} colour={DR.colour.blue} />}
              </div>
              <div className="flex items-center gap-1 bg-black/65 px-2 py-1">
                <span className="text-[10px]" style={{ ...hudFont, color: DR.colour.grey }}>
                  PURGE
                </span>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="inline-block" style={{ opacity: i < slow.bombs ? 1 : 0.18 }}>
                    <Pictogram name="mine" size={16} colour={DR.colour.amber} />
                  </span>
                ))}
              </div>
              <div className="pointer-events-auto flex gap-1">
                <button onClick={() => engine.current?.pause(phase !== 'paused')} className="btn px-2 py-1 text-xs" aria-label="Pause">
                  {phase === 'paused' ? '▶' : 'Ⅱ'}
                </button>
                <button onClick={fullscreen} className="btn px-2 py-1 text-xs" aria-label="Fullscreen">
                  ⛶
                </button>
              </div>
            </div>
            {/* Boss bar */}
            <div ref={hud.ref('bossBox')} className="absolute left-1/2 top-2 hidden w-[min(46vw,460px)] -translate-x-1/2 sm:top-3 max-sm:top-16">
              <div className="flex items-baseline justify-between px-1" style={hudFont}>
                <span ref={hud.ref('bossName')} className="text-lg" style={{ color: DR.colour.amber }}>
                  BLOCK
                </span>
                <span className="text-xs text-white">BOSS</span>
              </div>
              <div className="h-3 bg-black/70" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 14px, rgba(0,0,0,0.9) 14px 16px)' }}>
                <div ref={hud.ref('bossBar')} className="h-full" style={{ width: '100%', background: DR.colour.amber }} />
              </div>
            </div>
            {/* Combo */}
            <div className="absolute bottom-3 right-2 flex flex-col items-end sm:right-3 max-sm:bottom-[5.8rem]">
              <div className="flex items-end gap-2 bg-black/55 px-3 py-1">
                <span ref={hud.ref('mult')} className="text-5xl tabular-nums text-white sm:text-7xl" style={{ ...hudFont, lineHeight: 0.84, display: 'inline-block', transformOrigin: 'bottom center' }}>
                  ×1
                </span>
                <span className="pb-1 text-xs" style={{ ...hudFont, color: DR.colour.amber }}>
                  COMBO
                </span>
              </div>
              <div className="h-1.5 w-[min(44vw,240px)] bg-black/70">
                <div ref={hud.ref('comboBar')} className="h-full" style={{ width: '0%', background: DR.colour.cyan }} />
              </div>
              <span ref={hud.ref('comboTxt')} className="mt-0.5 bg-black/55 px-2 text-[10px] tracking-widest text-white/80">
                KILL TO CHAIN
              </span>
              <div ref={hud.ref('beat')} className="mt-1 w-[min(44vw,240px)]">
                <ChevronBar n={22} h={5} colour={DR.colour.cyan} />
              </div>
            </div>
            {/* Mempool pressure + power-ups */}
            <div className="absolute bottom-3 left-2 flex flex-col gap-1 sm:left-3 max-sm:bottom-[5.8rem]">
              {POWERS.filter((k) => k === 'spread' || k === 'rail' || k === 'overdrive').map((k) => (
                <div key={k} ref={hud.ref(`pw-${k}`)} className="hidden items-center gap-1.5 bg-black/70 px-2 py-0.5" style={{ borderLeft: `4px solid ${POWER_META[k].colour}` }}>
                  <Pictogram name={PICTO[k]} size={14} colour={POWER_META[k].colour} />
                  <span className="w-20 text-xs" style={{ ...hudFont, color: POWER_META[k].colour }}>
                    {POWER_META[k].label}
                  </span>
                  <div className="h-1.5 w-14 bg-white/15">
                    <div ref={hud.ref(`pwBar-${k}`)} className="h-full" style={{ width: '100%', background: POWER_META[k].colour }} />
                  </div>
                </div>
              ))}
              <div className="w-[min(40vw,190px)] bg-black/65 px-2 py-1">
                <div className="flex items-baseline justify-between" style={hudFont}>
                  <span className="text-[10px]" style={{ color: DR.colour.grey }}>
                    MEMPOOL
                  </span>
                  <span ref={hud.ref('pressTxt')} className="text-xs text-white">
                    QUIET
                  </span>
                </div>
                <div className="h-1.5 bg-white/15">
                  <div ref={hud.ref('press')} className="h-full transition-[width] duration-500" style={{ width: '10%', background: DR.colour.cyan }} />
                </div>
                <span ref={hud.ref('left')} className="text-[9px] tracking-widest text-white/50">
                  0 IN RANGE
                </span>
              </div>
            </div>
            {run.live && (
              <div className="absolute left-1/2 top-[3.6rem] -translate-x-1/2 bg-black/70 px-3 py-0.5 text-center sm:top-1" data-invaders-tx>
                <span className="text-sm font-bold tabular-nums" style={{ ...hudFont, color: DR.colour.cyan }}>
                  {onChain.toLocaleString()} TX ON CHAIN
                </span>
                <span className="ml-2 text-[10px] tracking-widest text-white/70">{actionsLeft.toLocaleString()} LEFT</span>
                {needAmmo && <span className="ml-2 text-[10px] font-bold tracking-widest" style={{ color: DR.colour.signal }}>OUT OF AMMO</span>}
              </div>
            )}
            {/* Multiplayer scoreboard */}
            {board && board.rows.length > 1 && phase !== 'over' && (
              <div className="pointer-events-none absolute right-2 top-[8.8rem] w-[min(46vw,230px)] bg-black/70 px-1.5 py-1 sm:right-3 sm:top-[11rem]" data-invaders-board={board.mode}>
                <div className="flex items-baseline justify-between text-[9px] tracking-widest text-white/60" style={hudFont}>
                  <span>{board.mode === 'coop' ? 'CO-OP' : 'VERSUS'}</span>
                  {board.mode === 'coop' && <span style={{ color: DR.colour.amber }}>TEAM {board.team.toLocaleString()}</span>}
                </div>
                {board.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-1 py-px text-[11px]" style={{ opacity: r.down ? 0.45 : 1, borderLeft: `3px solid ${r.colour}`, paddingLeft: 3 }} data-board-row={r.handle ?? r.name}>
                    <PlayerBadge handle={r.handle} name={r.name} verified={r.verified} ring={r.colour} size={14} className={`min-w-0 flex-1 ${r.me ? 'text-white' : 'text-white/80'}`} />
                    <span className="text-[9px] text-white/60">{r.down ? 'DOWN' : '♥'.repeat(Math.max(0, r.lives))}</span>
                    <span className="w-14 text-right tabular-nums text-white" style={hudFont}>
                      {r.score.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Loot + mode */}
            <div className="absolute right-2 top-[6.6rem] flex flex-col items-end gap-1 text-xs sm:right-3 sm:top-[8.6rem]">
              <span className="bg-black/60 px-2 py-0.5 text-[#ffd36a]">
                <LootHud haul={loot.run} max={3} />
              </span>
            </div>
            <div className="absolute left-2 top-[4.4rem] max-sm:max-w-[58vw] max-sm:overflow-hidden max-sm:text-ellipsis max-sm:whitespace-nowrap sm:left-3 sm:top-[5.4rem]">
              <span className={`border bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest ${run.paid ? 'border-[#ffd36a] text-[#ffd36a]' : 'border-white/20 text-dim'}`} data-invaders-mode={run.live ? 'live' : run.paid ? 'paid' : 'practice'}>
                {run.live ? 'LIVE · EVERY SHOT ON CHAIN' : coinOpModeLabel(run.paid, co.credits)}
              </span>
            </div>
            {/* Toasts */}
            <div className="absolute left-2 top-[7.4rem] flex flex-col items-start gap-1 sm:left-3 sm:top-[9rem]">
              {toasts.map((t) => (
                <div key={t.id} style={{ animation: 'miToast 2.4s ease-out both' }}>
                  <Sticker bg={t.tone === 'good' ? DR.colour.acid : t.tone === 'bad' ? DR.colour.signal : DR.colour.paper} fg={t.tone === 'bad' ? '#fff' : '#111'} size={15} rot={-2}>
                    {t.text}
                  </Sticker>
                </div>
              ))}
            </div>
            {/* Wave banner */}
            {banner && (
              <div key={banner.id} className="absolute inset-x-0 top-[26%] flex flex-col items-center" style={{ animation: 'miBan 2.3s ease-out both' }}>
                <Display size="clamp(54px, 11vw, 150px)" colour={banner.tone === 'boss' ? DR.colour.amber : banner.tone === 'clear' ? DR.colour.acid : DR.colour.paper} style={{ WebkitTextStroke: '3px #000', textShadow: '0 8px 0 #000, 0 0 40px rgba(232,38,29,0.5)' }}>
                  {banner.title}
                </Display>
                <div className="mt-2 bg-black/75 px-3 py-1" style={{ ...hudFont, color: DR.colour.cyan, fontSize: 'clamp(12px, 2vw, 20px)' }}>
                  {banner.sub}
                </div>
                <div className="mt-2 w-[min(70vw,520px)]">
                  <ChevronBar n={26} h={10} colour={banner.tone === 'boss' ? DR.colour.signal : DR.colour.amber} />
                </div>
              </div>
            )}
          </div>

          {/* ── Touch: bomb + hint (drag the ship, it auto-fires) ── */}
          {touch && phase === 'playing' && (
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <span className="bg-black/55 px-2 py-1 text-[10px] tracking-widest text-white/70">DRAG TO MOVE · AUTO-FIRE</span>
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (engine.current) engine.current.touch.bomb = true;
                }}
                onContextMenu={(e) => e.preventDefault()}
                className="btn btn-on h-14 w-20 touch-none text-xs"
              >
                PURGE
              </button>
            </div>
          )}

          {/* ── Loading ── */}
          {phase === 'loading' && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black" style={gridBg()}>
              <Display size="clamp(44px,9vw,100px)">{GAME_NAME.split(' ')[0]}</Display>
              <Kana size={16} colour={DR.colour.amber}>
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
          {phase === 'menu' && (
            <div className="absolute inset-0 overflow-y-auto p-2 sm:p-5" style={{ background: 'linear-gradient(90deg, rgba(5,3,10,0.95) 0%, rgba(5,3,10,0.8) 44%, rgba(5,3,10,0) 76%)' }}>
              <div className="flex max-w-[35rem] flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Sticker bg={DR.colour.signal} fg="#fff" size={13} rot={-3}>
                    LIVE MAINNET
                  </Sticker>
                  <Sticker bg={DR.colour.cyan} size={13} rot={2}>
                    EVERY SHIP IS A TX
                  </Sticker>
                  <Kana size={11} colour={DR.colour.amber} className="max-sm:hidden">
                    {GAME_KANA}
                  </Kana>
                </div>
                <div className="leading-none">
                  <div>
                    <Display size="clamp(56px, 11.5vw, 148px)" colour={DR.colour.paper} style={{ textShadow: '0.04em 0.05em 0 #000' }}>
                      MEMPOOL
                    </Display>
                  </div>
                  <div className="-mt-1 sm:-mt-3">
                    <Display size="clamp(46px, 9.4vw, 120px)" colour={DR.colour.signal} style={{ textShadow: '0.04em 0.05em 0 #000', letterSpacing: '0.02em' }}>
                      INVADERS
                    </Display>
                  </div>
                </div>
                <ChevronBar n={34} h={14} colour={DR.colour.amber} />
                <p className="max-w-[30rem] text-sm text-white/90" style={{ textShadow: '0 1px 6px #000' }}>
                  {GAME_TAGLINE}. Every ship is a transaction that just hit the network. Shoot the gold token ships and catch the BSV-21 token they drop. Chain kills for a multiplier, hit on the beat for double, and when a block lands the block itself comes for you.
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {KIND_ORDER.map((k) => (
                    <span key={k} className="flex items-center gap-1 bg-black/55 px-1.5 py-0.5 text-[10px] tracking-widest text-white/85">
                      <span className="inline-block h-2.5 w-2.5" style={{ background: KIND_HEX[k], boxShadow: `0 0 8px ${KIND_HEX[k]}` }} />
                      {KIND_NAME[k]} {KIND_POINTS[k]}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tracking-widest text-white/70">
                  <span>← → / A D MOVE</span>
                  <span>SPACE FIRE</span>
                  <span>X PURGE</span>
                  <span>P PAUSE</span>
                  <span>PAD / TOUCH OK</span>
                </div>
                <CoinOpButtons co={co} start={(p) => start(p)} onPress={gfs.enter} />
                <button onClick={() => setLiveOn((v) => !v)} aria-pressed={liveOn} className={`btn self-start px-3 py-1.5 text-sm ${liveOn ? 'btn-on' : ''}`}>
                  ⚡ LIVE · TOKEN-BLAST MODE · EVERY SHOT ON CHAIN
                </button>
                {liveOn && ammoPanel}
                {room.available && (
                  <div className="inset max-w-[34rem] bg-black/70 p-2" data-invaders-mp="menu">
                    <p className="mb-1 text-[10px] tracking-widest text-dim">MULTIPLAYER · 2-4 SHIPS SIDE BY SIDE · YOUR X AVATAR OVER YOUR SHIP</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {(['coop', 'versus'] as const).map((m) => (
                        <button key={m} onClick={() => !locked && setMpMode(m)} disabled={locked} aria-pressed={mpMode === m} className={`btn px-2 py-0.5 disabled:opacity-60 ${mpMode === m ? 'btn-on' : ''}`} data-invaders-mode-pick={m}>
                          {m === 'coop' ? 'CO-OP · SHARED WAVES' : 'VERSUS · SEND THEM INVADERS'}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-dim">
                      {mpMode === 'coop' ? 'Same waves and boss for everyone, one team score. Each ship has its own lives; a downed pilot returns next wave.' : 'Same waves, but your big kills (and every third) drop extra invaders into another pilot’s lane. Highest score wins.'}
                    </p>
                    {!mpOn && (
                      <>
                        <div className="mt-1.5">
                          <IdentityPicker verified={Boolean(meId && room.verified[meId])} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <button onClick={room.joinQuick} className="btn btn-on px-3 py-1 text-sm" data-invaders-quick>
                            QUICK MATCH
                          </button>
                          <button onClick={() => room.joinPrivate()} className="btn px-3 py-1 text-sm" data-invaders-private>
                            NEW PRIVATE ROOM
                          </button>
                          <input value={joinCode} placeholder="ROOM CODE" maxLength={8} onChange={(e) => setJoinCode(cleanRoomCode(e.target.value))} className="w-24 border border-white/25 bg-black px-1.5 py-0.5 text-fg" aria-label="Room code" />
                          <button onClick={() => joinCode.length >= 3 && room.joinPrivate(joinCode)} className="btn px-2 py-0.5 text-[11px]">
                            JOIN
                          </button>
                        </div>
                      </>
                    )}
                    {mpOn && room.info && (
                      <div className="mt-1.5">
                        <RaceLobby
                          game="Mempool Invaders"
                          aiLabel="OPEN SLOT: waiting for a pilot"
                          circuit={mpMode === 'coop' ? 'CO-OP' : 'VERSUS'}
                          mine={meId}
                          code={room.info.code}
                          quick={room.info.quick}
                          status={room.ui.status}
                          players={room.ui.players}
                          leader={room.ui.leader}
                          count={room.ui.count}
                          full={room.ui.full}
                          racingElsewhere={room.ui.players.some((x) => x.st === 'racing') && !meRow?.ready}
                          colours={{ quick: '#7ae7ff', priv: '#ffd23f', ok: '#7dff9a', warn: '#ff2d2d', amber: '#ffb000' }}
                          readyLabels={{ paid: 'READY · LIVE', free: 'READY · PRACTICE' }}
                          teamColour={(x) => SHIP_COLOURS[Math.max(0, room.ui.players.indexOf(x as RacePlayer)) % SHIP_COLOURS.length]}
                          detail={() => (mpMode === 'coop' ? 'CO-OP' : 'VERSUS')}
                          onLeave={() => {
                            pendingGo.current = null;
                            room.leave();
                            if (engine.current) engine.current.opts.mp = undefined;
                          }}
                          onStart={() => room.go()}
                          verified={room.verified}
                          controls={
                            meRow?.ready ? (
                              <>
                                <span className="px-2 py-1 text-sm font-bold" style={{ background: '#7dff9a', color: '#000' }}>
                                  READY {meRow.paid ? '· LIVE' : '· PRACTICE'}
                                </span>
                                <button onClick={() => room.setReady(false)} className="btn px-2 py-0.5 text-[11px]">
                                  UNREADY
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    mpLiveReady.current = false;
                                    gfs.enter();
                                    room.setReady(true, false);
                                  }}
                                  className="btn-fire px-5 py-2 text-lg"
                                  data-invaders-ready
                                >
                                  READY · PRACTICE
                                </button>
                                <button
                                  onClick={() => {
                                    mpLiveReady.current = true;
                                    gfs.enter();
                                    room.setReady(true, true);
                                  }}
                                  disabled={actionsLeft < 1 || !hasWallet}
                                  title="Every shot is a tiny real tx from your loaded ammo (set up under LIVE above)"
                                  className="btn px-3 py-1 text-sm disabled:opacity-40"
                                >
                                  ⚡ READY · LIVE
                                </button>
                              </>
                            )
                          }
                        />
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-dim">Practice sends nothing. LIVE keeps the normal one-tx-per-shot path, paid from your own ammo.</p>
                  </div>
                )}
                <div className="flex items-center gap-1 text-[10px] tracking-widest text-dim">
                  <span>QUALITY</span>
                  {(['auto', 'low', 'high'] as const).map((q) => (
                    <button key={q} onClick={() => setQualityPref(q)} className={`btn px-2 py-0.5 ${qualityPref === q ? 'btn-on' : ''}`}>
                      {q.toUpperCase()}
                    </button>
                  ))}
                  {perf && <span className="ml-2">{perf.fps} FPS</span>}
                  {best > 0 && <span className="ml-2" style={{ color: DR.colour.amber }}>BEST {best.toLocaleString()}</span>}
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-3 right-3 hidden sm:block">
                <ProductCode code="MI-001" label="TB" colour={DR.colour.paper} />
              </div>
            </div>
          )}

          {/* ── Pause ── */}
          {phase === 'paused' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65">
              <Display size="clamp(48px,9vw,110px)" colour={DR.colour.amber}>
                PAUSED
              </Display>
              <div className="flex gap-2">
                <button onClick={() => engine.current?.pause(false)} className="btn btn-on px-4 py-2">
                  ▶ RESUME
                </button>
                <button onClick={fullscreen} className="btn px-3 py-2">
                  {fs ? '⛶ EXIT FULL SCREEN' : '⛶ FULL SCREEN'}
                </button>
              </div>
              <p className="text-xs tracking-widest text-dim">P / ESC TO RESUME</p>
            </div>
          )}

          {/* ── Results poster ── */}
          {phase === 'over' && result && (
            <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/60 p-2">
              <PosterFrame accent={DR.colour.signal} code="MI-END" kana="ゲームオーバー" className="w-full max-w-md">
                <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
                  <Display size="clamp(40px,8vw,72px)" colour={DR.colour.paper}>
                    GAME OVER
                  </Display>
                  {result.board && result.board.length > 1 && (
                    <div className="w-full bg-white/5 p-1.5 text-left text-xs" data-invaders-results={result.mode}>
                      <p className="mb-1 text-center text-[10px] tracking-widest text-white/70">
                        {result.mode === 'versus' ? `WINNER ${result.board[0].handle ? `@${result.board[0].handle}` : result.board[0].name}` : `TEAM SCORE ${(result.team ?? 0).toLocaleString()}`}
                      </p>
                      {result.board.map((r, i) => (
                        <div key={r.id} className="flex items-center gap-1 py-0.5" style={{ borderLeft: `3px solid ${r.colour}`, paddingLeft: 4 }}>
                          <span className="w-4 text-white/50">{i + 1}</span>
                          <PlayerBadge handle={r.handle} name={r.name} verified={r.verified} ring={r.colour} size={18} className={`min-w-0 flex-1 ${r.me ? 'text-white' : 'text-white/80'}`} />
                          <span className="text-white/60">{r.kills} kills</span>
                          <span className="w-16 text-right tabular-nums text-white" style={hudFont}>
                            {r.score.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-baseline gap-2" style={hudFont}>
                    <span className="text-5xl tabular-nums" style={{ color: DR.colour.amber, lineHeight: 0.9 }}>
                      {result.score.toLocaleString()}
                    </span>
                    <span className="text-sm text-white/70">PTS</span>
                  </div>
                  <div className="grid w-full grid-cols-4 gap-1 text-center text-[10px] tracking-widest text-white/70">
                    {[
                      ['WAVE', result.wave],
                      ['KILLS', result.kills],
                      ['BEST CHAIN', result.maxCombo],
                      ['BOSSES', result.bosses],
                    ].map(([k, v]) => (
                      <div key={k} className="bg-white/5 px-1 py-1">
                        <div className="text-base text-white" style={hudFont}>
                          {v}
                        </div>
                        {k}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-dim">Best: {Math.max(best, result.score).toLocaleString()}</p>
                  <LootLine haul={lastRun} />
                  <HighScores game="invaders" score={result.score} secs={result.secs} live={run.paid} txid={run.live ? lastTx : run.txid} meta={run.live ? { live: 1, tx: onChain } : run.paid ? { coinop: 1 } : undefined} />
                  {mpOn ? (
                    <button onClick={mpBack} className="btn btn-on px-4 py-2" data-invaders-lobby>
                      ◀ BACK TO THE LOBBY
                    </button>
                  ) : (
                    <CoinOpButtons co={co} start={(p) => start(p)} />
                  )}
                  {run.live && !mpOn && (
                  <button onClick={() => start(true, true)} disabled={actionsLeft < 1} className="btn px-3 py-1 text-sm disabled:opacity-40">
                    ⚡ PLAY LIVE AGAIN · {actionsLeft.toLocaleString()} ACTIONS
                  </button>
                  )}
                </div>
              </PosterFrame>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {POWERS.map((k) => (
          <span key={k} className="flex items-center gap-1 border border-[var(--border-dim)] px-1.5 py-0.5 text-[10px] tracking-widest text-white/80" style={{ borderLeft: `3px solid ${POWER_META[k].colour}` }}>
            <Pictogram name={PICTO[k]} size={12} colour={POWER_META[k].colour} />
            {POWER_META[k].label} · {POWER_META[k].blurb}
          </span>
        ))}
      </div>
      <HazardBar colour={DR.colour.amber} h={8} className="mt-2 opacity-60" />
      <p className="mt-2 text-xs text-muted">
        The invaders are mainnet, live: payments are cyan darts, data is blue slabs, social posts are magenta spikes, inscriptions are red gems, token transfers are gold ships wearing their token, and blasts cross as bonus saucers. A busy mempool means a bigger formation and faster dive-bombers; a new block brings the boss. Quiet mempool? Ghost ships fill in, worth almost nothing.
      </p>
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      {co.chooserEl}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}
