'use client';

/**
 * TokenBlaster Shooting Gallery (3D). First person behind the BSVGun arsenal on a rain-wet night street,
 * against the OMNICORE DYNAMICS tower and its LIQUID UNIT (src/lib/galleryGame/*). Every round that lands
 * is a real BSV transaction: "tokenblaster.lol" <ammo> <chain:n> "gallery" [<handle>].
 *
 * How each weapon spends transactions (src/lib/gallery.ts txPattern):
 *  - STREAM (minigun and the other full-autos): hold the trigger and the chain streams. LIVE runs the gun's
 *    storm (src/lib/gun.ts): the coin fans out into lanes it controls, every core signs, ARC takes them.
 *  - BURST (shotguns, quad plasma, launchers): each pull is one batch of N transactions (fireBatch).
 * Damage only comes from accepted transactions: the engine's `accept(n)`.
 *
 * Money (non-custodial): the player's wallet funds the browser gun (one approval), the gun signs and
 * broadcasts, UNLOAD returns what is left. Free for the stress test (network cost only) until 31 Oct UTC;
 * the platform fee starts automatically on 1 Nov (src/lib/gallery.ts FEE_FROM).
 *
 * FREE PRACTICE never touches the chain. `?dryrun=1` makes LIVE simulate too (no wallet, no broadcast).
 * `?autofire=1` holds the trigger on the boss in practice, for screenshots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlaster } from '@/lib/useBlaster';
import { cleanHandle } from '@/lib/identity';
import { cachedProof } from '@/lib/xproof';
import { minigun, sfx, unlockAudio } from '@/lib/sfx';
import { useOrdnance } from '@/lib/useOrdnance';
import { DR } from '@/lib/dr/tokens';
import { STOCK_IDS, buildWeapons, type RangeWeapon } from '@/lib/bsvgun/weapons';
import { GalleryEngine, type Hooks, type Quality, type Stats } from '@/lib/galleryGame/engine';
import {
  AMMO_SUGGESTIONS,
  DEFAULT_AMMO,
  PACKS,
  PLATFORM_FEE,
  PRIZE,
  chainHandle,
  cleanAmmo,
  fmtBsv,
  fmtUsd,
  freeForStressTest,
  galleryPushes,
  inEvent,
  patternLabel,
  platformFeeAt,
  quote,
  shotSats,
  txPattern,
  usdOf,
  type BoardRow,
} from '@/lib/gallery';
import { WalletChooser } from '../WalletChooser';
import { GameAudio } from '../SoundToggle';
import { HazardBar, Sticker } from '../dr';
import { drFontClass } from '../dr/fonts';
import { IdentityPicker, useMyHandle } from '../PlayerBadge';
import { PrizeBanner } from './PrizeBanner';

const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU'; // bCorp's receiving address (public, not a key)
const FALLBACK_USD = 17.4;
const PREFS = 'tb:gallery-prefs';
const BEFORE_EVENT = Date.parse('2026-10-24T00:00:00Z'); // first render, before the clock is read

type Mode = 'practice' | 'live';
type Run = { sent: number; started: number; last: string | null; tps: number; status: string | null };

const BLASTERS = ['minigun', 'plasmarifle', 'quadplasma'];

/** A pretend chain for practice / dry run: ramps to the weapon's stream rate while the trigger is held. */
type Sim = { on: boolean; rate: number; target: number; carry: number };
function simTick(s: Sim, dt: number) {
  s.rate += ((s.on ? s.target : 0) - s.rate) * Math.min(1, dt * (s.on ? 2.5 : 8));
  s.carry += s.rate * dt * (0.85 + Math.random() * 0.3);
  const n = Math.floor(s.carry);
  s.carry -= n;
  return n;
}
const fakeTxid = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

