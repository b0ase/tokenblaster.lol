'use client';

/**
 * Token Rally: a 3D rally game where the rivals are live BSV transactions. This component is the
 * shell (menu, HUD, results, touch controls); the game itself is src/lib/rally/engine.ts.
 * Two ways to play. PRACTICE is free: nothing is sent to the chain, no wallet is touched. RACE LIVE burns your
 * loaded coin as fuel: every 20 m of throttle, every nitro burst, drift bonus and checkpoint is one tiny real
 * transaction, queued and sent in the background through the same gun paths Chain Frogger uses (src/lib/rally/spend.ts).
 * The first tx of a live race is its proof on the score board.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameAudio } from './SoundToggle';
import { HighScores } from './HighScores';
import { WalletChooser } from './WalletChooser';
import { RaceLobby, RaceStandings } from './racemp/RaceLobby';
import { useRaceRoom } from '@/lib/racemp/useRaceRoom';
import { IdentityPicker, PlayerBadge, useMyHandle } from './PlayerBadge';
import { cleanRoomCode, type RaceInfo } from '@/lib/racemp/session';
import { DRIVER_COLOURS, driverColour, validateRallyCfg, type RallyCfg } from '@/lib/rally/mp';
import { useBlaster } from '@/lib/useBlaster';
import { TOKEN_FEE } from '@/lib/gun';
import { actionsForStage, FUEL_M, MIN_START_ACTIONS, SpendMeter, type SpendKind, type SpendLine } from '@/lib/rally/spend';
import { useChainFeed } from '@/lib/useChainFeed';
import { CARS, fmt, RallyEngine, STAGES, type Hud, type MapData, type Phase, type Result, type Toast } from '@/lib/rally/engine';
import { STAGE_LIST, type StageId } from '@/lib/rally/stages';
import type { Track } from '@/lib/rally/track';
import type { ScoreGame } from '@/lib/scores';
import { reportTxs } from '@/lib/txlog';
import { useGameShell } from '@/lib/useGameFullscreen';

type QualityPref = 'auto' | 'low' | 'high' | 'ultra';
type RivalInfo = { name: string; detail: string; color: string; live: boolean; tx: string | null; skill: number; kind: string };
const BEST = 'tokenblaster:rally-best';
const PREFS = 'tokenblaster:rally-prefs';
/** Where fuel burns go: 1 sat / 1 token per burn to TokenBlaster (the same public receiving address Chain Frogger uses). The player's gun pays the network fee. */
const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU';
const EST_FEE = 26; // sats per SATS-mode tx (~260 bytes at 100 sat/kB)
const SAT_LOADS = [5_000, 20_000, 100_000];
const TOK_LOADS = [250, 1_000, 5_000];
const KIND_ICON: Record<SpendKind, string> = { fuel: '◆', nitro: '»', drift: '↯', split: '⚑' };
type Spent = { sent: number; requested: number; queued: number; first: string | null; last: string | null; err: string | null; by: Record<SpendKind, number>; ticker: SpendLine[] };
const NO_SPEND: Spent = { sent: 0, requested: 0, queued: 0, first: null, last: null, err: null, by: { fuel: 0, nitro: 0, drift: 0, split: 0 }, ticker: [] };

const isMobileish = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Boolean(coarse) || mem <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 720;
};

/** HUD nodes written straight to the DOM from the engine loop (60 Hz), without React renders. */
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
    this.text('speed', String(Math.round(h.kmh)));
    this.text('gear', h.gear === 0 ? 'R' : String(h.gear));
    this.css('rpm', { width: `${Math.round(h.rpm * 100)}%`, background: h.rpm > 0.9 ? '#ff2d2d' : '#ffb000' });
    this.css('nitro', { width: `${Math.round(h.nitro * 100)}%`, background: h.nitroOn ? '#7ae7ff' : h.nitro > 0.99 ? '#ffffff' : '#2b9fd8' });
    this.text('time', fmt(h.time));
    this.text('pos', `P${h.pos}/${h.total}`);
    if (h.delta === null) this.css('delta', { opacity: '0' });
    else {
      this.text('delta', `${h.delta >= 0 ? '+' : '-'}${Math.abs(h.delta).toFixed(2)} vs ${h.deltaName}`);
      this.css('delta', { opacity: '1', color: h.delta <= 0 ? '#7dff9a' : '#ff6a5a' });
    }
    this.css('prog', { width: `${Math.round(h.progress * 100)}%` });
    this.css('drift', { opacity: h.drifting ? '1' : '0' });
    this.text('drift', `DRIFT ${Math.round(h.drift)}`);
    this.text('pen', h.penalty > 0 ? `+${h.penalty.toFixed(1)}s` : '');
    this.css('wrong', { opacity: h.wrongWay ? '1' : '0' });
  }
}

/** Burns a gun can pay for: SATS mode is bounded by sats, a coin by the coin and the sats fee. */
const loadedBurns = (ammo: number, tokens: number, tokMode: boolean) =>
  tokMode ? Math.max(0, Math.min(Math.floor(tokens), Math.floor(ammo / TOKEN_FEE))) : Math.max(0, Math.floor(ammo / (1 + EST_FEE)));

