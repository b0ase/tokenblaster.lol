'use client';

/**
 * BSVGun range: the 3D shooting range shell. The canvas and game live in src/lib/bsvgun/engine.ts;
 * this owns the DR-style title, weapon select, HUD and results, the wallet/ammo wiring (LIVE shots go
 * through src/lib/bsvgun/useShots.ts -> useBlaster().fireBatch) and the scores.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HighScores } from './HighScores';
import { Barcode, Display, HazardBar, Kana, ProductCode, Sticker, gridBg } from './dr';
import { drDisplay, drFontClass } from './dr/fonts';
import { DR } from '@/lib/dr/tokens';
import { STORM_FEE } from '@/lib/gun';
import { slugOf } from '@/lib/ordnance';
import { useChainFeed } from '@/lib/useChainFeed';
import { useOrdnance } from '@/lib/useOrdnance';
import type { useBlaster } from '@/lib/useBlaster';
import { useGameFullscreen } from '@/lib/useGameFullscreen';
import { RangeEngine, type Hooks, type Hud, type Phase, type Quality, type Result } from '@/lib/bsvgun/engine';
import { TARGET_INFO, type TargetKind } from '@/lib/bsvgun/targets';
import { STOCK_IDS, buildWeapons, type RangeWeapon } from '@/lib/bsvgun/weapons';
import { useShots } from '@/lib/bsvgun/useShots';

type Blaster = ReturnType<typeof useBlaster>;
export type BlastState = { active: boolean; tps: number; sent: number; target: number };
type QualityPref = 'auto' | 'low' | 'high';

const PREFS = 'bsvgun:range-prefs';
const BEST = 'bsvgun:range-best';
const LOADS = [1_000, 5_000, 25_000];
const EMPTY_HUD: Hud = { score: 0, timeLeft: 75, streak: 0, mult: 1, shots: 0, hits: 0, weapon: '', zoomed: false, scoped: false, hover: '', banner: '', feedLive: false, targets: 0 };

const autoQuality = (): Quality => {
  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
  return phone || weak ? 'low' : 'high';
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;

export function BSVGunRange({ b, mode, blast }: { b: Blaster; mode: 'range' | 'blast'; blast: BlastState }) {
  const wrap = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const popHost = useRef<HTMLDivElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const engine = useRef<RangeEngine | null>(null);
  const hudSink = useRef<(h: Hud) => void>(() => undefined);

  const active = mode === 'range';
  const weapons = useMemo(() => buildWeapons(), []);
  const [live, setLive] = useState(false);
  const [weaponId, setWeaponId] = useState('plasmarifle');
  const [qualityPref, setQualityPref] = useState<QualityPref>('auto');
  const [quality, setQuality] = useState<Quality | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('menu');
  const [result, setResult] = useState<Result | null>(null);
  const [paused, setPaused] = useState(false);
  const [best, setBest] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const feed = useChainFeed();
  const feedRef = useRef(feed);
  const heightRef = useRef(0);
  const shots = useShots(b, live);
  const { owned } = useOrdnance(b.wallet);
  const unlocked = useMemo(() => new Set([...STOCK_IDS, ...owned]), [owned]);
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];

  useEffect(() => {
    feedRef.current = feed;
  });

  // Remembered choices (after mount, so server and client render the same first frame).
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { w?: string; q?: QualityPref; live?: boolean };
        if (p.w) setWeaponId(p.w);
        if (p.q) setQualityPref(p.q);
        if (p.live) setLive(true);
        setBest(Number(localStorage.getItem(BEST) ?? 0) || 0);
      } catch {
        /* storage blocked */
      }
      setQuality(autoQuality());
      setPrefsLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(PREFS, JSON.stringify({ w: weaponId, q: qualityPref, live }));
    } catch {
      /* storage blocked */
    }
  }, [prefsLoaded, weaponId, qualityPref, live]);
  const effQuality: Quality | null = qualityPref === 'auto' ? quality : qualityPref;

  // Tip height for the block wave (every real new block triggers a bonus wave).
  useEffect(() => {
    let dead = false;
    const poll = () =>
      fetch('/api/chain')
        .then((r) => r.json())
        .then((s: { height?: number }) => {
          if (!dead && s.height) heightRef.current = s.height;
        })
        .catch(() => undefined);
    void poll();
    const i = setInterval(poll, 12_000);
    return () => {
      dead = true;
      clearInterval(i);
    };
  }, []);

  // What the engine calls back into. Updated every render so it always sees the latest wallet/shots.
  const hooks = useRef<Hooks>({
    fire: () => true,
    take: () => null,
    feedLive: () => false,
    height: () => 0,
    hud: () => undefined,
    phase: () => undefined,
    over: () => undefined,
  });
  useEffect(() => {
    hooks.current = {
      fire: (w) => shots.fire(w),
      take: (pred) => feedRef.current.take(pred),
      feedLive: () => feedRef.current.status === 'live',
      height: () => heightRef.current,
      hud: (h) => hudSink.current(h),
      phase: (p) => setPhase(p),
      over: (r) => {
        setResult(r);
        setBest((o) => {
          const n = Math.max(o, r.score);
          try {
            localStorage.setItem(BEST, String(n));
          } catch {
            /* storage blocked */
          }
          return n;
        });
      },
      reticle: (x, y, show) => {
        const el = reticle.current;
        if (!el) return;
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.opacity = show ? '1' : '0';
      },
    };
  });

  // Build the engine (a fresh canvas each time: quality changes and StrictMode remounts).
  useEffect(() => {
    if (!effQuality || !mount.current || !popHost.current) return;
    const host = mount.current;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none';
    canvas.tabIndex = 0;
    host.prepend(canvas);
    const eng = new RangeEngine(canvas, popHost.current, hooks, { quality: effQuality, font: drDisplay.style.fontFamily, weapons });
    engine.current = eng;
    let dead = false;
    void Promise.resolve().then(() => {
      setReady(false);
      setProgress(0);
    });
    eng.init((p) => !dead && setProgress(p))
      .then(() => {
        if (dead) return;
        setErr(null);
        setReady(true);
      })
      .catch((e: unknown) => !dead && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      eng.dispose();
      engine.current = null;
      canvas.remove();
    };
  }, [effQuality, weapons]);

  // Keep the engine in step with the shell.
  useEffect(() => {
    if (engine.current) engine.current.autoDegrade = qualityPref === 'auto';
  }, [qualityPref, ready]);
  useEffect(() => {
    if (engine.current) engine.current.unlocked = unlocked;
  }, [unlocked, ready]);
  useEffect(() => {
    if (ready && unlocked.has(weaponId)) void engine.current?.setWeapon(weaponId);
  }, [weaponId, ready, unlocked]);
  useEffect(() => {
    engine.current?.setBlast(blast.active, blast.tps);
  }, [blast.active, blast.tps, ready]);
  useEffect(() => {
    if (mode === 'blast' && engine.current?.phase !== 'menu') {
      setPaused(false);
      engine.current?.toMenu();
    }
  }, [mode]);
  useEffect(() => {
    engine.current?.setPaused(paused);
  }, [paused, ready]);

  const gfs = useGameFullscreen(wrap, {
    playing: active && phase === 'play',
    ended: phase === 'over',
    onLeftWhilePlaying: () => setPaused(true),
  });
  const { fs, enter: enterFs, toggle: toggleFs } = gfs;
  const start = useCallback(() => {
    if (!engine.current || !unlocked.has(weaponId)) return;
    enterFs(); // from the click / Enter itself, so the browser allows it
    shots.reset();
    setResult(null);
    setPaused(false);
    setRunKey((k) => k + 1);
    engine.current.start(weaponId, live);
    mount.current?.querySelector('canvas')?.focus();
  }, [weaponId, live, unlocked, shots, enterFs]);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  // Keys: 1-9 pick a weapon, Q/E cycle, Esc pauses, Enter starts.
  useEffect(() => {
    if (!active) return;
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const eng = engine.current;
      if (!eng) return;
      const list = weapons.filter((w) => unlocked.has(w.id));
      if (/^[1-9]$/.test(e.key) && list[Number(e.key) - 1]) {
        setWeaponId(list[Number(e.key) - 1].id);
        if (eng.phase === 'play') void eng.setWeapon(list[Number(e.key) - 1].id);
      } else if (e.key === 'q' || e.key === 'Q') {
        eng.cycleWeapon(-1);
        if (eng.phase !== 'play') cycleSel(-1);
      } else if (e.key === 'e' || e.key === 'E') {
        eng.cycleWeapon(1);
        if (eng.phase !== 'play') cycleSel(1);
      } else if (e.key === 'Escape' && eng.phase === 'play') setPaused((p) => !p);
      else if (e.key === 'Enter' && eng.phase === 'menu') startRef.current();
    };
    const cycleSel = (d: number) => {
      const list = weapons.filter((w) => unlocked.has(w.id));
      const i = Math.max(0, list.findIndex((w) => w.id === weaponId));
      setWeaponId(list[(i + d + list.length) % list.length].id);
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [active, weapons, unlocked, weaponId]);

  // Mid-run weapon switch from the HUD strip.
  const pick = (w: RangeWeapon) => {
    if (!unlocked.has(w.id)) return;
    setWeaponId(w.id);
    if (phase === 'play') void engine.current?.setWeapon(w.id);
  };

  const playing = phase === 'play';
  const menu = active && phase === 'menu' && ready;
  const costPerShot = STORM_FEE;
  const liveReady = !live || (!!b.wallet && shots.shotsAffordable >= 20);

  return (
    <div className="bg-stage relative w-full">
    <div ref={wrap} className={`select-none overflow-hidden bg-black ${gfs.cover ? 'fixed inset-0 z-[90]' : 'absolute inset-0'} ${drFontClass}`} style={{ height: gfs.cover ? '100dvh' : undefined, fontFamily: DR.font.mono, border: gfs.cover ? undefined : `2px solid ${DR.colour.signal}` }}>
      <style>{`
        .bg-pop{position:absolute;transform:translate(-50%,-50%);font-family:${DR.font.display};font-weight:900;font-style:italic;text-transform:uppercase;white-space:nowrap;text-shadow:0 0 8px currentColor,0 2px 0 #000;animation:bgpop .95s ease-out forwards;pointer-events:none}
        @keyframes bgpop{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}12%{opacity:1;transform:translate(-50%,-60%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-190%) scale(1)}}
        .bg-card{border:2px solid #2a2b33;background:rgba(10,10,12,.78);transition:transform .12s,border-color .12s}
        .bg-card:hover:not([data-locked]){transform:translateY(-2px);border-color:${DR.colour.amber}}
        .bg-bar{height:4px;background:#26272e}.bg-bar>i{display:block;height:100%;background:${DR.colour.amber}}
        .bg-stage{aspect-ratio:16/9;max-height:86vh;min-height:420px}
        @media (max-width:760px){.bg-stage{aspect-ratio:auto;height:82vh;min-height:560px}}
        @media (max-height:540px){.bg-stage{aspect-ratio:auto;height:calc(100vh - 60px);min-height:300px;max-height:none}.bg-desc,.bg-hint{display:none !important}}
        .bg-touch{display:none}@media (pointer:coarse){.bg-touch{display:flex}}
        @media (max-width:760px){.bg-menu{flex-direction:column !important;overflow-y:auto}.bg-menu>div{width:100% !important}}
      `}</style>
      <div ref={mount} className="absolute inset-0" style={{ cursor: playing ? 'none' : 'default' }}>
        {/* the engine prepends its canvas here */}
      </div>
      <div ref={popHost} className="pointer-events-none absolute inset-0 overflow-hidden" />

      {/* Crosshair */}
      <div ref={reticle} className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ willChange: 'transform' }}>
        <Crosshair zoomed={false} colour={weapon?.bolt ?? DR.colour.amber} />
      </div>

      {/* Scope */}
      <HudView register={(fn) => (hudSink.current = fn)}>
        {(h) => (
          <>
            {playing && h.scoped && <Scope />}
            {playing && (
              <>
                <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
                  <div style={{ fontSize: 10, letterSpacing: '0.2em', color: DR.colour.amber }}>SCORE</div>
                  <Display size="clamp(28px,5.4vw,64px)" colour={DR.colour.paper} style={{ textShadow: '0 0 18px rgba(232,38,29,.7)' }}>
                    {h.score.toLocaleString()}
                  </Display>
                  <div style={{ fontSize: 10, color: DR.colour.grey }}>
                    {h.shots} shots · {h.shots ? Math.round((h.hits / h.shots) * 100) : 0}% · {h.targets} in the air
                  </div>
                </div>
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-center">
                  <Display size="clamp(26px,4.2vw,52px)" colour={h.timeLeft < 10 ? DR.colour.signal : DR.colour.paper} className={h.timeLeft < 10 ? 'blink' : ''}>
                    {fmtTime(h.timeLeft)}
                  </Display>
                  <div style={{ fontSize: 10, letterSpacing: '0.18em', color: h.feedLive ? DR.colour.acid : DR.colour.amber }}>{h.feedLive ? '● LIVE CHAIN' : '○ SIMULATED FEED'}</div>
                </div>
                <div className="pointer-events-none absolute right-3 top-3 text-right">
                  <div style={{ fontSize: 10, letterSpacing: '0.2em', color: DR.colour.amber }}>STREAK {h.streak}</div>
                  <Display size="clamp(28px,5vw,60px)" colour={h.mult > 1 ? DR.colour.amber : DR.colour.grey}>
                    x{h.mult}
                  </Display>
                  <div className="ml-auto mt-1 h-1 w-24" style={{ background: '#26272e' }}>
                    <div style={{ width: `${((h.streak % 3) / 3) * 100}%`, height: '100%', background: DR.colour.amber }} />
                  </div>
                </div>
                {h.banner && (
                  <div className="pointer-events-none absolute left-1/2 top-[24%] -translate-x-1/2 text-center">
                    <Sticker bg={DR.colour.signal} fg={DR.colour.paper} rot={-2} size={30}>
                      {h.banner}
                    </Sticker>
                  </div>
                )}
                {h.hover && (
                  <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs" style={{ background: 'rgba(0,0,0,.65)', color: DR.colour.cyan, border: `1px solid ${DR.colour.cyan}` }}>
                    {h.hover}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </HudView>

      {/* Bottom strip: weapons + live status */}
      {playing && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)' }}>
          <div className="pointer-events-none text-xs" style={{ color: live ? DR.colour.acid : DR.colour.grey }}>
            {live ? (
              <>
                <div style={{ color: DR.colour.signal, fontWeight: 700, letterSpacing: '0.16em' }}>● LIVE · REAL TRANSACTIONS</div>
                <div>
                  on chain {shots.onChain.toLocaleString()} · gun {b.ammo.toLocaleString()} sats ({shots.shotsAffordable.toLocaleString()} shots)
                </div>
                {shots.error && <div style={{ color: DR.colour.signal }}>⚠ {shots.error}</div>}
              </>
            ) : (
              <div>PRACTICE · nothing is sent</div>
            )}
          </div>
          <div className="flex max-w-[60%] gap-1 overflow-x-auto pb-0.5">
            {weapons
              .filter((w) => unlocked.has(w.id))
              .slice(0, 9)
              .map((w, i) => (
                <button key={w.id} onClick={() => pick(w)} className="shrink-0 px-2 py-1 text-[11px] font-bold" style={{ background: w.id === weaponId ? DR.colour.amber : 'rgba(10,10,12,.8)', color: w.id === weaponId ? DR.colour.ink : DR.colour.paper, border: `1px solid ${w.id === weaponId ? DR.colour.amber : '#3a3b44'}` }}>
                  {i + 1} {w.name}
                </button>
              ))}
          </div>
          <div className="bg-touch gap-1">
            <button
              className="px-3 py-3 text-xs font-bold"
              style={{ background: 'rgba(10,10,12,.85)', border: `1px solid ${DR.colour.cyan}`, color: DR.colour.cyan }}
              onPointerDown={() => engine.current?.setScope(true)}
              onPointerUp={() => engine.current?.setScope(false)}
              onPointerLeave={() => engine.current?.setScope(false)}
            >
              SCOPE
            </button>
            <button className="px-3 py-3 text-xs font-bold" style={{ background: 'rgba(10,10,12,.85)', border: `1px solid ${DR.colour.amber}`, color: DR.colour.amber }} onClick={() => engine.current?.cycleWeapon(1)}>
              NEXT
            </button>
          </div>
        </div>
      )}
      {playing && (
        <button onClick={() => setPaused(true)} className="absolute right-3 top-[88px] px-2 py-0.5 text-[11px]" style={{ background: 'rgba(10,10,12,.7)', border: '1px solid #3a3b44', color: DR.colour.grey }}>
          PAUSE (Esc)
        </button>
      )}
      <button onClick={toggleFs} className="absolute bottom-2 right-2 z-10 px-2 py-0.5 text-[11px]" style={{ background: 'rgba(10,10,12,.7)', border: '1px solid #3a3b44', color: DR.colour.grey, display: playing ? 'none' : undefined }}>
        {fs ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
      </button>

      {/* Blast Zone readout */}
      {mode === 'blast' && blast.active && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-center">
          <Sticker bg={DR.colour.signal} fg={DR.colour.paper} rot={-1} size={16}>
            BLAST ZONE · LIVE
          </Sticker>
          <div className="mt-1">
            <Display size="clamp(26px,5vw,60px)">{blast.sent.toLocaleString()}</Display>
            <span style={{ color: DR.colour.grey }}> / {blast.target.toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: DR.colour.amber }}>{blast.tps.toLocaleString()} TX/S</div>
        </div>
      )}

      {/* Loading */}
      {(!ready || !effQuality) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: DR.colour.ink, ...gridBg() }}>
          <Display size="clamp(40px,9vw,110px)">BSVGUN</Display>
          <div className="h-1.5 w-64" style={{ background: '#26272e' }}>
            <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: DR.colour.signal, transition: 'width .2s' }} />
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: DR.colour.amber }}>{err ? `⚠ ${err}` : 'BUILDING THE RANGE…'}</div>
        </div>
      )}

      {/* Title + weapon select */}
      {menu && (
        <div className="bg-menu absolute inset-0 flex flex-col justify-between" style={{ background: 'linear-gradient(180deg, rgba(5,5,8,.55) 0%, rgba(5,5,8,0) 28%, rgba(5,5,8,0) 44%, rgba(5,5,8,.88) 74%, rgba(5,5,8,.96) 100%)' }}>
          <div className="flex items-start justify-between gap-3 p-3 sm:p-4">
            <div>
              <div className="flex items-center gap-2">
                <Sticker bg={DR.colour.signal} fg={DR.colour.paper} rot={-3} size={12}>
                  RANGE MODE
                </Sticker>
                <Kana size={12} colour={DR.colour.amber}>
                  射撃場
                </Kana>
              </div>
              <div className="mt-1 flex items-end gap-1 leading-none">
                <Display size="clamp(44px,8.6vw,112px)" style={{ textShadow: '0 0 30px rgba(232,38,29,.6)' }}>
                  BSV
                </Display>
                <Display size="clamp(44px,8.6vw,112px)" colour={DR.colour.signal}>
                  GUN
                </Display>
              </div>
              <div className="bg-desc mt-1 max-w-[46ch] text-[11px] leading-snug sm:text-[12px]" style={{ color: DR.colour.paper, textShadow: '0 1px 4px #000' }}>
                Every target is a real transaction off the chain right now: payments are clay, posts are ducks, tokens carry their logo, a new block is the big one.
              </div>
            </div>
            <div className="hidden text-right sm:block">
              <ProductCode code="BG-001" label="RANGE" colour={DR.colour.grey} />
              <div className="mt-2 text-[11px]" style={{ color: DR.colour.amber }}>
                BEST {best.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={start} disabled={!liveReady || !unlocked.has(weaponId)} className="px-7 py-2.5 text-2xl font-black italic tracking-widest disabled:opacity-40" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}`, boxShadow: '0 0 24px rgba(232,38,29,.55)' }}>
                START ▶
              </button>
              <button onClick={() => setLive(false)} className="px-3 py-1.5 text-sm font-bold" style={{ background: !live ? DR.colour.paper : 'rgba(10,10,12,.8)', color: !live ? DR.colour.ink : DR.colour.paper, border: `2px solid ${DR.colour.paper}` }}>
                PRACTICE
              </button>
              <button onClick={() => setLive(true)} className="px-3 py-1.5 text-sm font-bold" style={{ background: live ? DR.colour.signal : 'rgba(10,10,12,.8)', color: DR.colour.paper, border: `2px solid ${DR.colour.signal}` }}>
                LIVE · ON CHAIN
              </button>
              <span className="text-[11px]" style={{ color: DR.colour.grey }}>
                {live ? `each shot = one real tx (~${costPerShot} sats)` : 'free, nothing is sent'}
              </span>
              {live && !b.wallet && (
                <button onClick={b.connectWallet} disabled={!!b.busy} className="px-3 py-1.5 text-sm font-bold" style={{ background: DR.colour.amber, color: DR.colour.ink }}>
                  {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
                </button>
              )}
              {live && b.wallet && (
                <>
                  <span className="text-[11px]" style={{ color: DR.colour.paper }}>
                    gun <b style={{ color: DR.colour.amber }}>{b.ammo.toLocaleString()}</b> sats ({shots.shotsAffordable.toLocaleString()} shots) · tag {b.token ? `$${b.token.sym}` : 'plain BSV'}
                  </span>
                  {LOADS.map((n) => (
                    <button key={n} onClick={() => void b.load(n, `BSVGun range: ${n.toLocaleString()} sats`)} disabled={!!b.busy} className="px-2 py-1 text-[11px] font-bold" style={{ border: `1px solid ${DR.colour.amber}`, color: DR.colour.amber, background: 'rgba(10,10,12,.8)' }}>
                      {b.busy === 'loading' ? '…' : `LOAD ${n.toLocaleString()}`}
                    </button>
                  ))}
                </>
              )}
              {live && !liveReady && (
                <span className="text-[11px]" style={{ color: DR.colour.amber }}>
                  {b.wallet ? 'load at least 20 shots of sats' : 'connect a wallet to go live'}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[10px]" style={{ color: DR.colour.grey }}>
                QUALITY
                {(['auto', 'low', 'high'] as const).map((q) => (
                  <button key={q} onClick={() => setQualityPref(q)} className="px-1.5 py-0.5" style={{ border: `1px solid ${qualityPref === q ? DR.colour.amber : '#3a3b44'}`, color: qualityPref === q ? DR.colour.amber : DR.colour.grey }}>
                    {q.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Display size={16}>CHOOSE YOUR WEAPON</Display>
              <span className="bg-hint hidden text-[10px] sm:inline" style={{ color: DR.colour.grey }}>
                aim with mouse/touch · click or tap to fire · right-click / Shift scope · 1-9, Q E switch · pad: stick, RT, LT
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {weapons.map((w) => {
                const open = unlocked.has(w.id);
                const sel = w.id === weaponId;
                const card = (
                  <div className="bg-card w-[168px] p-2" data-locked={open ? undefined : ''} style={{ borderColor: sel ? DR.colour.amber : undefined, opacity: open ? 1 : 0.55, boxShadow: sel ? `0 0 0 2px ${DR.colour.amber}, 0 0 18px rgba(255,184,0,.35)` : undefined }}>
                    <div className="flex items-baseline justify-between gap-1">
                      <Display size={14} colour={sel ? DR.colour.amber : DR.colour.paper}>
                        {w.name}
                      </Display>
                      <span className="text-[8px]" style={{ color: DR.colour.grey }}>
                        {w.ordnance ? '1SAT' : 'STOCK'}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 h-[24px] text-[9px] leading-tight" style={{ color: DR.colour.grey }}>
                      {w.blurb}
                    </div>
                    <div className="mt-1 grid grid-cols-[30px_1fr] items-center gap-x-1 gap-y-[3px] text-[8px]" style={{ color: DR.colour.grey }}>
                      {(['rate', 'spread', 'zoom', 'power'] as const).map((k) => (
                        <FragRow key={k} label={k === 'spread' ? 'AIM' : k.toUpperCase()} v={w.bars[k]} />
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px]" style={{ color: open ? DR.colour.paper : DR.colour.amber }}>
                      {open ? (
                        <>
                          <span>
                            {w.auto ? 'AUTO' : 'SEMI'} · {w.ammo.toUpperCase()}
                          </span>
                          <span>{w.zoom.toFixed(1)}x</span>
                        </>
                      ) : (
                        <span>🔒 1Sat Ordnance · get it ›</span>
                      )}
                    </div>
                  </div>
                );
                return open ? (
                  <button key={w.id} className="shrink-0 text-left" onClick={() => setWeaponId(w.id)}>
                    {card}
                  </button>
                ) : (
                  <Link key={w.id} href={w.ordnance ? `/1satordnance/store/${slugOf(w.ordnance)}` : '/1satordnance/store'} className="block shrink-0">
                    {card}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Paused */}
      {active && paused && playing && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3" style={{ background: 'rgba(5,5,8,.78)' }}>
          <Display size="clamp(40px,8vw,96px)">PAUSED</Display>
          <div className="flex gap-2">
            <button onClick={() => setPaused(false)} className="px-6 py-2 text-xl font-black italic" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper }}>
              RESUME
            </button>
            <button
              onClick={() => {
                setPaused(false);
                engine.current?.toMenu();
              }}
              className="px-6 py-2 text-xl font-black italic"
              style={{ fontFamily: DR.font.display, border: `2px solid ${DR.colour.paper}`, color: DR.colour.paper }}
            >
              QUIT
            </button>
            <button onClick={toggleFs} className="px-4 py-2 text-sm font-bold" style={{ border: `1px solid ${DR.colour.grey}`, color: DR.colour.grey }}>
              {fs ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {active && phase === 'over' && result && (
        <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: 'rgba(5,5,8,.9)', ...gridBg() }}>
          <HazardBar h={10} colour={DR.colour.amber} />
          <div className="mx-auto flex max-w-[980px] flex-col gap-3 p-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Sticker bg={DR.colour.amber} fg={DR.colour.ink} rot={-2} size={14}>
                  ROUND OVER
                </Sticker>
                <Kana size={12} colour={DR.colour.signal}>
                  終了
                </Kana>
              </div>
              <Display size="clamp(54px,10vw,128px)" colour={DR.colour.paper} style={{ textShadow: '0 0 30px rgba(232,38,29,.6)' }}>
                {result.score.toLocaleString()}
              </Display>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" style={{ color: DR.colour.paper }}>
                <Stat k="ACCURACY" v={`${Math.round(result.acc * 100)}%`} />
                <Stat k="BEST STREAK" v={String(result.bestStreak)} />
                <Stat k="SHOTS" v={String(result.shots)} />
                <Stat k="BLOCKS" v={String(result.blocks)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(result.kills) as TargetKind[]).map((k) => (
                  <span key={k} className="px-2 py-0.5 text-xs font-bold" style={{ background: TARGET_INFO[k].color, color: DR.colour.ink }}>
                    {TARGET_INFO[k].label} x{result.kills[k]}
                  </span>
                ))}
              </div>
              {live && (
                <div className="text-xs" style={{ color: DR.colour.acid }}>
                  LIVE · {shots.onChain.toLocaleString()} shots on chain
                  {shots.lastTx && (
                    <>
                      {' '}
                      · latest{' '}
                      <a href={`https://whatsonchain.com/tx/${shots.lastTx}`} target="_blank" rel="noopener noreferrer" className="underline">
                        {shots.lastTx.slice(0, 12)}… ↗
                      </a>
                    </>
                  )}
                </div>
              )}
              <div className="mt-1 flex gap-2">
                <button onClick={start} className="px-6 py-2 text-xl font-black italic" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}` }}>
                  AGAIN ▶
                </button>
                <button onClick={() => engine.current?.toMenu()} className="px-6 py-2 text-xl font-black italic" style={{ fontFamily: DR.font.display, border: `2px solid ${DR.colour.paper}`, color: DR.colour.paper }}>
                  WEAPONS
                </button>
              </div>
              <Barcode seed={`BSVGUN${result.score}`} h={22} w={120} colour={DR.colour.grey} />
            </div>
            <div className="min-w-0 flex-1 sm:max-w-[420px]" key={runKey}>
              <HighScores
                game="bsvgun-range"
                score={result.score}
                secs={result.secs}
                live={live && shots.onChain > 0}
                txid={shots.lastTx}
                meta={{ weapon: weaponId.slice(0, 24), acc: Math.round(result.acc * 100), streak: result.bestStreak, blocks: result.blocks, ...(live ? { coinop: 0 } : {}) }}
                label="SCORE"
              />
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function FragRow({ label, v }: { label: string; v: number }) {
  return (
    <>
      <span>{label}</span>
      <span className="bg-bar">
        <i style={{ width: `${Math.round(v * 100)}%` }} />
      </span>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.18em', color: DR.colour.amber }}>{k}</div>
      <div style={{ fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 26 }}>{v}</div>
    </div>
  );
}

function Crosshair({ zoomed, colour }: { zoomed: boolean; colour: string }) {
  const s = zoomed ? 20 : 34;
  return (
    <svg width={s * 2} height={s * 2} viewBox="-34 -34 68 68" style={{ position: 'absolute', left: -s, top: -s, filter: `drop-shadow(0 0 3px ${colour})` }} fill="none" stroke={colour} strokeWidth="2.4" strokeLinecap="round">
      <circle r="17" strokeOpacity="0.9" />
      <path d="M-30 0H-9M9 0H30M0 -30V-9M0 9V30" />
      <circle r="1.8" fill={colour} stroke="none" />
    </svg>
  );
}

function Scope() {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, transparent 0, transparent 33%, rgba(0,0,0,.94) 34%)' }}>
      <div className="absolute left-0 right-0 top-1/2 h-px" style={{ background: 'rgba(255,255,255,.25)' }} />
      <div className="absolute bottom-0 left-1/2 top-0 w-px" style={{ background: 'rgba(255,255,255,.25)' }} />
    </div>
  );
}

/** Receives the engine's 10 Hz HUD without re-rendering the whole shell. */
function HudView({ register, children }: { register: (fn: (h: Hud) => void) => void; children: (h: Hud) => React.ReactNode }) {
  const [h, setH] = useState<Hud>(EMPTY_HUD);
  const reg = useRef(register);
  useEffect(() => {
    const r = reg.current;
    r(setH);
    return () => r(() => undefined);
  }, []);
  return <>{children(h)}</>;
}