export function ShootingGallery() {
  const b = useBlaster();
  const { storm, fireBatch } = b;
  const handle = chainHandle(cleanHandle(useMyHandle()));
  const weapons = useMemo(() => {
    // A short rack of heavy hitters built to stream millions of rounds (owner, 24 Oct).
    const all = buildWeapons();
    return BLASTERS.map((id) => all.find((w) => w.id === id)).filter((w): w is RangeWeapon => !!w);
  }, []);
  const { owned } = useOrdnance(b.wallet);
  const [dry, setDry] = useState(false);
  const [autofire, setAutofire] = useState(false);
  const [mode, setMode] = useState<Mode>('practice');
  const [weaponId, setWeaponId] = useState('minigun');
  const [ammoText, setAmmoText] = useState(DEFAULT_AMMO);
  const ammo = cleanAmmo(ammoText);
  const [loadout, setLoadout] = useState(true);
  const [pack, setPack] = useState<number>(PACKS[0]);
  const [bsvUsd, setBsvUsd] = useState(FALLBACK_USD);
  const [locked, setLocked] = useState(false);
  const [run, setRun] = useState<Run>({ sent: 0, started: 0, last: null, tps: 0, status: null });
  const [bought, setBought] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [hud, setHud] = useState<Stats | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardWin, setBoardWin] = useState<'event' | '24h'>('event');
  const [firing, setFiring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const engine = useRef<GalleryEngine | null>(null);
  const simRef = useRef<Sim>({ on: false, rate: 0, target: 1500, carry: 0 });
  const stop = useRef(false);
  const held = useRef(false);
  const sentRef = useRef(0);
  const lastAccept = useRef(0);
  const burstBusy = useRef(false);
  const chainN = useRef(1);
  const [sid] = useState(() => Math.random().toString(36).slice(2, 10));
  const live = mode === 'live';
  const simulated = !live || dry;
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];
  const pattern = txPattern(weapon);
  const unlocked = useMemo(() => new Set([...STOCK_IDS, ...owned]), [owned]);
  // Practice and dry runs let you try any gun; LIVE fires the stock guns plus the 1Sat Ordnance you own.
  const canUse = (w: RangeWeapon) => simulated || unlocked.has(w.id);
  const clock = now || BEFORE_EVENT;
  const fee = platformFeeAt(clock);
  const free = freeForStressTest(clock);
  const ammoLen = (ammo ?? DEFAULT_AMMO).length;
  const perShot = shotSats(handle?.length ?? 0, ammoLen);
  const q = quote(pack, handle?.length ?? 0, fee, ammoLen);
  const packLeft = Math.max(0, bought - run.sent);

  // ── Prefs, query flags, price, clock ──
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    let p: { w?: string; a?: string } = {};
    try {
      p = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
    } catch {
      /* storage blocked */
    }
    void Promise.resolve().then(() => {
      setDry(qs.get('dryrun') === '1');
      setNow(Date.now());
      if (p.w) setWeaponId(p.w);
      if (p.a && cleanAmmo(p.a)) setAmmoText(p.a);
      if (qs.get('autofire') === '1') {
        setAutofire(true);
        setLoadout(false);
      }
      if (qs.get('loadout') === '0') setLoadout(false);
      if (qs.get('mode') === 'live') setMode('live');
    });
    fetch('/api/price')
      .then((r) => r.json())
      .then((j: { bsvUsd?: number }) => j.bsvUsd && setBsvUsd(j.bsvUsd))
      .catch(() => undefined);
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ w: weaponId, a: ammo ?? DEFAULT_AMMO }));
    } catch {
      /* fine */
    }
  }, [weaponId, ammo]);

  // ── Hooks the engine calls (refs, so the engine never needs re-creating) ──
  const pullRef = useRef<(w: RangeWeapon) => boolean>(() => false);
  const triggerRef = useRef<(down: boolean) => void>(() => undefined);
  const hooks = useRef<Hooks>({
    pull: (w) => pullRef.current(w),
    flowing: () => (simRef.current.on ? simRef.current.rate > 20 : performance.now() - lastAccept.current < 700),
    stats: (s) => setHud(s),
    trigger: (d) => triggerRef.current(d),
  });

  // ── Engine ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const phone = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency ?? 8) <= 4;
    const quality: Quality = new URLSearchParams(location.search).get('q') === 'low' || phone ? 'low' : 'high';
    const eng = new GalleryEngine(cv, hooks, { quality, weapons, bossBase: 20_000 });
    engine.current = eng;
    let alive = true;
    void eng.init((p) => alive && setProgress(p)).then(() => alive && setReady(true));
    let raf = 0;
    const tick = () => {
      const r = reticle.current;
      if (r && engine.current) {
        const p = engine.current.reticle();
        r.style.transform = `translate(${p.x - 22}px, ${p.y - 22}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      eng.dispose();
      engine.current = null;
    };
  }, [weapons]);
  useEffect(() => {
    if (ready) void engine.current?.setWeapon(weaponId);
  }, [ready, weaponId]);
  useEffect(() => {
    engine.current?.setBossBase(live ? Math.min(100_000, Math.max(20_000, Math.round(pack / 8))) : 20_000);
  }, [live, pack, ready]);
  useEffect(() => {
    const e = engine.current;
    if (!e || !ready || !autofire) return;
    e.autoAim = true;
    e.setTrigger(true);
  }, [ready, autofire]);

  // ── Accepted (or simulated) transactions land ──
  const landed = useCallback((n: number, txid: string | null) => {
    if (n <= 0) return;
    engine.current?.accept(n);
    sentRef.current += n;
    lastAccept.current = performance.now();
    setRun((r) => ({ ...r, sent: sentRef.current, last: txid ?? r.last, started: r.started || Date.now() }));
  }, []);
  useEffect(() => {
    if (!simulated) return;
    let last = performance.now();
    const i = setInterval(() => {
      const t = performance.now();
      const s = simRef.current;
      let n = simTick(s, (t - last) / 1000);
      last = t;
      if (live && dry) {
        n = Math.max(0, Math.min(n, bought - sentRef.current));
        if (sentRef.current >= bought) s.on = false;
      }
      if (n) landed(n, fakeTxid());
      const tps = Math.round(s.rate);
      setRun((r) => (r.tps === tps ? r : { ...r, tps }));
    }, 50);
    return () => clearInterval(i);
  }, [simulated, live, dry, bought, landed]);

  // ── Practice and live keep separate counters ──
  const saved = useRef({ practice: 0, live: 0 });
  const prevMode = useRef<Mode>(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    saved.current[prevMode.current] = sentRef.current;
    prevMode.current = mode;
    sentRef.current = saved.current[mode];
    simRef.current.on = false;
    setRun({ sent: sentRef.current, started: 0, last: null, tps: 0, status: null });
  }, [mode]);

  // ── LIVE stream: the storm ──
  const streamRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
  streamRef.current = async () => {
    const left = bought - sentRef.current;
    if (firing || left <= 0 || !ammo) return;
    setErr(null);
    stop.current = false;
    setFiring(true);
    const startSent = sentRef.current;
    const t0 = performance.now();
    setRun((r) => ({ ...r, started: r.started || Date.now(), status: 'Spinning up: splitting your gun into lanes…' }));
    try {
      let prev = 0;
      await storm(
        left,
        (n, last) => {
          const d = n - prev;
          prev = n;
          engine.current?.accept(d);
          lastAccept.current = performance.now();
          sentRef.current = startSent + n;
          setRun((r) => ({ ...r, sent: sentRef.current, last: last ?? r.last, tps: Math.round(n / Math.max(1, (performance.now() - t0) / 1000)) }));
        },
        () => stop.current || !held.current,
        (status) => setRun((r) => ({ ...r, status })),
        { game: 'gallery', extra: galleryPushes(handle).slice(1) },
        perShot,
        ammo,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      sfx('rekt');
    } finally {
      setRun((r) => ({ ...r, status: null, tps: 0 }));
      setFiring(false);
    }
  };
  });

  // ── Trigger + bursts ──
  useEffect(() => {
    triggerRef.current = (down: boolean) => {
      held.current = down;
      if (!down) {
        simRef.current.on = false;
        return;
      }
      unlockAudio();
      if (loadout || pattern.kind !== 'stream') return;
      if (simulated) {
        if (live && dry && sentRef.current >= bought) return;
        simRef.current.target = pattern.rate;
        simRef.current.on = true;
      } else void streamRef.current();
    };
    pullRef.current = (w: RangeWeapon) => {
      if (loadout) return false;
      const p = txPattern(w);
      if (p.kind !== 'burst') return false;
      if (simulated) {
        if (live && dry && sentRef.current + p.n > bought) return false;
        setTimeout(() => landed(p.n, fakeTxid()), 70);
        return true;
      }
      if (burstBusy.current || bought - sentRef.current < p.n || !ammo) return false;
      burstBusy.current = true;
      const extras = Array.from({ length: p.n }, () => galleryPushes(handle));
      fireBatch(chainN.current, extras, undefined, ammo)
        .then((txids) => {
          chainN.current += txids.length;
          landed(txids.length, txids[txids.length - 1] ?? null);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => (burstBusy.current = false));
      return true;
    };
  }, [loadout, pattern, simulated, live, dry, bought, landed, ammo, handle, fireBatch]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (locked) e.setTrigger(true);
    else if (!autofire) e.setTrigger(false);
  }, [locked, autofire]);
  useEffect(() => {
    if (loadout) engine.current?.setTrigger(false);
  }, [loadout]);

  // Leaving the page or hiding the tab: stop at once. What is left stays in the player's own gun.
  useEffect(() => {
    const kill = () => {
      stop.current = true;
      held.current = false;
      simRef.current.on = false;
      engine.current?.setTrigger(false);
      minigun(false);
    };
    const vis = () => document.visibilityState === 'hidden' && kill();
    const warn = (e: BeforeUnloadEvent) => {
      if (firing) e.preventDefault();
    };
    window.addEventListener('pagehide', kill);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', kill);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeunload', warn);
    };
  }, [firing]);
  useEffect(
    () => () => {
      stop.current = true;
      minigun(false);
    },
    [],
  );

  // ── Board ──
  const loadBoard = useCallback(() => {
    fetch(`/api/gallery/board?window=${boardWin}`)
      .then((r) => r.json())
      .then((j: { rows?: BoardRow[] }) => setBoard(j.rows ?? []))
      .catch(() => undefined);
  }, [boardWin]);
  useEffect(() => {
    void Promise.resolve().then(loadBoard);
    const i = setInterval(loadBoard, 15_000);
    return () => clearInterval(i);
  }, [loadBoard]);

  /** Report this session's accepted shots (LIVE, named, real chain only); verified on chain by the last txid. */
  const lastReport = useRef(0);
  const reportRef = useRef<(force: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => {
  reportRef.current = async (force: boolean) => {
      if (!live || dry || !handle || !run.last || !sentRef.current) return;
      if (!force && Date.now() - lastReport.current < 60_000) return;
      lastReport.current = Date.now();
      const secs = Math.round((Date.now() - run.started) / 100) / 10;
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: 'gallery',
          mode: 'live',
          name: handle,
          score: sentRef.current,
          secs,
          meta: { sid, w: weaponId, a: (ammo ?? DEFAULT_AMMO).slice(0, 32) },
          txid: run.last,
          x: handle,
          xp: cachedProof(handle) ?? undefined,
        }),
      }).catch(() => undefined);
      loadBoard();
  };
  });
  useEffect(() => {
    if (live && !dry && run.sent) void reportRef.current(!firing);
  }, [live, dry, run.sent, firing]);

  // ── Buy a pack ──
  const buy = async () => {
    setErr(null);
    if (dry) {
      setBought((p) => Math.max(p, sentRef.current) + pack);
      sfx('coin');
      return;
    }
    if (!b.wallet) return b.connectWallet();
    const need = Math.max(0, q.total - b.ammo);
    if (need > 0) {
      const ok = await b.load(need, `Shooting Gallery: ${pack.toLocaleString()} shots`);
      if (!ok) return;
    }
    if (q.fee > 0) {
      try {
        await b.fireBatch(0, [['gallery', 'fee']], { address: HOUSE, sats: q.fee }, ammo ?? DEFAULT_AMMO);
      } catch (e) {
        setErr(`Platform fee did not go through: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setBought((p) => Math.max(p, sentRef.current) + pack);
    sfx('coin');
  };

  const spent = simulated ? 0 : run.sent * perShot;
  const bossPct = hud ? (hud.bossHp / Math.max(1, hud.bossMax)) * 100 : 100;
  const names = useMemo(() => new Map(weapons.map((w) => [w.id, w.name])), [weapons]);

  return (
    <div className={`game-root flex flex-col gap-3 ${drFontClass}`}>
      <GameAudio track="arena" />
      <section className="game-stage panel relative overflow-hidden p-0" style={{ background: '#05060c' }}>
        <canvas ref={canvas} className="block h-full min-h-[420px] w-full touch-none select-none" style={{ cursor: 'none' }} aria-label="Shooting Gallery: hold to fire" />
        <div ref={reticle} className="pointer-events-none absolute left-0 top-0 h-11 w-11" aria-hidden>
          <svg viewBox="0 0 44 44" className="h-full w-full" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,.9))' }}>
            <circle cx="22" cy="22" r="13" fill="none" stroke={DR.colour.amber} strokeWidth="2" />
            <path d="M22 2v10M22 32v10M2 22h10M32 22h10" stroke={DR.colour.amber} strokeWidth="2" />
            <circle cx="22" cy="22" r="1.6" fill={DR.colour.signal} />
          </svg>
        </div>
        {!ready && (
          <div className="absolute inset-0 grid place-items-center bg-black/80">
            <div className="w-64 text-center font-mono text-xs text-dim">
              <p className="mb-2 tracking-widest">LOADING THE NIGHT SHIFT…</p>
              <div className="h-2 border border-[var(--border)]">
                <div className="h-full" style={{ width: `${Math.round(progress * 100)}%`, background: DR.colour.signal }} />
              </div>
            </div>
          </div>
        )}

        {/* HUD */}
        {!loadout && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-2 sm:p-3">
            <div className="bg-black/65 px-2 py-1 font-mono">
              <div className="text-[10px] tracking-widest text-dim">{live ? (dry ? 'LIVE · DRY RUN' : 'LIVE · ON CHAIN') : 'FREE PRACTICE · SIMULATED'}</div>
              <div className="text-[clamp(26px,5vw,48px)] font-bold leading-none tabular-nums" style={{ color: DR.colour.amber }}>
                {run.sent.toLocaleString()}
              </div>
              <div className="text-[10px] text-dim">{live && !dry ? 'transactions accepted by ARC' : 'simulated transactions'}</div>
              <div className="mt-1 text-[10px]">
                <span style={{ color: DR.colour.cyan }}>{weapon.name.toUpperCase()}</span>
                <span className="text-dim"> · ammo </span>
                <span style={{ color: DR.colour.amber }}>{ammo ?? DEFAULT_AMMO}</span>
              </div>
            </div>
            <div className="order-last w-full bg-black/65 px-2 py-1 sm:order-none sm:w-auto sm:min-w-[300px] sm:max-w-[440px] sm:flex-1">
              <div className="flex justify-between font-mono text-[10px] tracking-widest">
                <span style={{ color: '#ff5a4a' }}>LIQUID UNIT · WAVE {hud?.wave ?? 1}</span>
                <span className="text-dim">{hud ? `${hud.bossHp.toLocaleString()} / ${hud.bossMax.toLocaleString()}` : ''}</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden border border-[#cfd8e3]/40 bg-black">
                <div className="h-full bg-gradient-to-r from-[#8a96a8] via-[#f4f8ff] to-[#8a96a8]" style={{ width: `${bossPct}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-dim">Reforms the moment you let up. Keep firing.</div>
            </div>
            <div className="bg-black/65 px-2 py-1 text-right font-mono text-[11px] leading-tight">
              <div>
                <span className="text-dim">tx/s </span>
                <span className="tabular-nums" style={{ color: DR.colour.cyan }}>
                  {run.tps.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-dim">spent </span>
                <span className="tabular-nums">{simulated ? '$0.00' : fmtUsd(usdOf(spent, bsvUsd))}</span>
                <span className="text-dim"> · {spent.toLocaleString()} sat</span>
              </div>
              <div>
                <span className="text-dim">score </span>
                <span className="tabular-nums">{(hud?.score ?? 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-dim">glass </span>
                <span className="tabular-nums">{hud ? `${hud.windows - hud.windowsLeft}/${hud.windows}` : '0'}</span>
                <span className="text-dim"> · racks </span>
                <span className="tabular-nums">{hud ? 8 - hud.racksLeft : 0}/8</span>
              </div>
              {live && (
                <div>
                  <span className="text-dim">pack left </span>
                  <span className="tabular-nums">{packLeft.toLocaleString()}</span>
                </div>
              )}
              {handle && <div style={{ color: DR.colour.cyan }}>@{handle}</div>}
            </div>
          </div>
        )}
        {!loadout && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2 sm:p-3">
            <div className="max-w-[60%] bg-black/65 px-2 py-1 font-mono text-[11px] text-dim">
              {run.status ?? (live && packLeft <= 0 ? 'Buy a pack below to fire for real.' : `${patternLabel(pattern)} · HOLD to fire (or SPACE).`)}
            </div>
            <div className="pointer-events-auto mb-12 flex gap-2">
              <button type="button" onClick={() => setLoadout(true)} className="btn px-3 py-2 text-xs">
                LOADOUT
              </button>
              {pattern.kind === 'stream' && (
                <button type="button" onClick={() => setLocked((v) => !v)} className={`btn px-3 py-2 text-xs ${locked ? 'btn-on' : ''}`} title="Keep the trigger down without holding">
                  {locked ? 'LOCKED' : 'LOCK TRIGGER'}
                </button>
              )}
              {firing && (
                <button type="button" onClick={() => ((stop.current = true), setLocked(false), engine.current?.setTrigger(false))} className="btn-fire px-3 py-2 text-xs">
                  STOP
                </button>
              )}
            </div>
          </div>
        )}

        {/* LOADOUT */}
        {loadout && (
          <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-black/80 via-black/55 to-black/80" style={{ fontFamily: DR.font.mono }}>
            <HazardBar h={10} />
            <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-3 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] tracking-[0.3em] text-dim">TB-GALLERY / OMNICORE DYNAMICS / NIGHT SHIFT</p>
                  <h2 className="text-[clamp(34px,6vw,64px)] font-black uppercase italic leading-[0.9]" style={{ fontFamily: DR.font.display, color: DR.colour.paper }}>
                    Loadout
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setMode('practice')} disabled={firing} className={`btn px-3 py-1.5 ${!live ? 'btn-on' : ''}`}>
                    FREE PRACTICE
                  </button>
                  <button onClick={() => setMode('live')} disabled={firing} className={`btn px-3 py-1.5 ${live ? 'btn-on' : ''}`}>
                    LIVE {dry ? '(DRY RUN)' : '(ON CHAIN)'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {weapons.map((w) => {
                  const p = txPattern(w);
                  const ok = canUse(w);
                  const on = w.id === weaponId;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => ok && setWeaponId(w.id)}
                      disabled={!ok}
                      className="relative flex flex-col gap-1 border-2 p-2 text-left transition disabled:opacity-40"
                      style={{ borderColor: on ? DR.colour.signal : 'rgba(255,255,255,.18)', background: on ? 'rgba(232,38,29,.22)' : 'rgba(10,10,12,.72)', boxShadow: on ? '0 0 18px rgba(232,38,29,.45)' : undefined }}
                    >
                      {w.id === 'minigun' && (
                        <span className="absolute right-1 top-1">
                          <Sticker size={10}>DEFAULT</Sticker>
                        </span>
                      )}
                      <span className="pr-14 text-[clamp(16px,2vw,22px)] font-black uppercase italic leading-none" style={{ fontFamily: DR.font.display, color: on ? DR.colour.paper : '#d9d6cc' }}>
                        {w.name}
                      </span>
                      <span className="text-[10px]" style={{ color: p.kind === 'stream' ? DR.colour.cyan : DR.colour.amber }}>
                        {patternLabel(p)}
                      </span>
                      {(['rate', 'spread', 'power'] as const).map((k) => (
                        <span key={k} className="flex items-center gap-1 text-[9px] text-dim">
                          <span className="w-10 uppercase">{k}</span>
                          <span className="h-1.5 flex-1 bg-white/10">
                            <span className="block h-full" style={{ width: `${Math.round(w.bars[k] * 100)}%`, background: on ? DR.colour.signal : DR.colour.amber }} />
                          </span>
                        </span>
                      ))}
                      {!ok && <span className="text-[9px]" style={{ color: DR.colour.amber }}>Own the 1Sat Ordnance to fire it LIVE</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2">
                  <span className="text-xs tracking-widest" style={{ color: DR.colour.amber }}>
                    AMMO
                  </span>
                  <input
                    value={ammoText}
                    onChange={(e) => setAmmoText(e.target.value.slice(0, 40))}
                    placeholder="txblaster.com"
                    maxLength={40}
                    spellCheck={false}
                    aria-label="Ammo label (goes on chain)"
                    className="w-52 border-2 bg-black px-2 py-1 text-sm text-white"
                    style={{ borderColor: ammo ? DR.colour.amber : DR.colour.signal }}
                  />
                </label>
                {AMMO_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setAmmoText(s)} className={`btn px-2 py-0.5 text-[11px] ${ammo === s ? 'btn-on' : ''}`}>
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-dim">
                {ammo ? (
                  <>
                    Every round carries <span style={{ color: DR.colour.amber }}>&quot;{ammo}&quot;</span> on chain as its ammo. Anyone can fire anything. {perShot} sat per shot.
                  </>
                ) : (
                  <span style={{ color: DR.colour.signal }}>Ammo is lower case letters, digits, dots and dashes, 1 to 40 characters.</span>
                )}
              </p>
              <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap items-center gap-3 border-t-2 border-white/15 bg-black/90 px-3 py-2 sm:-mx-5 sm:px-5">
                <button
                  type="button"
                  disabled={!ready || !ammo || !canUse(weapon)}
                  onClick={() => {
                    unlockAudio();
                    setLoadout(false);
                  }}
                  className="px-7 py-2.5 text-2xl font-black uppercase italic tracking-widest disabled:opacity-40"
                  style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}`, boxShadow: '0 0 24px rgba(232,38,29,.55)' }}
                >
                  {ready ? 'Lock and load' : 'Loading…'}
                </button>
                <span className="text-xs text-dim">
                  {live ? (dry ? 'Dry run: nothing is broadcast, nothing is spent.' : 'LIVE: buy a pack below, then every round is a real transaction.') : 'Practice is simulated and free.'}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      <PrizeBanner />

      {live && (
        <section className="panel">
          <div className="panel-header">
            <span className="panel-title">Session pack</span>
            <span className="text-dim">
              {perShot} sat/shot network fee ·{' '}
              {free ? <span style={{ color: DR.colour.acid }}>Free for the stress test: no platform fee until 1 Nov</span> : `${Math.round(fee * 100)}% platform fee`} · BSV ${bsvUsd.toFixed(2)}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {PACKS.map((n) => {
              const qq = quote(n, handle?.length ?? 0, fee, ammoLen);
              return (
                <button key={n} onClick={() => setPack(n)} disabled={firing} className={`btn flex flex-col items-start px-4 py-3 text-left ${pack === n ? 'btn-on' : ''}`}>
                  <span className="text-2xl font-bold">{fmtUsd(usdOf(qq.total, bsvUsd))}</span>
                  <span className="text-sm">{n.toLocaleString()} shots</span>
                  <span className="text-[11px] text-dim">
                    {fmtBsv(qq.total)} · {qq.total.toLocaleString()} sat
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-dim">
            {pack.toLocaleString()} shots: network {fmtUsd(usdOf(q.network, bsvUsd))}
            {free ? ', no platform fee for the stress test' : ` + platform fee ${fmtUsd(usdOf(q.fee, bsvUsd))}`} = <span className="text-hot">{fmtUsd(usdOf(q.total, bsvUsd))}</span>. The pack
            is a hard cap. Unspent sats stay in your own gun and UNLOAD sends them back to your wallet.
            {free && PLATFORM_FEE > 0 ? ` From 1 Nov a ${Math.round(PLATFORM_FEE * 100)}% platform fee applies.` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!dry && !b.wallet ? (
              <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire px-5 py-2">
                {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT bWalletX'}
              </button>
            ) : (
              <button onClick={buy} disabled={!!b.busy || firing || !ammo} className="btn-fire px-5 py-2">
                {b.busy === 'loading' ? 'APPROVE IN WALLET…' : `BUY ${pack.toLocaleString()} SHOTS · ${fmtUsd(usdOf(q.total, bsvUsd))}`}
              </button>
            )}
            {!dry && b.wallet && b.ammo > 0 && !firing && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn px-4 py-2">
                UNLOAD (refund {fmtUsd(usdOf(b.ammo, bsvUsd))})
              </button>
            )}
            <span className="text-sm text-dim">
              Paid shots ready: <span className="text-hot">{packLeft.toLocaleString()}</span>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-dim">Your name on bsv.lol and the board:</span>
            <IdentityPicker compact />
            {!handle && <span className="text-xs text-muted">No handle: shots go out anonymous and are not ranked.</span>}
          </div>
          {(err || b.error) && <p className="mt-2 text-sm text-hot">⚠ {err ?? b.error}</p>}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">See them land</span>
          <span className="text-dim">{simulated ? 'simulated txids are not on chain' : 'live'}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            Watch on bsv.lol ↗
          </a>
          {run.last && !simulated && (
            <a href={`https://whatsonchain.com/tx/${run.last}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              latest shot {run.last.slice(0, 12)}… ↗
            </a>
          )}
          {run.last && simulated && <span className="font-mono text-xs text-muted">sim {run.last.slice(0, 16)}…</span>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Top blasters</span>
          <div className="flex gap-1">
            {(['event', '24h'] as const).map((w) => (
              <button key={w} onClick={() => setBoardWin(w)} className={`btn px-2 py-0.5 text-xs ${boardWin === w ? 'btn-on' : ''}`}>
                {w === 'event' ? '31 OCT EVENT' : '24H'}
              </button>
            ))}
          </div>
        </div>
        <GalleryBoard rows={board} me={handle} mine={live && !dry ? run.sent : 0} myWeapon={weaponId} myAmmo={ammo ?? DEFAULT_AMMO} names={names} />
        <p className="mt-2 text-xs text-muted">
          Accepted LIVE shots carrying your handle, checked on chain by the tokenblaster.lol &quot;gallery&quot; tag.{' '}
          {inEvent(clock) ? 'The event is on now.' : `Event: ${new Date(PRIZE.start).toUTCString().slice(0, 16)} (UTC).`}
        </p>
      </section>
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </div>
  );
}

export function GalleryBoard({
  rows,
  me,
  mine = 0,
  myWeapon,
  myAmmo,
  names,
}: {
  rows: BoardRow[];
  me?: string | null;
  mine?: number;
  myWeapon?: string;
  myAmmo?: string;
  names?: Map<string, string>;
}) {
  // This session's live count, merged in so the player sees themselves climb before the next report lands.
  const list = [...rows];
  if (me && mine) {
    const i = list.findIndex((r) => r.handle === me);
    if (i >= 0) list[i] = { ...list[i], shots: Math.max(list[i].shots, mine) };
    else list.push({ handle: me, shots: mine, sessions: 1, weapon: myWeapon, ammo: myAmmo });
    list.sort((a, b) => b.shots - a.shots);
  }
  if (!list.length) return <p className="text-sm text-dim">No ranked shots yet. Be the first name on the board.</p>;
  return (
    <ol className="flex flex-col gap-1 font-mono text-sm">
      {list.slice(0, 10).map((r, i) => (
        <li key={r.handle} className={`flex flex-wrap justify-between gap-x-2 border-b border-[var(--border)] py-0.5 ${r.handle === me ? 'text-accent' : ''}`}>
          <span>
            <span className="text-dim">{String(i + 1).padStart(2, '0')}</span> @{r.handle}
            {r.weapon && <span className="text-xs text-dim"> · {names?.get(r.weapon) ?? r.weapon}</span>}
            {r.ammo && (
              <span className="text-xs" style={{ color: DR.colour.amber }}>
                {' '}
                · {r.ammo}
              </span>
            )}
          </span>
          <span className="tabular-nums">{r.shots.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