/** Dev-only test seam (like window.__rally): a stub wallet so the LIVE queue can be exercised with no broadcast. Never present in production builds. */
type RallyMock = { ammo: number; send: (n: number, batch: string[][]) => Promise<string[]> };
const devMock = (): RallyMock | null => (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' ? ((window as unknown as { __rallyMock?: RallyMock }).__rallyMock ?? null) : null);
type PayState = { ammo: number; tokens: number; tokMode: boolean; live: boolean; raceNeed: number };
type FireFns = { batch: ReturnType<typeof useBlaster>['fireBatch']; tokens: ReturnType<typeof useBlaster>['fireTokens'] };
/** The wallet side of the meter: the gun's own batch paths, read through refs so the game loop never re-renders. */
const makeIo = (pay: { current: PayState }, fire: { current: FireFns }, snap: { current: () => void }) => ({
  send: (n: number, batch: string[][]) => (devMock() ? devMock()!.send(n, batch) : pay.current.tokMode ? fire.current.tokens(n, batch, HOUSE) : fire.current.batch(n, batch, { address: HOUSE, sats: 1 })),
  canPay: (n: number) => n <= (devMock() ? loadedBurns(devMock()!.ammo, 0, false) : loadedBurns(pay.current.ammo, pay.current.tokens, pay.current.tokMode)),
  batchMax: () => (pay.current.tokMode ? 25 : 40),
  onChange: () => snap.current(),
});

const readBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(BEST) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

export function TokenRally() {
  const shell = useGameShell();
  const mount = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const takeRef = useRef(feed.take);
  useEffect(() => {
    takeRef.current = feed.take;
  });
  const engine = useRef<RallyEngine | null>(null);
  const startRef = useRef<() => void>(() => undefined);

  const b = useBlaster();
  /** The mode picked on the menu, and the mode of the race in progress / just finished. */
  const [liveMode, setLiveMode] = useState(false);
  const [run, setRun] = useState<{ live: boolean }>({ live: false });
  const [spent, setSpent] = useState<Spent>(NO_SPEND);
  const [dry, setDry] = useState(false);
  // What the game loop needs about paying, without re-running the 3D effect.
  const payRef = useRef({ ammo: 0, tokens: 0, tokMode: false, live: false, raceNeed: 0 });
  useEffect(() => {
    payRef.current.ammo = b.ammo;
    payRef.current.tokens = b.tokenAmmo;
    payRef.current.tokMode = b.mode === 'tokens' && Boolean(b.token);
  }, [b.ammo, b.tokenAmmo, b.mode, b.token]);
  const fireRef = useRef({ batch: b.fireBatch, tokens: b.fireTokens });
  useEffect(() => {
    fireRef.current = { batch: b.fireBatch, tokens: b.fireTokens };
  }, [b.fireBatch, b.fireTokens]);
  /** Burns the wallet can still pay for, not counting the queue. */
  const burnsLoaded = useCallback(() => (devMock() ? loadedBurns(devMock()!.ammo, 0, false) : loadedBurns(payRef.current.ammo, payRef.current.tokens, payRef.current.tokMode)), []);
  const snapRef = useRef<() => void>(() => undefined);
  // The refs are only read later, inside the wallet callbacks (never during render).
  const [meter] = useState(() => new SpendMeter(makeIo(payRef, fireRef, snapRef)));
  /** Can the wallet pay for one more burn on top of what is queued? */
  const burnsLoaded2 = () => meter.queued + 1 <= burnsLoaded();
  useEffect(() => {
    snapRef.current = () => {
      setSpent({ sent: meter.sent, requested: meter.requested, queued: meter.queued, first: meter.firstTx, last: meter.lastTx, err: meter.error, by: { ...meter.byKind }, ticker: [...meter.ticker] });
      const eng = engine.current;
      if (eng && eng.econ.live) {
        eng.econ.dry = !burnsLoaded2();
        setDry(eng.econ.dry);
      }
    };
  });
  // Loading more (or a failed batch) changes what the tank holds: re-check dry.
  useEffect(() => {
    snapRef.current();
  }, [b.ammo, b.tokenAmmo, b.mode]);
  const spend = useRef((kind: SpendKind, tag: string) => {
    if (!meter.request(kind, tag)) {
      const eng = engine.current;
      if (eng) eng.econ.dry = true;
      setDry(true);
    } else {
      const d = !burnsLoaded2();
      if (engine.current) engine.current.econ.dry = d;
      setDry(d);
    }
  });
  const [stageId, setStageId] = useState<StageId>('forest');
  const [carId, setCarId] = useState('hatch');
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [phase, setPhase] = useState<Phase>('loading');
  const [loading, setLoading] = useState({ msg: 'Starting', pct: 0 });
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Hall of fame: when a LIVE stage ends, report how many txs this run put on chain (never blocks, never touches payments).
  const txReported = useRef<Result | null>(null);
  useEffect(() => {
    if (!result || txReported.current === result) return;
    txReported.current = result;
    if (run.live && spent.sent > 0) reportTxs({ game: 'rally', txs: spent.sent, txid: spent.last ?? spent.first, secs: result.total });
  }, [result, run.live, spent]);
  const [rivals, setRivals] = useState<RivalInfo[]>([]);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [best, setBest] = useState<Record<string, number>>({});
  const [newBest, setNewBest] = useState(false);
  const [touch, setTouch] = useState(false);
  const [perf, setPerf] = useState<{ fps: number; level: number } | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [ready, setReady] = useState(false);
  const toastId = useRef(0);
  // Multiplayer (src/lib/racemp): rooms live in the hook, the race itself is the engine's (src/lib/rally/engine.ts).
  const [pilot, setPilot] = useState('');
  const [colourId, setColourId] = useState('red');
  const [joinCode, setJoinCode] = useState('');
  const pendingGo = useRef<RaceInfo<RallyCfg> | null>(null);
  const [goTick, setGoTick] = useState(0);
  const xHandle = useMyHandle();
  const room = useRaceRoom<RallyCfg>({
    game: 'rally',
    enabled: ready,
    wallet: b.wallet?.client ?? null,
    profile: { name: pilot || 'DRIVER', vehicle: carId, team: colourId, gun: b.gunAddress || undefined, x: xHandle ?? undefined },
    cfg: { stage: stageId },
    quickKey: (c) => c.stage,
    sameCfg: (x, y) => x.stage === y.stage,
    validateCfg: validateRallyCfg,
    events: ['s'],
    onRemoteCfg: (c) => setStageId(c.stage),
    onGo: (race) => {
      pendingGo.current = race;
      setGoTick((t) => t + 1);
    },
  });
  const mpOn = room.info !== null;
  const meId = room.info?.id ?? null;
  const meRow = room.ui.players.find((x) => x.id === meId) ?? null;
  // Quick rooms are one per stage; in a private room only the host picks the stage.
  const locked = mpOn && !room.info?.quick && room.ui.leader !== meId && room.ui.players.length > 1;

  const [hud] = useState(() => new HudDom());
  const mini = useRef<HTMLCanvasElement>(null);
  const miniBase = useRef<{ img: HTMLCanvasElement; fit: (x: number, z: number) => [number, number] } | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setBest(readBest());
      setTouch(Boolean(window.matchMedia?.('(pointer: coarse)').matches));
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { stage?: StageId; car?: string; q?: QualityPref; name?: string; colour?: string };
        if (p.stage && STAGES[p.stage]) setStageId(p.stage);
        if (p.car && CARS.some((c) => c.id === p.car)) setCarId(p.car);
        if (p.q) setQualityPref(p.q);
        if (typeof p.name === 'string') setPilot(p.name.slice(0, 14));
        if (p.colour && DRIVER_COLOURS.some((c) => c.id === p.colour)) setColourId(p.colour);
      } catch {
        /* storage blocked */
      }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(PREFS, JSON.stringify({ stage: stageId, car: carId, q: qualityPref, name: pilot, colour: colourId }));
    } catch {
      /* storage blocked */
    }
  }, [ready, stageId, carId, qualityPref, pilot, colourId]);

  const pushToast = useCallback((t: Toast) => {
    const id = ++toastId.current;
    setToasts((a) => [...a.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 3000);
  }, []);

  const bakeMini = useCallback((track: Track) => {
    const W = 120;
    const H = 200;
    const c = document.createElement('canvas');
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext('2d')!;
    const b = track.bounds;
    const pad = 14;
    const sx = (W * 2 - pad * 2) / Math.max(40, b.maxX - b.minX);
    const sz = (H * 2 - pad * 2) / Math.max(40, b.maxZ - b.minZ);
    const k = Math.min(sx, sz);
    const ox = (W * 2 - (b.maxX - b.minX) * k) / 2;
    const oz = (H * 2 - (b.maxZ - b.minZ) * k) / 2;
    const fit = (x: number, z: number): [number, number] => [ox + (x - b.minX) * k, H * 2 - (oz + (z - b.minZ) * k)];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [w, col] of [[9, 'rgba(0,0,0,0.75)'], [4.5, 'rgba(255,255,255,0.85)']] as const) {
      g.lineWidth = w;
      g.strokeStyle = col;
      g.beginPath();
      for (let i = 0; i < track.n; i += 3) {
        const [x, y] = fit(track.x[i], track.z[i]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    miniBase.current = { img: c, fit };
  }, []);

  const drawMini = useCallback((m: MapData) => {
    const cv = mini.current;
    const base = miniBase.current;
    if (!cv || !base) return;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(base.img, 0, 0, cv.width, cv.height);
    const sc = cv.width / base.img.width;
    const dot = (x: number, z: number, col: string, r: number) => {
      const [px, py] = base.fit(x, z);
      g.beginPath();
      g.fillStyle = col;
      g.arc(px * sc, py * sc, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const c of m.coins) dot(c.x, c.z, '#ffd23f', 2.2);
    for (const r of m.rivals) dot(r.x, r.z, r.c, 3);
    const [px, py] = base.fit(m.px, m.pz);
    g.save();
    g.translate(px * sc, py * sc);
    g.rotate(m.yaw);
    g.fillStyle = '#ff2d2d';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.4, 5);
    g.lineTo(-4.4, 5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }, []);

  const onHud = useCallback((h: Hud) => hud.update(h), [hud]);

  // (Re)build the engine when the stage, car or quality changes.
  useEffect(() => {
    const host = mount.current;
    if (!host || !ready) return;
    const life = { dead: false };
    const q: 'low' | 'high' | 'ultra' = qualityPref === 'auto' ? (isMobileish() ? 'low' : 'high') : qualityPref;
    void Promise.resolve().then(() => {
      if (life.dead) return;
      setPhase('loading');
      setLoading({ msg: 'Starting', pct: 0 });
      setError(null);
      setResult(null);
    });
    const eng = new RallyEngine(host, {
      stage: stageId,
      car: carId,
      quality: q,
      take: (p) => takeRef.current(p),
      cb: {
        onPhase: (p) => {
          if (life.dead) return;
          setPhase(p);
          if (p === 'menu') setRivals(eng.rivalList());
          if (p === 'menu') setShowBoard(false);
        },
        onCount: (n) => !life.dead && setCount(n),
        onHud,
        onToast: (t) => !life.dead && pushToast(t),
        onLoading: (msg, pct) => !life.dead && setLoading({ msg, pct }),
        onMap: drawMini,
        onFinish: (r) => {
          if (life.dead) return;
          setResult(r);
          setShowBoard(false);
          setTimeout(() => !life.dead && setShowBoard(true), 1300);
          const b = readBest();
          const k = `${r.stage}:${r.car}`;
          if (!b[k] || r.total < b[k]) {
            b[k] = r.total;
            try {
              localStorage.setItem(BEST, JSON.stringify(b));
            } catch {
              /* storage blocked */
            }
            setNewBest(true);
          } else setNewBest(false);
          setBest(b);
        },
        onStartRequest: () => !life.dead && startRef.current(), // Enter / pad START: whatever mode is picked on the menu
        onSpend: (k, tag) => !life.dead && spend.current(k, tag),
        onPerf: (p) => !life.dead && setPerf(p),
      },
    });
    engine.current = eng;
    eng
      .init()
      .then(() => {
        if (life.dead) return;
        bakeMini(eng.track);
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __rally?: RallyEngine }).__rally = eng;
      })
      .catch((e: unknown) => {
        if (!life.dead) setError(e instanceof Error ? e.message : 'Could not start the 3D scene');
      });
    return () => {
      life.dead = true;
      eng.dispose();
      if (engine.current === eng) engine.current = null;
    };
  }, [ready, stageId, carId, qualityPref, session, onHud, pushToast, drawMini, bakeMini, spend]);

  // Token tickers and logos arrive a moment after the grid is built: refresh the menu list.
  useEffect(() => {
    if (phase !== 'menu') return;
    const id = setInterval(() => {
      if (engine.current) setRivals(engine.current.rivalList());
    }, 1500);
    return () => clearInterval(id);
  }, [phase]);

  const stage = STAGES[stageId];
  const car = CARS.find((c) => c.id === carId) ?? CARS[0];
  const bestTime = best[`${stageId}:${carId}`];
  const racing = phase === 'racing' || phase === 'countdown' || phase === 'paused';
  const need = actionsForStage(stage.length);
  const tokModeNow = b.mode === 'tokens' && Boolean(b.token);
  const mock = devMock();
  const burns = Math.max(0, (mock ? loadedBurns(mock.ammo, 0, false) : loadedBurns(b.ammo, b.tokenAmmo, tokModeNow)) - spent.queued);
  const canGoLive = (Boolean(b.wallet) || Boolean(mock)) && burns >= MIN_START_ACTIONS && !b.busy;
  /** Start a stage run. LIVE needs a loaded tank; PRACTICE is free and touches no wallet. */
  const start = (live = liveMode) => {
    const eng = engine.current;
    if (!eng || (live && !canGoLive)) return;
    meter.reset();
    setSpent(NO_SPEND);
    eng.econ.live = live;
    eng.econ.dry = false;
    setDry(false);
    payRef.current.live = live;
    setRun({ live });
    eng.begin();
  };
  useEffect(() => {
    startRef.current = () => {
      if (!room.info) start();
    };
  });
  // Fuel gauge + tx counter straight to the DOM (4 Hz), like the rest of the HUD.
  useEffect(() => {
    if (!run.live || !racing) return;
    const id = setInterval(() => {
      const left = Math.max(0, burnsLoaded() - meter.queued);
      hud.css('fuelbar', { width: `${Math.round(Math.min(1, left / Math.max(1, need)) * 100)}%`, background: left < 12 ? '#ff2d2d' : left < 40 ? '#ffb000' : '#7dff9a' });
      hud.text('fuel', `${left.toLocaleString()} burns · ${((left * FUEL_M) / 1000).toFixed(1)} km`);
      hud.text('txs', `${meter.sent.toLocaleString()} txs this race${meter.queued ? ` · ${meter.queued} sending` : ''}`);
    }, 250);
    return () => clearInterval(id);
  });
  const toMenu = () => {
    setResult(null);
    room.endRace();
    void engine.current?.toMenu();
  };
  // The room leader said GO: start as soon as this engine is on the right stage and idle at the menu.
  useEffect(() => {
    const race = pendingGo.current;
    const link = room.getLink();
    const eng = engine.current;
    if (!race || !link || !goTick) return;
    if (race.cfg.stage !== stageId) return void setStageId(race.cfg.stage);
    if (!eng || (phase !== 'menu' && phase !== 'finished') || eng.stage.id !== race.cfg.stage) return;
    pendingGo.current = null;
    eng.opts.mp = link;
    const live = liveMode && canGoLive;
    void eng.startMp({ name: pilot || 'DRIVER', colour: colourId }).then((ok) => {
      if (!ok) return;
      setResult(null);
      start(live);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTick, phase, stageId]);
  const lobbyReady = () => room.setReady(true, liveMode && canGoLive);

  const heldTok = Math.floor(b.token?.balance ?? 0);
  const tokOpts = (() => {
    const o = TOK_LOADS.filter((n) => n <= heldTok);
    return o.length || heldTok < 1 ? o : [heldTok];
  })();
  const tokPicks = [...b.tokens].sort((x, y) => (y.balance ?? 0) - (x.balance ?? 0)).slice(0, 6);
  const tokMode = b.mode === 'tokens' && Boolean(b.token);
  const fuelPanel = (
    <div className="inset flex flex-col gap-1.5 bg-black/60 p-2 text-[11px]">
      {!b.wallet ? (
        <>
          <p className="text-dim">Live races burn a little of your coin as fuel: about one tiny real transaction every {FUEL_M} m, per nitro burst, drift bonus and checkpoint. Connect a wallet to load a tank.</p>
          <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on self-start">
            {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-dim">FUEL:</span>
            <button onClick={() => b.setMode('sats')} disabled={!!b.busy} className={`btn px-2 py-0.5 ${!tokMode ? 'btn-on' : ''}`}>
              SATS
            </button>
            {tokPicks.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  b.setToken(t);
                  b.setMode('tokens');
                }}
                disabled={!!b.busy}
                title={`${Math.floor(t.balance ?? 0).toLocaleString()} $${t.sym} in your wallet`}
                className={`btn px-2 py-0.5 ${tokMode && b.token?.id === t.id ? 'btn-on' : ''}`}
              >
                ${t.sym}
              </button>
            ))}
          </div>
          <p className="text-dim">
            1 {tokMode ? `$${b.token?.sym}` : 'sat'} to TokenBlaster + ~{tokMode ? TOKEN_FEE : EST_FEE} sats network fee per burn · <span className="text-hot">{burns.toLocaleString()} burns</span> loaded (~{((burns * FUEL_M) / 1000).toFixed(1)} km
            {tokMode ? `, ${Math.floor(b.tokenAmmo).toLocaleString()} $${b.token?.sym} + ${b.ammo.toLocaleString()} sats` : `, ${b.ammo.toLocaleString()} sats`}). A full {(stage.length / 1000).toFixed(1)} km stage takes about {need}.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {tokMode
              ? tokOpts.map((n) => (
                  <button key={n} onClick={() => void b.loadTokenAmmo(n)} disabled={!!b.busy} className="btn px-2 py-0.5">
                    {b.busy === 'loading-tokens' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} $${b.token?.sym}`}
                  </button>
                ))
              : SAT_LOADS.map((n) => (
                  <button key={n} onClick={() => void b.load(n, `Token Rally: ${n.toLocaleString()} sats of fuel`)} disabled={!!b.busy} className="btn px-2 py-0.5">
                    {b.busy === 'loading' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} sats`}
                  </button>
                ))}
            {tokMode && tokOpts.length === 0 && <span className="text-hot">You hold none of ${b.token?.sym}: pick another coin or use SATS.</span>}
            {(b.ammo > 0 || b.gunTokens.length > 0) && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn px-2 py-0.5">
                {b.busy === 'unloading' ? 'UNLOADING…' : 'UNLOAD'}
              </button>
            )}
          </div>
        </>
      )}
      {b.error && <p className="text-hot">⚠ {b.error}</p>}
    </div>
  );

  const hold = (k: 'left' | 'right' | 'gas' | 'brake' | 'hand' | 'nitro') => ({
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

  const fullscreen = () => {
    if (shell) return shell.isFs() ? shell.exit() : shell.enter();
    const root = mount.current?.parentElement;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else {
      void root.requestFullscreen?.().then(() => {
        // Phones: landscape is the way to play (best effort; not every browser allows the lock).
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        void o?.lock?.('landscape').catch(() => undefined);
      });
    }
  };

  const scoreGame = `rally-${stageId}` as ScoreGame;

  return (
    <section className="panel game-root">
      <GameAudio track="city" />
      <div className="panel-header">
        <span className="panel-title">Token Rally</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE: RIVALS ARE MAINNET TXS
            </>
          ) : feed.status === 'off' ? (
            'no feed configured: idle mempool rivals'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="game-stage relative select-none overflow-hidden bg-black" style={{ height: 'min(78vh, 780px)', minHeight: 420 }}>
        <div ref={mount} className="absolute inset-0 touch-none" />

        {/* ── HUD ── */}
        <div className={`pointer-events-none absolute inset-0 transition-opacity ${racing ? 'opacity-100' : 'opacity-0'}`} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {mpOn && xHandle && (
            <div className="absolute bottom-28 right-3 bg-black/60 px-2 py-1 text-xs text-white" data-hud-me={xHandle}>
              <PlayerBadge handle={xHandle} name={xHandle} verified={Boolean(meId && room.verified[meId])} ring={driverColour(colourId).base} size={22} />
            </div>
          )}
          <div className="absolute left-3 top-3">
            {run.live && (
              <div className="mb-1 w-40 bg-black/55 px-2 py-1 text-[10px] sm:w-56 sm:text-xs">
                <div ref={hud.ref('txs')} className="font-black tabular-nums text-hot">
                  0 txs this race
                </div>
                <div className="mt-1 hidden flex-col gap-0.5 text-[10px] text-dim sm:flex">
                  {spent.ticker.slice(-4).map((t, i) => (
                    <span key={`${t.tx}${i}`} className="truncate">
                      {KIND_ICON[t.kind]} {t.kind} {t.kind === 'fuel' ? `${t.tag} m` : t.tag} · <span className="text-accent">{t.tx?.slice(0, 10)}…</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-baseline gap-2 bg-black/55 px-3 py-1">
              <span ref={hud.ref('pos')} className="text-xl font-black text-white sm:text-3xl">
                P1/8
              </span>
              <span className="hidden text-xs text-dim sm:inline">{stage.name}</span>
            </div>
          </div>
          <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center max-sm:left-3 max-sm:top-11 max-sm:translate-x-0 max-sm:text-left">
            <div className="bg-black/55 px-3 py-1">
              <div ref={hud.ref('time')} className="text-xl font-black tabular-nums text-white sm:text-3xl">
                0:00.00
              </div>
              <div className="text-xs text-hot">
                <span ref={hud.ref('pen')} />
              </div>
            </div>
            <div ref={hud.ref('delta')} className="mt-1 bg-black/55 px-2 py-0.5 text-sm font-bold opacity-0 transition-opacity" />
          </div>
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
            <canvas ref={mini} width={120} height={200} className="h-[106px] w-16 bg-black/55 sm:h-[160px] sm:w-24" />
            <div className="h-1.5 w-16 bg-black/60 sm:w-24">
              <div ref={hud.ref('prog')} className="h-full bg-white" style={{ width: '0%' }} />
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-3 flex items-end justify-center">
            <div className="flex w-[min(92vw,380px)] flex-col items-center bg-black/55 px-4 py-2 max-sm:mb-[5.2rem] max-sm:w-[min(58vw,220px)] max-sm:px-3 max-sm:py-1">
              <div className="flex w-full items-end justify-between">
                <div>
                  <span ref={hud.ref('speed')} className="text-4xl font-black tabular-nums text-white sm:text-5xl">
                    0
                  </span>
                  <span className="ml-1 text-xs text-dim">km/h</span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-dim">GEAR</div>
                  <span ref={hud.ref('gear')} className="text-3xl font-black text-hot">
                    1
                  </span>
                </div>
              </div>
              <div className="mt-1 h-2 w-full bg-white/10">
                <div ref={hud.ref('rpm')} className="h-full" style={{ width: '10%', background: '#ffb000' }} />
              </div>
              {run.live && (
                <div className="mt-1 flex w-full items-center gap-2">
                  <span className="text-[10px] tracking-widest text-dim">FUEL</span>
                  <div className="h-2 flex-1 bg-white/10">
                    <div ref={hud.ref('fuelbar')} className="h-full" style={{ width: '0%', background: '#7dff9a' }} />
                  </div>
                  <span ref={hud.ref('fuel')} className="w-24 text-right text-[10px] tabular-nums text-dim" />
                </div>
              )}
              <div className="mt-1 flex w-full items-center gap-2">
                <span className="text-[10px] tracking-widest text-dim">NITRO</span>
                <div className="h-2 flex-1 bg-white/10">
                  <div ref={hud.ref('nitro')} className="h-full" style={{ width: '30%', background: '#2b9fd8' }} />
                </div>
              </div>
            </div>
          </div>
          <div ref={hud.ref('drift')} className="absolute bottom-24 left-1/2 -translate-x-1/2 text-xl font-black text-hot opacity-0 transition-opacity" style={{ textShadow: '0 2px 0 #000' }} />
          {run.live && dry && (
            <div className="absolute left-1/2 top-[28%] -translate-x-1/2 bg-red-700/85 px-4 py-2 text-center text-xl font-black text-white sm:text-3xl">
              OUT OF FUEL · COASTING
              <div className="text-xs font-bold text-white/80">{mpOn ? 'The race goes on: coast to the line' : 'Pause (P) and load more to keep driving'}</div>
            </div>
          )}
          <div ref={hud.ref('wrong')} className="absolute left-1/2 top-1/3 -translate-x-1/2 bg-red-700/80 px-4 py-2 text-2xl font-black text-white opacity-0">
            WRONG WAY
          </div>
          <div className="absolute bottom-3 left-3 flex w-[min(60vw,340px)] flex-col gap-1">
            {toasts.map((t) => (
              <div key={t.id} className={`bg-black/65 px-2 py-1 text-xs font-bold ${t.tone === 'good' ? 'text-green-300' : t.tone === 'bad' ? 'text-red-400' : 'text-sky-200'}`}>
                {t.text}
              </div>
            ))}
          </div>
        </div>

        {count !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <style>{`@keyframes rallyCount { 0% { transform: scale(2.4); opacity: 0 } 25% { opacity: 1 } 100% { transform: scale(1); opacity: 0.95 } }`}</style>
            <span
              key={count}
              className="font-black"
              style={{
                fontFamily: 'Impact, "Arial Black", sans-serif',
                fontSize: 'clamp(90px, 20vw, 220px)',
                color: count === 0 ? '#7dff9a' : '#ffd23f',
                WebkitTextStroke: '4px #000',
                textShadow: '0 8px 0 #000, 0 0 40px rgba(255,200,60,0.5)',
                animation: 'rallyCount 0.8s ease-out both',
              }}
            >
              {count === 0 ? 'GO!' : count}
            </span>
          </div>
        )}

        {/* ── Touch controls ── */}
        {touch && racing && phase !== 'paused' && (
          <>
            <div className="absolute bottom-3 left-3 flex gap-2 sm:gap-3">
              <button {...hold('left')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Steer left">
                ◀
              </button>
              <button {...hold('right')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Steer right">
                ▶
              </button>
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <button {...hold('hand')} className="btn h-11 w-14 touch-none text-[10px] sm:h-14 sm:w-16 sm:text-xs">
                  DRIFT
                </button>
                <button {...hold('nitro')} className="btn h-11 w-14 touch-none text-[10px] sm:h-14 sm:w-16 sm:text-xs">
                  NITRO
                </button>
              </div>
              <div className="flex gap-2">
                <button {...hold('brake')} className="btn h-16 w-16 touch-none text-xs sm:h-20 sm:w-20 sm:text-sm">
                  BRAKE
                </button>
                <button {...hold('gas')} className="btn btn-on h-[4.5rem] w-[4.5rem] touch-none text-base sm:h-24 sm:w-24 sm:text-lg">
                  GAS
                </button>
              </div>
            </div>
          </>
        )}
        {racing && (
          <div data-rally-mode={run.live ? 'live' : 'practice'} className={`pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 border bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest sm:text-xs ${run.live ? 'border-[#ffd36a] text-[#ffd36a]' : 'border-white/20 text-dim'}`}>
            {run.live ? 'LIVE · FUEL ON CHAIN' : 'PRACTICE'}
          </div>
        )}
        {racing && (
          <div className="absolute right-3 top-[8.4rem] flex gap-1 sm:top-[11.5rem]">
            {!mpOn && (
              <button onClick={() => engine.current?.pause(phase !== 'paused')} className="btn px-2 py-1 text-xs" aria-label="Pause">
                {phase === 'paused' ? '▶' : 'Ⅱ'}
              </button>
            )}
            <button onClick={fullscreen} className="btn px-2 py-1 text-xs" aria-label="Fullscreen">
              ⛶
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {phase === 'loading' && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 text-center">
            <p className="text-3xl font-black text-hot">TOKEN RALLY</p>
            <p className="text-sm text-dim">{loading.msg}…</p>
            <div className="h-2 w-64 bg-white/10">
              <div className="h-full bg-white transition-all" style={{ width: `${Math.round(loading.pct * 100)}%` }} />
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center">
            <p className="text-2xl font-bold text-hot">Could not start the 3D scene</p>
            <p className="max-w-md text-sm text-dim">{error}. Token Rally needs WebGL: try a recent Chrome, Edge, Firefox or Safari with hardware acceleration on.</p>
            <button onClick={() => setSession((s) => s + 1)} className="btn btn-on">
              RETRY
            </button>
          </div>
        )}

        {/* ── Menu ── */}
        {phase === 'menu' && (
          <div className="absolute inset-0 overflow-y-auto bg-gradient-to-r from-black/90 via-black/55 to-transparent p-3 sm:p-4">
            <div className="flex max-w-[27rem] flex-col gap-2.5">
              <div>
                <h2 className="text-4xl font-black leading-none text-white sm:text-5xl" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', letterSpacing: '0.02em' }}>
                  TOKEN <span className="text-hot">RALLY</span>
                </h2>
                <p className="mt-1 text-xs text-fg">Race the tokens moving on chain right now. Every rival is a real mainnet transaction: the bigger the move, the faster it drives.</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] tracking-widest text-dim">STAGE</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {STAGE_LIST.map((s) => (
                    <button key={s.id} onClick={() => !locked && setStageId(s.id)} disabled={locked} aria-pressed={s.id === stageId} className={`btn flex flex-col items-start gap-0 px-2 py-1.5 text-left ${s.id === stageId ? 'btn-on' : ''}`}>
                      <span className="text-xs font-bold leading-tight">{s.name}</span>
                      <span className="text-[10px] opacity-70">{(s.length / 1000).toFixed(1)} km · {s.id}</span>
                      {best[`${s.id}:${carId}`] ? <span className="text-[10px] text-hot">{fmt(best[`${s.id}:${carId}`])}</span> : null}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-dim">{stage.blurb}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] tracking-widest text-dim">CAR</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {CARS.map((c) => (
                    <button key={c.id} onClick={() => setCarId(c.id)} aria-pressed={c.id === carId} className={`btn flex flex-col items-start gap-0 px-2 py-1.5 text-left ${c.id === carId ? 'btn-on' : ''}`}>
                      <span className="text-xs font-bold leading-tight">{c.name}</span>
                      <span className="text-[10px] leading-tight opacity-70">{c.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="inset bg-black/60 p-2">
                <p className="mb-1 text-[10px] tracking-widest text-dim">
                  ON THE GRID · {rivals.filter((r) => r.live).length} LIVE TXS{rivals.some((r) => !r.live) ? ` + ${rivals.filter((r) => !r.live).length} IDLE` : ''}
                </p>
                <div className="grid max-h-24 grid-cols-1 gap-x-3 overflow-y-auto text-[11px] sm:grid-cols-2">
                  {rivals.map((r, i) => (
                    <div key={i} className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
                      <span className="inline-block h-2 w-2 shrink-0" style={{ background: r.color }} />
                      <span className="shrink-0 font-bold text-white">{r.name}</span>
                      <span className="overflow-hidden text-ellipsis text-dim">{r.detail}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => void engine.current?.toMenu()} className="btn mt-1.5 px-2 py-0.5 text-[11px]">
                  ↻ NEW RIVALS FROM THE CHAIN
                </button>
              </div>
              {room.available && !mpOn && (
                <div className="inset bg-black/60 p-2" data-rally-mp="menu">
                  <p className="mb-1 text-[10px] tracking-widest text-dim">MULTIPLAYER · UP TO 8 DRIVERS</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <label className="text-dim" htmlFor="rally-pilot">
                      DRIVER
                    </label>
                    <input id="rally-pilot" value={pilot} maxLength={14} onChange={(e) => setPilot(e.target.value.replace(/[^\w .·-]/g, '').toUpperCase())} className="w-28 border border-white/25 bg-black px-1.5 py-0.5 text-fg" />
                    {DRIVER_COLOURS.map((c) => (
                      <button key={c.id} onClick={() => setColourId(c.id)} aria-pressed={c.id === colourId} aria-label={`${c.name} paint`} title={c.name} className="h-5 w-5 border-2" style={{ background: c.base, borderColor: c.id === colourId ? '#fff' : '#333' }} />
                    ))}
                  </div>
                  <div className="mt-1.5">
                    <IdentityPicker />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <button onClick={room.joinQuick} className="btn btn-on px-3 py-1 text-sm" data-rally-quick>
                      QUICK RACE · {stage.name}
                    </button>
                    <button onClick={() => room.joinPrivate()} className="btn px-3 py-1 text-sm" data-rally-private>
                      NEW PRIVATE ROOM
                    </button>
                    <input value={joinCode} placeholder="ROOM CODE" maxLength={8} onChange={(e) => setJoinCode(cleanRoomCode(e.target.value))} className="w-24 border border-white/25 bg-black px-1.5 py-0.5 text-fg" aria-label="Room code" />
                    <button onClick={() => joinCode.length >= 3 && room.joinPrivate(joinCode)} className="btn px-2 py-0.5 text-[11px]">
                      JOIN
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-dim">Empty slots are filled by live-chain AI rivals. Cars do not collide. Each driver pays their own fuel; practice is free.</p>
                </div>
              )}
              {mpOn && room.info && (
                <RaceLobby
                  game="Token Rally"
                  aiLabel="AI RIVAL: a live chain transaction fills this slot"
                  circuit={stage.name}
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
                  titleStyle={{ fontFamily: 'Impact, "Arial Black", sans-serif', letterSpacing: '0.02em' }}
                  readyLabels={{ paid: 'READY · LIVE', free: 'READY · PRACTICE' }}
                  teamColour={(x) => driverColour(x.team).base}
                  detail={(x) => `${CARS.find((c) => c.id === x.vehicle)?.name ?? x.vehicle} · ${driverColour(x.team).name}`}
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
                      <button onClick={lobbyReady} disabled={liveMode && !canGoLive} className="btn-fire px-6 py-2 text-lg disabled:opacity-40" data-rally-ready>
                        {liveMode ? 'READY · LIVE' : 'READY · PRACTICE'}
                      </button>
                    )
                  }
                />
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setLiveMode(false)} aria-pressed={!liveMode} className={`btn flex flex-col items-start px-2 py-1.5 text-left ${!liveMode ? 'btn-on' : ''}`}>
                  <span className="text-xs font-bold">{!liveMode ? '● ' : '○ '}PRACTICE · FREE</span>
                  <span className="text-[10px] opacity-70">Nothing is sent to the chain.</span>
                </button>
                <button onClick={() => setLiveMode(true)} aria-pressed={liveMode} disabled={!HOUSE} className={`btn flex flex-col items-start px-2 py-1.5 text-left ${liveMode ? 'btn-on' : ''}`}>
                  <span className="text-xs font-bold">{liveMode ? '● ' : '○ '}RACE LIVE · ON-CHAIN</span>
                  <span className="text-[10px] opacity-70">Your coin is the fuel: loads of tiny txs.</span>
                </button>
              </div>
              {liveMode && fuelPanel}
              <div className="flex flex-wrap items-center gap-2">
                {!mpOn && (
                  <button onClick={() => start()} disabled={liveMode && !canGoLive} className="btn-fire px-6 py-2 text-lg disabled:opacity-40">
                    {liveMode ? '▶ START LIVE RACE' : '▶ START STAGE · PRACTICE'}
                  </button>
                )}
                {liveMode && !canGoLive && <span className="text-[11px] text-hot">{b.wallet ? `Load at least ${MIN_START_ACTIONS} burns of fuel first.` : 'Connect a wallet and load fuel.'}</span>}
                {bestTime ? <span className="text-sm text-hot">BEST {fmt(bestTime)}</span> : null}
              </div>
              <details className="text-[11px] text-dim">
                <summary className="cursor-pointer text-fg">CONTROLS</summary>
                <p className="mt-1">
                  <span className="text-fg">Keys:</span> ↑/W gas · ↓/S brake &amp; reverse · ←→/AD steer · <span className="text-hot">Space</span> handbrake (drift) · <span className="text-hot">Shift</span> nitro · C camera · R back on road (+5s) · P pause
                </p>
                <p>
                  <span className="text-fg">Pad:</span> RT gas · LT brake · stick steer · A/B handbrake · RB nitro · Y reset · LB camera. Touch: on-screen buttons. Live txs landing ahead on the road are nitro coins.
                </p>
              </details>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-dim">GRAPHICS</span>
                {(['auto', 'ultra', 'high', 'low'] as const).map((q) => (
                  <button key={q} onClick={() => setQualityPref(q)} className={`btn px-2 py-0.5 ${qualityPref === q ? 'btn-on' : ''}`}>
                    {q.toUpperCase()}
                  </button>
                ))}
                {perf && <span className="text-dim">· {perf.fps} fps</span>}
              </div>
            </div>
          </div>
        )}

        {/* ── Pause ── */}
        {phase === 'paused' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
            <p className="text-3xl font-black text-hot">PAUSED</p>
            <p className="text-xs font-bold tracking-widest text-dim">{run.live ? `LIVE · ${spent.sent.toLocaleString()} TXS ON CHAIN` : 'PRACTICE · FREE'}</p>
            {run.live && <div className="w-[min(92vw,30rem)]">{fuelPanel}</div>}
            <button onClick={() => engine.current?.pause(false)} className="btn-fire px-6 py-2 text-lg">
              RESUME
            </button>
            <button onClick={() => engine.current?.begin()} className="btn">
              RESTART STAGE
            </button>
            <button onClick={toMenu} className="btn">
              STAGE SELECT
            </button>
          </div>
        )}

        {/* ── Results ── */}
        {phase === 'finished' && result && showBoard && (
          <div className="absolute inset-0 overflow-y-auto bg-black/80 p-3" onKeyDown={(e) => e.stopPropagation()}>
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
              <p className="text-xs tracking-widest text-dim">{stage.name.toUpperCase()} · {car.name.toUpperCase()}</p>
              <p className="text-4xl font-black text-white sm:text-5xl" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                {['', '1ST', '2ND', '3RD'][result.pos] ?? `${result.pos}TH`} <span className="text-hot">OF {result.total_cars}</span>
              </p>
              <p className="text-3xl font-black tabular-nums text-white">
                {fmt(result.total)}
                {newBest && <span className="ml-2 text-base text-green-300">NEW BEST</span>}
              </p>
              <p className="text-xs text-dim">
                raw {fmt(result.raw)}
                {result.penalty > 0 ? ` + ${result.penalty.toFixed(1)}s (${result.hits} hits, ${result.resets} resets)` : ''} · par {fmt(result.par)} · splits {result.splits.slice(0, 3).map(fmt).join(' / ')}
              </p>
              <div className="grid w-full grid-cols-3 gap-2 text-sm">
                <div className="inset px-2 py-1">
                  <div className="text-dim">TIME</div>
                  <div className="font-bold text-hot">{result.parts.time}</div>
                </div>
                <div className="inset px-2 py-1">
                  <div className="text-dim">CARS BEATEN</div>
                  <div className="font-bold text-hot">{result.parts.beat}</div>
                </div>
                <div className="inset px-2 py-1">
                  <div className="text-dim">DRIFT {result.drift}</div>
                  <div className="font-bold text-hot">{result.parts.drift}</div>
                </div>
              </div>
              <p className="text-2xl font-black text-hot">SCORE {result.score.toLocaleString()}</p>
              {run.live && (
                <div className="inset w-full max-w-md bg-black/70 p-2 text-sm">
                  <p className="text-2xl font-black tabular-nums text-white">
                    {spent.sent.toLocaleString()} <span className="text-base text-hot">TXS PUT ON CHAIN</span>
                  </p>
                  <p className="text-xs text-dim">
                    {spent.by.fuel} fuel · {spent.by.nitro} nitro · {spent.by.drift} drift · {spent.by.split} checkpoints
                    {spent.queued ? ` · ${spent.queued} still sending…` : ''}
                  </p>
                  <p className="text-xs">
                    {spent.first && (
                      <a href={`https://whatsonchain.com/tx/${spent.first}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                        first tx ↗
                      </a>
                    )}
                    {spent.last && spent.last !== spent.first && (
                      <>
                        {' · '}
                        <a href={`https://whatsonchain.com/tx/${spent.last}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                          last tx ↗
                        </a>
                      </>
                    )}
                    {spent.first && <span className="text-dim"> · every burn is a tx from your gun, tagged &quot;rally&quot;</span>}
                  </p>
                  {spent.err && <p className="text-xs text-hot">⚠ {spent.err}</p>}
                </div>
              )}
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-center">
                {mpOn && <RaceStandings rows={room.ui.standings} final={room.ui.final} teamColour={(t) => driverColour(t).base} fmt={fmt} />}
                <div className="inset w-full bg-black/70 p-2 text-left text-xs sm:max-w-sm">
                  <p className="mb-1 text-center font-bold tracking-widest text-dim">THE FIELD (LIVE TXS)</p>
                  {result.board.map((r, i) => (
                    <div key={i} className={`flex items-center gap-1 py-0.5 ${r.me ? 'font-bold text-white' : ''}`}>
                      <span className="w-5 text-dim">{i + 1}</span>
                      <span className="inline-block h-2 w-2 shrink-0" style={{ background: r.color }} />
                      <span className={`truncate ${r.me ? 'text-hot' : 'text-fg'}`}>{r.name}</span>
                      {r.tx ? (
                        <a href={`https://whatsonchain.com/tx/${r.tx}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                          tx↗
                        </a>
                      ) : null}
                      <span className="ml-auto tabular-nums">{fmt(r.time)}</span>
                    </div>
                  ))}
                </div>
                <HighScores game={scoreGame} score={result.score} secs={result.total} live={run.live} txid={spent.first} meta={run.live ? { car: result.car, pos: result.pos, txs: spent.sent } : { car: result.car, pos: result.pos }} sorts={['score', 'time']} label="SCORE" />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {!mpOn && (
                  <button onClick={() => start()} disabled={liveMode && !canGoLive} className="btn-fire px-6 py-2 text-lg disabled:opacity-40">
                    {liveMode ? '▶ RACE AGAIN · LIVE' : '▶ RACE AGAIN · PRACTICE'}
                  </button>
                )}
                <button onClick={toMenu} className="btn">
                  {mpOn ? 'BACK TO THE ROOM' : 'STAGE SELECT / NEW RIVALS'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Rivals are real transactions sampled from the live BSV chain when you start: tokens drive as sedans wearing their ticker, payments as delivery vans, ordinals as SUVs. The biggest moves are the fastest cars. RACE LIVE burns your loaded coin as fuel, one tiny real transaction every {FUEL_M} m plus nitro, drift and checkpoint bursts;
        practice sends nothing. Cars, trees, rocks and grass are generated in code. Ground, rock, gravel textures and skies: Poly Haven (CC0).
      </p>
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}
