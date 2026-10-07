'use client';

/**
 * bRacer: anti-gravity racing against the live chain. This is the shell (title poster, team select, HUD,
 * results poster, touch controls); the game itself is src/lib/hyper/engine.ts. Visual language: src/components/dr.
 * Coin-op: one credit = one race (src/lib/coinop.ts); PRACTICE is free and sends nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HighScores } from './HighScores';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';
import { Barcode, ChevronBar, Display, HazardBar, Kana, Pictogram, PosterFrame, ProductCode, Sticker, gridBg, halftone, type PictogramName } from './dr';
import { drDisplay, drFontClass, drJp, drMono } from './dr/fonts';
import { useChainFeed } from '@/lib/useChainFeed';
import { DR } from '@/lib/dr/tokens';
import { GAME_KANA, GAME_NAME, GAME_SLUG, GAME_TAGLINE } from '@/lib/hyper/brand';
import { LOGO_FAMILY, Logo } from './bracer-logo';
import { fmt, HyperEngine, SHIPS, TEAMS, TRACKS, type Difficulty, type Hud, type LiveRow, type MapData, type Mode, type Phase, type Result, type Toast } from '@/lib/hyper/engine';
import { setFonts } from '@/lib/hyper/signs';
import { TRACK_LIST, type Track, type TrackId } from '@/lib/hyper/track';
import type { Weapon } from '@/lib/hyper/sim';
import type { ScoreGame } from '@/lib/scores';

type QualityPref = 'auto' | 'low' | 'high' | 'ultra';
type RivalInfo = { name: string; detail: string; color: string; live: boolean; tx: string | null; team: string; kind: string };
const PREFS = `tokenblaster:${GAME_SLUG}-prefs`;
const BEST = `tokenblaster:${GAME_SLUG}-best`;

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
    this.text('speed', String(Math.round(h.kmh)));
    this.text('pos', String(h.pos));
    this.text('posTotal', `/${h.total}`);
    this.text('lap', `LAP ${h.lap}/${h.laps}`);
    this.text('time', fmt(h.time));
    this.text('lapTime', fmt(h.lapTime));
    this.text('best', h.best ? `BEST ${fmt(h.best)}` : 'BEST --');
    this.css('energy', { width: `${Math.round(h.energy * 100)}%`, background: h.energy >= 0.2 ? DR.colour.cyan : DR.colour.grey });
    this.css('hp', { width: `${Math.round(h.hp * 100)}%`, background: h.hp > 0.5 ? DR.colour.acid : h.hp > 0.25 ? DR.colour.amber : DR.colour.signal });
    this.css('hpTag', { opacity: h.hp > 0.25 ? '1' : String(0.4 + 0.6 * (Math.floor(performance.now() / 180) % 2)) });
    this.css('boostTag', { opacity: h.energy >= 0.2 ? '1' : '0.3' });
    this.css('speedBar', { width: `${Math.round(h.speed01 * 100)}%`, background: h.boosting ? DR.colour.cyan : DR.colour.amber });
    this.css('prog', { width: `${Math.round(h.progress * 100)}%` });
    this.css('boosting', { opacity: h.boosting ? '1' : '0' });
  }
}

const readBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(BEST) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

const WEAPON_ICON: Record<Weapon, PictogramName> = { rocket: 'rocket', mine: 'mine', shield: 'shield', turbo: 'turbo', quake: 'quake' };
const ORD = ['', '1ST', '2ND', '3RD'];
const hudFont = { fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase' } as const;

export function BRacer() {
  const mount = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const takeRef = useRef(feed.take);
  useEffect(() => {
    takeRef.current = feed.take;
  });
  const engine = useRef<HyperEngine | null>(null);
  const co = useCoinOp(GAME_NAME, GAME_SLUG);
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const [trackId, setTrackId] = useState<TrackId>('canyon');
  const [shipId, setShipId] = useState('wedge');
  const [teamId, setTeamId] = useState('house');
  const [mode, setMode] = useState<Mode>('race');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const wrap = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const fsPending = useRef(false);
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [phase, setPhase] = useState<Phase>('loading');
  const [loading, setLoading] = useState({ msg: 'Starting', pct: 0 });
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [rivals, setRivals] = useState<RivalInfo[]>([]);
  const [board, setBoard] = useState<LiveRow[]>([]);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [weapon, setWeapon] = useState<Weapon | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [best, setBest] = useState<Record<string, number>>({});
  const [newBest, setNewBest] = useState(false);
  const [touch, setTouch] = useState(false);
  const [perf, setPerf] = useState<{ fps: number; level: number } | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [ready, setReady] = useState(false);
  const toastId = useRef(0);
  const weaponRef = useRef<Weapon | null>(null);
  const [hud] = useState(() => new HudDom());
  const mini = useRef<HTMLCanvasElement>(null);
  const miniBase = useRef<{ img: HTMLCanvasElement; fit: (x: number, z: number) => [number, number] } | null>(null);

  useEffect(() => {
    setFonts({ display: drDisplay.style.fontFamily, mono: drMono.style.fontFamily, jp: drJp.style.fontFamily, logo: `${LOGO_FAMILY}, Impact, sans-serif` });
    void Promise.resolve().then(() => {
      setBest(readBest());
      setTouch(Boolean(window.matchMedia?.('(pointer: coarse)').matches));
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { track?: TrackId; ship?: string; team?: string; mode?: Mode; diff?: Difficulty; q?: QualityPref };
        if (p.track && TRACKS[p.track]) setTrackId(p.track);
        if (p.ship && SHIPS.some((s) => s.id === p.ship)) setShipId(p.ship);
        if (p.team && TEAMS.some((t) => t.id === p.team)) setTeamId(p.team);
        if (p.mode) setMode(p.mode);
        if (p.diff) setDifficulty(p.diff);
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
      localStorage.setItem(PREFS, JSON.stringify({ track: trackId, ship: shipId, team: teamId, mode, diff: difficulty, q: qualityPref }));
    } catch {
      /* storage blocked */
    }
  }, [ready, trackId, shipId, teamId, mode, difficulty, qualityPref]);

  const pushToast = useCallback((t: Toast) => {
    const id = ++toastId.current;
    setToasts((a) => [...a.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 2600);
  }, []);

  const bakeMini = useCallback((track: Track) => {
    const W = 140;
    const H = 140;
    const c = document.createElement('canvas');
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext('2d')!;
    const b = track.bounds;
    const pad = 14;
    const k = Math.min((W * 2 - pad * 2) / Math.max(40, b.maxX - b.minX), (H * 2 - pad * 2) / Math.max(40, b.maxZ - b.minZ));
    const ox = (W * 2 - (b.maxX - b.minX) * k) / 2;
    const oz = (H * 2 - (b.maxZ - b.minZ) * k) / 2;
    const fit = (x: number, z: number): [number, number] => [ox + (x - b.minX) * k, H * 2 - (oz + (z - b.minZ) * k)];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [w, col] of [[10, 'rgba(0,0,0,0.8)'], [5, DR.colour.amber]] as const) {
      g.lineWidth = w;
      g.strokeStyle = col;
      g.beginPath();
      for (let i = 0; i <= track.n; i += 3) {
        const [x, y] = fit(track.px[i % track.n], track.pz[i % track.n]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
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
    for (const r of m.rivals) {
      const [px, py] = base.fit(r.x, r.z);
      g.fillStyle = r.c;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px * sc, py * sc, 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const [px, py] = base.fit(m.px, m.pz);
    g.fillStyle = DR.colour.signal;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px * sc, py * sc, 5.2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }, []);

  const onHud = useCallback(
    (h: Hud) => {
      hud.update(h);
      if (h.weapon !== weaponRef.current) {
        weaponRef.current = h.weapon;
        setWeapon(h.weapon);
      }
    },
    [hud],
  );

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
    const eng = new HyperEngine(host, {
      track: trackId,
      ship: shipId,
      team: teamId,
      mode,
      difficulty,
      quality: q,
      touchDevice: isMobileish() && Boolean(window.matchMedia?.('(pointer: coarse)').matches),
      take: (p) => takeRef.current(p),
      cb: {
        onPhase: (p) => {
          if (life.dead) return;
          setPhase(p);
          if (p === 'menu') {
            setRivals(eng.rivalList());
            setShowBoard(false);
          }
        },
        onCount: (n) => !life.dead && setCount(n),
        onHud,
        onToast: (t) => !life.dead && pushToast(t),
        onLoading: (msg, pct) => !life.dead && setLoading({ msg, pct }),
        onMap: drawMini,
        onBoard: (rows) => !life.dead && setBoard(rows),
        onFlash: (k) => {
          if (life.dead) return;
          setFlash(k);
          setTimeout(() => !life.dead && setFlash(null), 450);
        },
        onFinish: (r) => {
          if (life.dead) return;
          setResult(r);
          setShowBoard(false);
          setTimeout(() => !life.dead && setShowBoard(true), 1500);
          const b = readBest();
          const k = `${r.track}:${r.mode}`;
          if (!r.dnf && (!b[k] || r.total < b[k])) {
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
        onStartRequest: () => {
          if (life.dead) return;
          setRun({ paid: false, txid: null });
          eng.begin();
        },
        onPerf: (p) => !life.dead && setPerf(p),
      },
    });
    engine.current = eng;
    eng
      .init()
      .then(() => {
        if (life.dead) return;
        bakeMini(eng.tr);
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __bracer?: HyperEngine }).__bracer = eng;
      })
      .catch((e: unknown) => {
        if (!life.dead) setError(e instanceof Error ? e.message : 'Could not start the 3D scene');
      });
    return () => {
      life.dead = true;
      eng.dispose();
      if (engine.current === eng) engine.current = null;
    };
  }, [ready, trackId, shipId, teamId, mode, difficulty, qualityPref, session, onHud, pushToast, drawMini, bakeMini]);

  useEffect(() => {
    if (phase !== 'menu') return;
    const id = setInterval(() => engine.current && setRivals(engine.current.rivalList()), 1500);
    return () => clearInterval(id);
  }, [phase]);

  const def = TRACKS[trackId];
  const ship = SHIPS.find((s) => s.id === shipId) ?? SHIPS[1];
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const bestTime = best[`${trackId}:${mode}`];
  const racing = phase === 'racing' || phase === 'countdown' || phase === 'paused';
  const start = (paid: boolean) => {
    const eng = engine.current;
    if (!eng) return;
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    setRun({ paid, txid });
    eng.begin();
  };
  const toMenu = () => {
    setResult(null);
    void engine.current?.toMenu();
  };
  const hold = (k: 'left' | 'right' | 'brake' | 'boost' | 'airL' | 'airR' | 'fire' | 'roll') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (engine.current) engine.current.touch[k] = true;
    },
    onPointerUp: () => {
      if (engine.current && k !== 'fire' && k !== 'roll') engine.current.touch[k] = false;
    },
    onPointerCancel: () => {
      if (engine.current) engine.current.touch[k] = false;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  /** Fullscreen from the click itself (the coin lands later, after the gesture has expired). Refusals are quiet. */
  const enterFs = () => {
    const el = wrap.current;
    fsPending.current = true;
    if (!el || document.fullscreenElement || !el.requestFullscreen) return;
    try {
      void el
        .requestFullscreen()
        .then(() => {
          if (isMobileish()) {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            void o?.lock?.('landscape').catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } catch {
      /* not allowed here */
    }
  };
  const exitFs = () => {
    fsPending.current = false;
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      /* nothing to leave */
    }
  };
  const fullscreen = () => (document.fullscreenElement ? exitFs() : enterFs());
  const hardcore = difficulty === 'hardcore';
  const scoreGame = `${GAME_SLUG}-${trackId}${hardcore ? '-hc' : ''}` as ScoreGame;
  const cover = phase === 'countdown' || phase === 'racing' || phase === 'paused';
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
    if (phase === 'countdown' || phase === 'racing') fsPending.current = false;
    if (phase === 'finished') exitFs();
  }, [phase]);
  useEffect(() => {
    const on = () => {
      setFs(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement && phaseRef.current === 'racing') engine.current?.pause(true);
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  // A cancelled payment leaves fullscreen again.
  useEffect(() => {
    if (co.msg && !co.msg.ok && fsPending.current && phase === 'menu') exitFs();
  }, [co.msg, phase]);
  const accent = def.palette.a1;
  const accent2 = def.palette.a2;

  return (
    <section className={`panel ${drFontClass}`} style={{ fontFamily: DR.font.mono }}>
      <GameAudio track="bracer" />
      <div className="panel-header">
        <span className="panel-title">{GAME_NAME}</span>
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
      <div className="relative" style={{ height: 'min(80vh, 800px)', minHeight: 440 }}>
      <div ref={wrap} className={`select-none overflow-hidden bg-black ${cover || fs ? 'fixed inset-0 z-[90]' : 'absolute inset-0'}`} style={cover || fs ? { height: '100dvh' } : undefined}>
        <div ref={mount} className="absolute inset-0 touch-none" />
        {flash && <div className="pointer-events-none absolute inset-0" style={{ background: flash === 'hit' ? 'rgba(232,38,29,0.28)' : flash === 'quake' ? 'rgba(255,184,0,0.2)' : flash === 'pit' ? 'rgba(24,255,122,0.1)' : 'rgba(39,230,255,0.14)' }} />}

        {/* ── HUD ── */}
        <div className={`pointer-events-none absolute inset-0 transition-opacity ${racing ? 'opacity-100' : 'opacity-0'}`}>
          {/* Position + lap */}
          <div className="absolute left-3 top-3 flex items-stretch">
            <div className="flex items-baseline gap-1 px-3 py-1" style={{ background: DR.colour.signal, ...hudFont }}>
              <span ref={hud.ref('pos')} className="text-5xl text-white sm:text-7xl" style={{ lineHeight: 0.85 }}>
                1
              </span>
              <span ref={hud.ref('posTotal')} className="text-xl text-white/80 sm:text-3xl">
                /8
              </span>
            </div>
            <div className="flex flex-col justify-between bg-black/70 px-2 py-1" style={hudFont}>
              <span ref={hud.ref('lap')} className="text-lg text-white sm:text-2xl">
                LAP 1/3
              </span>
              <span className="text-xs text-amber-300" style={{ color: DR.colour.amber }}>
                {def.name}
              </span>
            </div>
          </div>
          {/* Time */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center max-sm:left-auto max-sm:right-3 max-sm:translate-x-0">
            <div className="bg-black/70 px-3 py-1" style={hudFont}>
              <div ref={hud.ref('time')} className="text-2xl tabular-nums text-white sm:text-4xl">
                0:00.00
              </div>
              <div className="flex gap-3 text-[11px] sm:text-sm" style={{ fontFamily: DR.font.mono, fontStyle: 'normal' }}>
                <span ref={hud.ref('lapTime')} className="text-white/80">
                  0:00.00
                </span>
                <span ref={hud.ref('best')} style={{ color: DR.colour.amber }}>
                  BEST --
                </span>
              </div>
            </div>
            <ChevronBar n={14} h={8} colour={accent} />
          </div>
          {/* Live order */}
          <div className="absolute left-3 top-24 hidden w-36 flex-col gap-0.5 sm:flex">
            {board.slice(0, 8).map((r, i) => (
              <div key={`${r.name}${i}`} className="flex items-center gap-1 px-1 py-0.5 text-xs" style={{ ...hudFont, background: r.me ? DR.colour.signal : 'rgba(0,0,0,0.6)', color: '#fff' }}>
                <span className="w-4 text-right opacity-70">{i + 1}</span>
                <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: r.color, outline: '1px solid #000' }} />
                {r.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.logo} alt="" className="h-3.5 w-3.5 rounded-full" />
                ) : null}
                <span className="truncate">{r.name}</span>
              </div>
            ))}
          </div>
          {/* Minimap + progress */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1 max-sm:top-16">
            <canvas ref={mini} width={140} height={140} className="h-[84px] w-[84px] bg-black/60 sm:h-[130px] sm:w-[130px]" />
            <div className="h-1.5 w-[84px] bg-black/60 sm:w-[130px]">
              <div ref={hud.ref('prog')} className="h-full" style={{ width: '0%', background: accent2 }} />
            </div>
          </div>
          {/* Speed + boost */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center max-sm:bottom-[5.5rem]">
            <div className="flex items-end gap-2 bg-black/60 px-4 py-1">
              <span ref={hud.ref('speed')} className="text-6xl tabular-nums text-white sm:text-8xl" style={{ ...hudFont, lineHeight: 0.82 }}>
                0
              </span>
              <span className="pb-1 text-sm" style={{ ...hudFont, color: DR.colour.amber }}>
                KM/H
              </span>
            </div>
            <div className="h-2 w-[min(70vw,360px)] bg-black/70">
              <div ref={hud.ref('speedBar')} className="h-full" style={{ width: '0%', background: DR.colour.amber }} />
            </div>
            <div className="mt-1 flex w-[min(70vw,360px)] items-center gap-2">
              <span ref={hud.ref('hpTag')} className="w-12 text-xs" style={{ ...hudFont, color: DR.colour.acid }}>
                SHIELD
              </span>
              <div className="h-3 flex-1 bg-black/70" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 14px, rgba(0,0,0,0.9) 14px 16px)' }}>
                <div ref={hud.ref('hp')} className="h-full" style={{ width: '100%', background: DR.colour.acid }} />
              </div>
            </div>
            <div className="mt-1 flex w-[min(70vw,360px)] items-center gap-2">
              <span ref={hud.ref('boostTag')} className="w-12 text-xs" style={{ ...hudFont, color: DR.colour.cyan }}>
                BOOST
              </span>
              <div className="h-2.5 flex-1 bg-black/70" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 9px, rgba(0,0,0,0.9) 9px 10px)' }}>
                <div ref={hud.ref('energy')} className="h-full" style={{ width: '0%', background: DR.colour.cyan }} />
              </div>
            </div>
          </div>
          <div ref={hud.ref('boosting')} className="absolute left-1/2 top-[22%] -translate-x-1/2 opacity-0 transition-opacity">
            <Sticker bg={DR.colour.cyan} size={28} rot={-4}>
              TURBO ▸▸▸
            </Sticker>
          </div>
          {/* Weapon slot */}
          <div className="absolute bottom-16 right-3 flex h-16 w-16 items-center justify-center border-2 bg-black/70 sm:bottom-16 sm:h-24 sm:w-24" style={{ borderColor: weapon ? DR.colour.amber : DR.colour.grey }}>
            {weapon ? (
              <div className="flex flex-col items-center gap-1">
                <Pictogram name={WEAPON_ICON[weapon]} size={36} colour={DR.colour.amber} />
                <span className="text-xs" style={{ ...hudFont, color: DR.colour.amber }}>
                  {weapon}
                </span>
              </div>
            ) : (
              <span className="px-1 text-center text-[10px] leading-tight" style={{ ...hudFont, color: DR.colour.grey }}>
                NO ITEM
              </span>
            )}
          </div>
          {/* Toasts as stickers */}
          <div className="absolute bottom-24 left-3 flex flex-col items-start gap-1 sm:bottom-28">
            {toasts.map((t) => (
              <Sticker key={t.id} bg={t.tone === 'good' ? DR.colour.acid : t.tone === 'bad' ? DR.colour.signal : DR.colour.paper} fg={t.tone === 'bad' ? '#fff' : '#111'} size={16} rot={-2}>
                {t.text}
              </Sticker>
            ))}
          </div>
        </div>

        {count !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <style>{`@keyframes brCount { 0% { transform: scale(2.6) skewX(-8deg); opacity: 0 } 25% { opacity: 1 } 100% { transform: scale(1) skewX(-8deg); opacity: 0.95 } }`}</style>
            <span key={count} style={{ ...hudFont, fontSize: 'clamp(110px, 24vw, 280px)', color: count === 0 ? DR.colour.acid : DR.colour.amber, WebkitTextStroke: '5px #000', textShadow: '0 10px 0 #000, 0 0 50px rgba(255,184,0,0.5)', animation: 'brCount 0.8s ease-out both' }}>
              {count === 0 ? 'GO' : count}
            </span>
          </div>
        )}

        {/* ── Touch controls ── */}
        {touch && racing && phase !== 'paused' && (
          <>
            <div className="absolute bottom-3 left-3 flex gap-2">
              <button {...hold('left')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Steer left">
                ◀
              </button>
              <button {...hold('right')} className="btn h-16 w-16 touch-none text-3xl sm:h-20 sm:w-20" aria-label="Steer right">
                ▶
              </button>
            </div>
            <div className="absolute bottom-24 left-3 flex gap-2">
              <button {...hold('airL')} className="btn h-10 w-12 touch-none text-[10px]">
                AIR L
              </button>
              <button {...hold('airR')} className="btn h-10 w-12 touch-none text-[10px]">
                AIR R
              </button>
              <button {...hold('roll')} className="btn h-10 w-12 touch-none text-[10px]">
                ROLL
              </button>
            </div>
            <div className="absolute bottom-24 right-3 flex flex-col items-end gap-2">
              <button {...hold('fire')} className="btn btn-on h-12 w-16 touch-none text-xs">
                FIRE
              </button>
            </div>
            <div className="absolute bottom-3 right-24 flex gap-2 sm:right-28">
              <button {...hold('brake')} className="btn h-12 w-14 touch-none text-xs">
                BRAKE
              </button>
              <button {...hold('boost')} className="btn btn-on h-12 w-16 touch-none text-xs">
                BOOST
              </button>
            </div>
          </>
        )}
        {racing && (
          <div data-bracer-mode={run.paid ? 'paid' : 'practice'} className={`pointer-events-none absolute left-1/2 top-[4.4rem] -translate-x-1/2 border bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest max-sm:hidden sm:top-1 sm:text-xs ${run.paid ? 'border-[#ffd36a] text-[#ffd36a]' : 'border-white/20 text-dim'}`}>
            {run.paid ? 'PAID · 1 CREDIT' : 'PRACTICE'}
          </div>
        )}
        {racing && (
          <div className="absolute right-3 top-[9.5rem] flex gap-1 sm:top-[11.4rem]">
            <button onClick={() => engine.current?.pause(phase !== 'paused')} className="btn px-2 py-1 text-xs" aria-label="Pause">
              {phase === 'paused' ? '▶' : 'Ⅱ'}
            </button>
            <button onClick={fullscreen} className="btn px-2 py-1 text-xs" aria-label="Fullscreen">
              ⛶
            </button>
          </div>
        )}

        {/* ── Loading poster ── */}
        {phase === 'loading' && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black" style={gridBg()}>
            <Logo size="clamp(56px,11vw,120px)" />
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
            <p className="max-w-md text-sm text-dim">{error}. {GAME_NAME} needs WebGL: try a recent Chrome, Edge, Firefox or Safari with hardware acceleration on.</p>
            <button onClick={() => setSession((s) => s + 1)} className="btn btn-on">
              RETRY
            </button>
          </div>
        )}

        {/* ── Title poster / menu ── */}
        {phase === 'menu' && (
          <div className="absolute inset-0 overflow-y-auto p-2 sm:p-4" style={{ background: 'linear-gradient(90deg, rgba(5,5,8,0.94) 0%, rgba(5,5,8,0.78) 46%, rgba(5,5,8,0) 78%)' }}>
            <div className="flex max-w-[34rem] flex-col gap-3">
              <div className="relative">
                <div className="leading-none">
                  <Logo size="clamp(44px,7.2vw,80px)" />
                </div>
                <div className="absolute right-0 top-1 hidden flex-col items-end gap-1 sm:flex">
                  <Kana size={13} colour={DR.colour.amber}>
                    {GAME_KANA}
                  </Kana>
                  <ProductCode code="HG-3000" label="TB" />
                </div>
                <div className="-mt-1 flex flex-wrap items-center gap-2">
                  <Sticker bg={DR.colour.amber} size={15} rot={-2}>
                    BUY NOW / BLAST MORE
                  </Sticker>
                  <Sticker bg={DR.colour.paper} size={12} rot={2}>
                    {GAME_TAGLINE}
                  </Sticker>
                </div>
                <div className="mt-2 w-[min(90%,22rem)]">
                  <ChevronBar n={26} h={10} colour={DR.colour.signal} />
                </div>
              </div>
              <p className="max-w-md text-xs text-fg">Every rival is a real mainnet transaction. The bigger the move, the faster the ship; token tickers and logos fly as team colours. Hit pads, grab weapons, barrel-roll for boost.</p>

              <div>
                <p className="mb-1 text-[10px] tracking-widest text-dim">01 / CIRCUIT</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {TRACK_LIST.map((t, i) => (
                    <button key={t.id} onClick={() => setTrackId(t.id)} aria-pressed={t.id === trackId} className="relative overflow-hidden border-2 p-1.5 text-left" style={{ borderColor: t.id === trackId ? t.palette.a1 : '#333', background: t.id === trackId ? '#0c0c10' : '#07070a', ...(t.id === trackId ? halftone(t.palette.a2, 10, 0.3) : {}) }}>
                      <span className="block text-[9px] tracking-widest" style={{ color: t.palette.a1, fontFamily: DR.font.mono }}>
                        {t.code} · 0{i + 1}
                      </span>
                      <span className="block text-xl leading-none text-white" style={hudFont}>
                        {t.name}
                      </span>
                      <Kana size={9} colour={t.palette.a2}>
                        {t.kana}
                      </Kana>
                      {best[`${t.id}:${mode}`] ? (
                        <span className="mt-0.5 block text-[10px]" style={{ color: DR.colour.amber }}>
                          {fmt(best[`${t.id}:${mode}`])}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-dim">{def.blurb}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] tracking-widest text-dim">02 / MODE</p>
                  <div className="flex gap-1.5">
                    {(['race', 'trial'] as const).map((m) => (
                      <button key={m} onClick={() => setMode(m)} aria-pressed={m === mode} className="flex-1 border-2 px-2 py-1.5 text-lg" style={{ ...hudFont, borderColor: m === mode ? DR.colour.amber : '#333', background: m === mode ? DR.colour.amber : '#07070a', color: m === mode ? '#000' : '#ddd' }}>
                        {m === 'race' ? 'RACE · 3 LAPS' : 'TIME TRIAL'}
                      </button>
                    ))}
                  </div>
                  <p className="mb-1 mt-2 text-[10px] tracking-widest text-dim">02b / DIFFICULTY</p>
                  <div className="flex gap-1.5">
                    {(['normal', 'hardcore'] as const).map((d) => (
                      <button key={d} onClick={() => setDifficulty(d)} aria-pressed={d === difficulty} className="flex-1 border-2 px-2 py-1 text-left" style={{ ...hudFont, borderColor: d === difficulty ? (d === 'hardcore' ? DR.colour.signal : DR.colour.acid) : '#333', background: d === difficulty ? (d === 'hardcore' ? DR.colour.signal : '#10200a') : '#07070a', color: d === difficulty && d === 'hardcore' ? '#fff' : '#ddd' }}>
                        <span className="block text-base leading-none">{d === 'normal' ? 'NORMAL' : 'HARDCORE'}</span>
                        <span className="block text-[9px] leading-tight opacity-80" style={{ fontFamily: DR.font.mono, fontStyle: 'normal', textTransform: 'none' }}>
                          {d === 'normal' ? 'shield + pit lane' : '2.5x damage, no pit, head-on = boom'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] tracking-widest text-dim">03 / HULL</p>
                  <div className="flex gap-1.5">
                    {SHIPS.map((s) => (
                      <button key={s.id} onClick={() => setShipId(s.id)} aria-pressed={s.id === shipId} title={s.blurb} className="flex-1 border-2 px-1.5 py-1 text-left" style={{ borderColor: s.id === shipId ? DR.colour.cyan : '#333', background: s.id === shipId ? '#0a1a1e' : '#07070a' }}>
                        <span className="block text-base leading-none text-white" style={hudFont}>
                          {s.name}
                        </span>
                        <span className="mt-0.5 block h-1 bg-white/10">
                          <span className="block h-full" style={{ width: `${((s.vmax - 150) / 40) * 100}%`, background: DR.colour.amber }} />
                        </span>
                        <span className="mt-0.5 block h-1 bg-white/10">
                          <span className="block h-full" style={{ width: `${((s.turn - 50) / 50) * 100}%`, background: DR.colour.cyan }} />
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-0.5 text-[10px] text-dim">
                    {ship.name}: {ship.blurb}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-widest text-dim">04 / TEAM</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {TEAMS.map((t) => (
                    <button key={t.id} onClick={() => setTeamId(t.id)} aria-pressed={t.id === teamId} className="relative overflow-hidden p-1 text-left" style={{ background: t.base, outline: t.id === teamId ? `3px solid ${DR.colour.paper}` : '1px solid #000', outlineOffset: -1 }}>
                      <div className="opacity-90">
                        <ChevronBar n={6} h={9} colour={t.accent} />
                      </div>
                      <span className="mt-1 block text-[13px] leading-[0.9] sm:text-sm" style={{ ...hudFont, color: t.accent }}>
                        {t.name}
                      </span>
                      <span className="block text-[8px] tracking-widest" style={{ color: t.trim === '#111111' || t.trim === '#101010' ? t.accent : t.trim, fontFamily: DR.font.mono }}>
                        {t.code}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-0.5 text-[10px] text-dim">
                  {team.name} <Kana size={9} colour={DR.colour.grey}>{team.kana}</Kana> · {team.motto}
                </p>
              </div>

              <div className="inset bg-black/60 p-2">
                <p className="mb-1 text-[10px] tracking-widest text-dim">ON THE GRID · {rivals.filter((r) => r.live).length} LIVE TXS{rivals.some((r) => !r.live) ? ` + ${rivals.filter((r) => !r.live).length} IDLE` : ''}</p>
                <div className="grid max-h-20 grid-cols-1 gap-x-3 overflow-y-auto text-[11px] sm:grid-cols-2">
                  {mode === 'trial' ? <span className="text-dim">Time trial: just you and the clock.</span> : null}
                  {mode === 'race' && rivals.map((r, i) => (
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

              <div className="flex flex-wrap items-center gap-2">
                <CoinOpButtons co={co} start={start} perCredit="1 credit = 1 race (3 laps, or a time trial)." playLabel="RACE" practiceLabel="▶ RACE · PRACTICE" onPress={enterFs} />
                {bestTime ? <span className="text-sm" style={{ color: DR.colour.amber }}>BEST {fmt(bestTime)}</span> : null}
              </div>
              <details className="text-[11px] text-dim">
                <summary className="cursor-pointer text-fg">CONTROLS</summary>
                <p className="mt-1">
                  <span className="text-fg">Keys:</span> ↑/W thrust · ↓/S brake · ←→/AD steer · <span style={{ color: DR.colour.amber }}>Q / E</span> airbrakes (hairpins) · <span style={{ color: DR.colour.amber }}>Z / X</span> barrel roll (in the air = boost) · <span style={{ color: DR.colour.amber }}>Shift</span> boost meter · <span style={{ color: DR.colour.amber }}>Space</span> fire item · C camera · P pause
                </p>
                <p>
                  <span className="text-fg">Pad:</span> RT thrust · LT brake · stick steer · LB/RB airbrakes · X/B roll · A boost · Y fire · Select camera. Touch: thrust is automatic; on-screen buttons. Weapons: rocket, mine, shield, turbo, quake. Chevron pads = boost. Yellow ramps = jump.
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
            <Display size={64} colour={DR.colour.amber}>
              PAUSED
            </Display>
            <p className="text-xs font-bold tracking-widest text-dim">{coinOpModeLabel(run.paid, co.credits)}</p>
            <button onClick={() => engine.current?.pause(false)} className="btn-fire px-6 py-2 text-lg">
              RESUME
            </button>
            <button onClick={() => engine.current?.begin()} className="btn">
              RESTART RACE
            </button>
            <button onClick={fullscreen} className="btn">
              {fs ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}
            </button>
            <button onClick={toMenu} className="btn">
              TITLE
            </button>
          </div>
        )}

        {/* ── Results poster ── */}
        {phase === 'finished' && result && showBoard && (
          <div className="absolute inset-0 overflow-y-auto bg-black/85 p-2 sm:p-4" onKeyDown={(e) => e.stopPropagation()}>
            <PosterFrame accent={accent} code={`${def.code} / RESULT`} kana="リザルト" className="mx-auto max-w-4xl" style={{ background: 'rgba(8,8,12,0.94)' }}>
              <div className="flex flex-col gap-3 p-3 sm:p-5">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                  <Display size="clamp(80px,16vw,170px)" colour={result.dnf ? DR.colour.signal : result.mode === 'trial' || result.pos === 1 ? DR.colour.acid : DR.colour.paper}>
                    {result.dnf ? 'DNF' : result.mode === 'trial' ? 'DONE' : ORD[result.pos] ?? `${result.pos}TH`}
                  </Display>
                  <div className="pb-2">
                    <Display size={34} colour={DR.colour.amber}>
                      {result.dnf ? 'SHIP DESTROYED' : result.mode === 'trial' ? def.name : `OF ${result.total_cars}`}
                    </Display>
                    <div className="text-3xl tabular-nums text-white" style={hudFont}>
                      {result.dnf ? (hardcore ? 'HARDCORE' : 'NORMAL') : fmt(result.total)}
                      {newBest && <span className="ml-2 text-base" style={{ color: DR.colour.acid }}>NEW BEST</span>}
                    </div>
                  </div>
                  <div className="ml-auto hidden pb-2 sm:block">
                    <ProductCode code={def.code} label={(hardcore ? 'HC ' : '') + ship.name.toUpperCase()} />
                  </div>
                </div>
                <ChevronBar n={44} h={12} colour={accent2} />
                <p className="text-xs text-dim">
                  laps {result.laps.map(fmt).join(' / ') || '-'} · best lap {result.laps.length ? fmt(result.bestLap) : '-'} · {result.hits} wall hits · {result.cells} cells · {result.rivalHits} rival hits
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  {([['TIME', result.parts.time], ['PLACE', result.parts.place], ['CELLS', result.parts.cells], ['CLEAN', result.parts.clean], ['COMBAT', result.parts.combat]] as const).map(([k, v]) => (
                    <div key={k} className="inset px-2 py-1">
                      <div className="text-dim">{k}</div>
                      <div className="text-xl" style={{ ...hudFont, color: DR.colour.amber }}>
                        {v.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Sticker bg={DR.colour.signal} fg="#fff" size={26} rot={-2}>
                    SCORE {result.score.toLocaleString()}
                  </Sticker>
                  <Barcode seed={`${result.score}${result.total}`} w={110} h={22} />
                </div>
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-center">
                  {result.mode === 'race' && (
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
                          <span className="ml-auto tabular-nums">{r.time >= 9999 ? 'DNF' : fmt(r.time)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.dnf ? (
                    <div className="inset w-full bg-black/70 p-3 text-center text-xs sm:max-w-sm">
                      <p className="font-bold tracking-widest" style={{ color: DR.colour.signal }}>
                        DID NOT FINISH
                      </p>
                      <p className="mt-1 text-dim">A wrecked ship has no time to post. The credit is spent: keep it off the walls, grab the pit lane and use shields.</p>
                    </div>
                  ) : (
                  <HighScores game={scoreGame} score={result.score} secs={result.total} live={run.paid} txid={run.txid} meta={run.paid ? { ship: result.ship, mode: result.mode, diff: result.difficulty, pos: result.pos, coinop: 1 } : { ship: result.ship, mode: result.mode, diff: result.difficulty, pos: result.pos }} sorts={['score', 'time']} label="SCORE" />
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <CoinOpButtons co={co} start={start} perCredit="1 credit = 1 race." playLabel="RACE AGAIN" practiceLabel="▶ RACE AGAIN · PRACTICE" onPress={enterFs} />
                  <button onClick={toMenu} className="btn">
                    TITLE / NEW RIVALS
                  </button>
                </div>
              </div>
            </PosterFrame>
          </div>
        )}
      </div>
      </div>
      <HazardBar h={8} colour={DR.colour.amber} />
      <p className="mt-2 text-xs text-muted">
        {GAME_NAME}: rivals are real transactions sampled from the live BSV chain when you start; tokens race as teams wearing their ticker and logo, the biggest moves are the fastest ships. A credit (10p) buys one race; practice sends nothing. Ships, circuits, signage and the techno are generated in code;
        no outside assets. The graphic style is an homage to 90s electronic-label design, all layouts original.
      </p>
      {co.chooserEl}
    </section>
  );
}
