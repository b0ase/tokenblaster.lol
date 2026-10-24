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
 * broadcasts. No refunds: unused credit stays in the gun for later plays. Free for the stress test (network cost only) until 31 Oct UTC;
 * the platform fee starts automatically on 1 Nov (src/lib/gallery.ts FEE_FROM).
 *
 * COIN-OP (owner, 24 Oct 2026): no free practice. The loadout is the cabinet (src/components/coinop): coins add
 * to a total, PAY is one wallet approval that funds the gun, then NAME and LOCK & LOAD. The credit is the
 * ammunition: each shot draws it down at network cost (+ the platform fee from 1 Nov, paid to the house when
 * the rounds are locked). Dev only: `?dryrun=1` simulates everything (no wallet, no broadcast); not linked in the UI.
 * `?autofire=1` (with ?dryrun=1) holds the trigger on the boss, for screenshots.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getBarWallet, subBarWallet } from '@/lib/walletBar';
import { useBlaster } from '@/lib/useBlaster';
import { cachedProof } from '@/lib/xproof';
import { minigun, sfx, unlockAudio } from '@/lib/sfx';
import { useOrdnance } from '@/lib/useOrdnance';
import { STOCK_IDS, buildWeapons, type RangeWeapon } from '@/lib/bsvgun/weapons';
import { GalleryEngine, type Hooks, type Quality, type Stats } from '@/lib/galleryGame/engine';
import {
  DEFAULT_AMMO,
  overheadSats,
  roundsFor,
  PRIZE,
  ammoFromPaymail,
  fmtUsd,
  freeForStressTest,
  galleryPushes,
  inEvent,
  patternLabel,
  platformFeeAt,
  shotSats,
  txPattern,
  usdOf,
  type BoardRow,
} from '@/lib/gallery';
import { WalletChooser } from '../WalletChooser';
import { GameAudio } from '../SoundToggle';
import { drFontClass } from '../dr/fonts';
import { tbxFontClass } from '../coinop/fonts';
import { Icon, Modal, Ticker } from '../coinop/ui';
import { IdentityPicker } from '../PlayerBadge';
import { PrizeBanner } from './PrizeBanner';
import { AmmoColumn } from './AmmoColumn';
import { OnChainPanel, type FeedRow } from './OnChainPanel';
import { LoadingScreen, type LoadState } from '../coinop/LoadingScreen';
import { CHARACTERS, GAME_KICKER, GAME_TITLE, LORE, LOADING_SHOTS, SETTING, TIPS } from '@/lib/gallery/story';
import { Hud, HudControls } from './Hud';
import { BannerStage, useBanners } from './Banners';
import { Loadout } from './Loadout';
import { Results, type RunSummary } from './Results';
import { CabinetModals, CoinCabinet } from '../coinop/CoinCabinet';

import { loadMark } from '@/lib/gun';
import { leftoverNote, planLoad, roundsFrom, safeNote } from '@/lib/coinop/ammo';
import { useCabinet } from '../coinop/useCabinet';
import { cleanName, fmtCredit, satsToUsd, usdToSats } from '@/lib/coinop/credit';

const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU'; // bCorp's receiving address (public, not a key)
const FALLBACK_USD = 17.4;
const PREFS = 'tb:gallery-prefs';
const BEFORE_EVENT = Date.parse('2026-10-24T00:00:00Z'); // first render, before the clock is read

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
  const [name, setName] = useState('');
  // The NAME typed at the cabinet is the on-chain handle tag and the board name.
  const handle = cleanName(name);
  const weapons = useMemo(() => {
    // A short rack of heavy hitters built to stream millions of rounds (owner, 24 Oct).
    const all = buildWeapons();
    return BLASTERS.map((id) => all.find((w) => w.id === id)).filter((w): w is RangeWeapon => !!w);
  }, []);
  const { owned } = useOrdnance(b.wallet);
  const [dry, setDry] = useState(false);
  const [autofire, setAutofire] = useState(false);
  const [weaponId, setWeaponId] = useState('minigun');
  // Rounds carry the player's paymail once a wallet pays; practice fires plain sats.
  // The paymail from bWallet's lookup for this identity key (else plain DEFAULT_AMMO).
  const barWallet = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  const paymail = b.wallet && barWallet?.publicKey === b.wallet.publicKey ? ammoFromPaymail(barWallet) : null;
  const ammo = paymail ?? DEFAULT_AMMO;
  const [loadout, setLoadout] = useState(true);
  const [bsvUsd, setBsvUsd] = useState(FALLBACK_USD);
  const [locked, setLocked] = useState(false);
  const [run, setRun] = useState<Run>({ sent: 0, started: 0, last: null, tps: 0, status: null });
  const [bought, setBought] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const { cur: bannerCur, push: pushBanner, clear: clearBanners } = useBanners();
  const [hud, setHud] = useState<Stats | null>(null);
  const hudWave = useRef(1);
  const waveSeen = useRef(1);
  const [over, setOver] = useState<RunSummary | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardWin, setBoardWin] = useState<'event' | '24h'>('event');
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
  const chainN = useRef(1);
  const [sid] = useState(() => Math.random().toString(36).slice(2, 10));
  const live = true; // coin-op: every round is paid
  const simulated = dry;
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];
  const pattern = txPattern(weapon);
  const unlocked = useMemo(() => new Set([...STOCK_IDS, ...owned]), [owned]);
  // Dry runs let you try any gun; LIVE fires the stock guns plus the 1Sat Ordnance you own.
  const canUse = (w: RangeWeapon) => simulated || unlocked.has(w.id);
  const clock = now || BEFORE_EVENT;
  const fee = platformFeeAt(clock);
  const free = freeForStressTest(clock);
  const ammoLen = (ammo ?? DEFAULT_AMMO).length;
  const perShot = shotSats(handle?.length ?? 0, ammoLen);
  const cab = useCabinet(b, 'Shooting Gallery', { dry });
  const [locking, setLocking] = useState(false);
  const [loadedRounds, setLoadedRounds] = useState(0);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [load, setLoad] = useState<LoadState | null>(null);

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
      if (qs.get('autofire') === '1') {
        setAutofire(true);
        setLoadout(false);
      }
      if (qs.get('loadout') === '0') setLoadout(false);
    });
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    if (cab.bsvUsd) void Promise.resolve().then(() => setBsvUsd(cab.bsvUsd!));
  }, [cab.bsvUsd]);
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
    engine.current?.setBossBase(Math.min(100_000, Math.max(20_000, Math.round(bought / 8))));
  }, [bought, ready]);
  useEffect(() => {
    const e = engine.current;
    if (!e || !ready || !autofire) return;
    e.autoAim = true;
    e.setTrigger(true);
  }, [ready, autofire]);

  // ── The gun and the sender are decoupled (owner, 24 Oct 2026: "the gun ALWAYS fires") ──
  // The trigger drives the visual fire at the weapon's rate: each visual round takes one loaded round and joins
  // the send queue (fired − sent). A background sender drains the queue into real transactions as fast as the
  // network takes them, and keeps draining with the trigger up. Nothing on the network can stop the gun.
  // WARM-UP: while a paid load is in progress the same gun fires simulated rounds (nothing sent, not scored).
  const firedRef = useRef(0);
  const [fired, setFired] = useState(0);
  const modeRef = useRef<'off' | 'warm' | 'live'>('off');
  const [mode, setModeState] = useState<'off' | 'warm' | 'live'>('off');
  const setMode = useCallback((m: 'off' | 'warm' | 'live') => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const boughtRef = useRef(0);
  useEffect(() => {
    boughtRef.current = bought;
  }, [bought]);
  const lastSent = useRef(0);
  const sendErrors = useRef(0);
  const [jammed, setJammed] = useState(false);
  const [queueNote, setQueueNote] = useState(false);

  const landed = useCallback(
    (n: number, txid: string | null) => {
      if (n <= 0) return;
      sentRef.current += n;
      // A sender round can run a few rounds ahead of the trigger: those count as fired too.
      if (sentRef.current > firedRef.current) firedRef.current = sentRef.current;
      lastAccept.current = lastSent.current = performance.now();
      setRun((r) => ({ ...r, sent: sentRef.current, last: txid ?? r.last, started: r.started || Date.now() }));
    },
    [setRun],
  );

  // Visual fire: the stream ticker.
  useEffect(() => {
    let last = performance.now();
    const i = setInterval(() => {
      const t = performance.now();
      const s = simRef.current;
      const m = modeRef.current;
      const left = boughtRef.current - firedRef.current;
      s.on = held.current && !loadout && pattern.kind === 'stream' && (m === 'warm' || (m === 'live' && left > 0));
      s.target = pattern.kind === 'stream' ? pattern.rate : 0;
      let n = simTick(s, (t - last) / 1000);
      last = t;
      if (m === 'live') {
        n = Math.max(0, Math.min(n, left));
        firedRef.current += n;
      }
      if (n) engine.current?.accept(n);
      if (m === 'live') setFired((f) => (f === firedRef.current ? f : firedRef.current));
      const tps = Math.round(s.rate);
      setRun((r) => (r.tps === tps ? r : { ...r, tps }));
    }, 50);
    return () => clearInterval(i);
  }, [loadout, pattern]);

  // Bursts (shotguns, launchers): every pull fires at once and queues its rounds.
  useEffect(() => {
    triggerRef.current = (down: boolean) => {
      held.current = down;
      if (down) unlockAudio();
    };
    pullRef.current = (w: RangeWeapon) => {
      if (loadout) return false;
      const p = txPattern(w);
      if (p.kind !== 'burst') return false;
      const m = modeRef.current;
      if (m === 'warm') {
        engine.current?.accept(p.n);
        return true;
      }
      if (m !== 'live' || boughtRef.current - firedRef.current < p.n) return false; // out of rounds
      firedRef.current += p.n;
      setFired(firedRef.current);
      engine.current?.accept(p.n);
      return true;
    };
  }, [loadout]);

  // ── Sender ──
  // Dry run (dev): a fake network with a delay and failures (?sendrate= tx/s, ?sendfail= 0..1 chance a second
  // stalls, ?stallms= stall length), so it can be shown that the gun never stops while sending lags.
  useEffect(() => {
    if (!dry || mode !== 'live') return;
    const qs = new URLSearchParams(location.search);
    const rate = Number(qs.get('sendrate') ?? 600) || 600;
    const failP = Number(qs.get('sendfail') ?? 0.25);
    const stallMs = Number(qs.get('stallms') ?? 2500);
    let stallUntil = 0;
    let lastRoll = 0;
    const i = setInterval(() => {
      const t = performance.now();
      if (t - lastRoll > 1000) {
        lastRoll = t;
        if (Math.random() < failP) {
          stallUntil = t + stallMs;
          sendErrors.current++;
        }
      }
      if (t < stallUntil) return;
      const k = Math.min(firedRef.current - sentRef.current, Math.ceil(rate / 10));
      if (k > 0) landed(k, fakeTxid());
    }, 100);
    return () => clearInterval(i);
  }, [dry, mode, landed]);

  // Live, bursts: drain the queue with batches; failures retry with a backoff and never touch the gun.
  useEffect(() => {
    if (dry || mode !== 'live' || pattern.kind !== 'burst') return;
    let alive = true;
    let backoff = 0;
    void (async () => {
      while (alive) {
        const q = firedRef.current - sentRef.current;
        if (q <= 0) {
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
        try {
          const extras = Array.from({ length: Math.min(25, q) }, () => galleryPushes(handle));
          const txids = await fireBatch(chainN.current, extras, undefined, ammo);
          chainN.current += txids.length;
          landed(txids.length, txids[txids.length - 1] ?? null);
          backoff = 0;
        } catch (e) {
          sendErrors.current++;
          backoff = Math.min(8000, backoff ? backoff * 2 : 500);
          console.warn('[tb-fire] batch failed, retrying', e);
          if (sendErrors.current >= 12) setJammed(true);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [dry, mode, pattern.kind, fireBatch, handle, ammo, landed]);

  // Live, streams: one storm session over the prepared lanes, paused whenever the queue is empty. If it ends
  // with rounds still queued (a network failure), it reloads by itself and carries on; after 3 tries: jammed.
  const sessionAlive = useRef(false);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  const sessionRef = useRef<(rounds: number) => void>(() => undefined);
  const tries = useRef(0);
  /** Each storm session's number: a finished old session never touches the new one's state. */
  const sessionGen = useRef(0);
  useEffect(() => {
    sessionRef.current = (rounds: number) => {
      if (sessionAlive.current || rounds <= 0 || !ammo) {
        console.info(`[tb-fire] session not started: ${sessionAlive.current ? 'previous session still running' : rounds <= 0 ? 'no rounds' : 'no ammo label'}`);
        return;
      }
      const gen = ++sessionGen.current;
      sessionAlive.current = true;
      console.info(`[tb-fire] session ${gen} start: ${rounds} rounds`);
      stop.current = false;
      let prev = 0;
      void storm(
        rounds,
        (n, last) => {
          const d = n - prev;
          prev = n;
          landed(d, last ?? null);
        },
        () => stop.current,
        () => undefined,
        { game: 'gallery', extra: galleryPushes(handle).slice(1) },
        perShot,
        ammo,
        () => sentRef.current >= firedRef.current, // nothing queued: hold, keep the lanes
        5,
      )
        .catch((e) => {
          sendErrors.current++;
          console.warn('[tb-fire] sender stopped', e);
        })
        .finally(() => {
          if (gen !== sessionGen.current) return;
          sessionAlive.current = false;
          console.info(`[tb-fire] session ${gen} ended`);
          const left = boughtRef.current - sentRef.current;
          if (stop.current || left <= 0 || modeRef.current !== 'live') return;
          if (++tries.current > 3) return setJammed(true);
          void reloadRef.current();
        });
    };
  });
  /** RELOAD: re-run the preparation for the rounds not sent yet (no new payment) and start sending again. */
  useEffect(() => {
    reloadRef.current = async () => {
      const left = boughtRef.current - sentRef.current;
      if (left <= 0) return;
      try {
        if (!dry) await b.prepareStorm(left, perShot);
        setJammed(false);
        if (!dry) sessionRef.current(left);
      } catch (e) {
        console.warn('[tb-fire] reload failed', e);
        setJammed(true);
      }
    };
  });

  // Queue note + [tb-fire] timing logs.
  useEffect(() => {
    if (mode !== 'live') return;
    let prevSent = sentRef.current;
    let tLog = performance.now();
    const i = setInterval(() => {
      const t = performance.now();
      const q = firedRef.current - sentRef.current;
      const behind = q > 0 && (q > 1500 || t - lastSent.current > 3000);
      setQueueNote((v) => (v === behind ? v : behind));
      if (t - tLog >= 2000) {
        const rate = Math.round(((sentRef.current - prevSent) * 1000) / (t - tLog));
        console.info(`[tb-fire] queue ${q} · sent/s ${rate} · sent ${sentRef.current} · fired ${firedRef.current} · loaded ${boughtRef.current} · errors ${sendErrors.current}`);
        prevSent = sentRef.current;
        tLog = t;
      }
    }, 500);
    return () => clearInterval(i);
  }, [mode]);

  // While firing: plain notes. The gun itself never waits on these.
  const [stall, setStall] = useState<string | null>(null);
  useEffect(() => {
    const i = setInterval(() => {
      let msg: string | null = null;
      if (held.current && !loadout && modeRef.current === 'live' && boughtRef.current - firedRef.current <= 0) msg = 'Out of rounds. Press LOADOUT and put another coin in.';
      setStall((m) => (m === msg ? m : msg));
    }, 400);
    return () => clearInterval(i);
  }, [loadout]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (locked) e.setTrigger(true);
    else if (!autofire) e.setTrigger(false);
  }, [locked, autofire]);
  useEffect(() => {
    if (loadout) engine.current?.setTrigger(false);
  }, [loadout]);

  // Leaving the page: stop the trigger. Rounds already fired still finish sending while the page is open.
  useEffect(() => {
    const kill = () => {
      held.current = false;
      simRef.current.on = false;
      engine.current?.setTrigger(false);
      minigun(false);
    };
    const vis = () => document.visibilityState === 'hidden' && kill();
    const warn = (e: BeforeUnloadEvent) => {
      if (firedRef.current > sentRef.current) e.preventDefault();
    };
    window.addEventListener('pagehide', kill);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', kill);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
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
  }, [boardWin, setBoard]);
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
  const sending = fired > run.sent;
  useEffect(() => {
    if (live && !dry && run.sent) void reportRef.current(!sending);
  }, [live, dry, run.sent, sending]);

  // A new wave (the Liquid Unit melted and re-formed): banner it, then warn that the boss is coming.
  useEffect(() => {
    const w = hud?.wave ?? 1;
    hudWave.current = w;
    if (mode !== 'live' || w <= waveSeen.current) return;
    waveSeen.current = w;
    pushBanner({ kind: 'wave', n: w });
    pushBanner({ kind: 'boss' });
  }, [hud?.wave, mode, pushBanner]);

  // GAME OVER: out of rounds and everything fired has been sent (or the player pressed RESULTS).
  const finish = useCallback(() => {
    held.current = false;
    simRef.current.on = false;
    engine.current?.setTrigger(false);
    minigun(false);
    setLocked(false);
    clearBanners();
    setOver({
      fired: firedRef.current,
      sent: sentRef.current,
      score: hud?.score ?? 0,
      wave: hud?.wave ?? 1,
      kills: hud?.kills ?? 0,
      secs: run.started ? Math.max(1, Math.round((Date.now() - run.started) / 1000)) : 0,
      spent: dry ? '$0.00' : fmtUsd(usdOf(run.sent * perShot, bsvUsd)),
      last: run.last,
      handle,
      simulated: dry,
    });
    setMode('off');
    boughtRef.current = firedRef.current;
    setBought(firedRef.current);
  }, [hud, run.started, run.sent, run.last, perShot, bsvUsd, dry, handle, setMode, clearBanners, setLocked, setOver, setBought]);
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(() => {
    if (mode !== 'live' || loadedRounds <= 0 || bought - fired > 0 || run.sent < fired) return;
    const t = setTimeout(() => finishRef.current(), 1600);
    return () => clearTimeout(t);
  }, [mode, loadedRounds, bought, fired, run.sent]);

  // ── LOCK & LOAD: turn the loaded credit into rounds (credit is the ammunition) ──
  // After the payment the player drops straight into the street in WARM-UP while the gun loads.
  const perShotAll = perShot * (1 + fee);
  const goLive = useCallback(
    (rounds: number) => {
      setLoadedRounds(rounds);
      setBought(firedRef.current + rounds);
      boughtRef.current = firedRef.current + rounds;
      sentRef.current = firedRef.current; // warm-up rounds were never queued
      setRun((r) => ({ ...r, sent: sentRef.current }));
      setMode('live');
      setLoad(null);
      setOver(null);
      sfx('coin');
      pushBanner({ kind: 'loaded' });
      waveSeen.current = Math.max(1, hudWave.current);
      pushBanner({ kind: 'wave', n: waveSeen.current });
      pushBanner({ kind: 'boss' });
    },
    [setMode, setRun, setLoadedRounds, setBought, setLoad, pushBanner, setOver],
  );
  const lockAndLoad = async () => {
    setErr(null);
    unlockAudio();
    const stream = pattern.kind === 'stream';
    setLoadout(false);
    setMode('warm');
    setJammed(false);
    tries.current = 0;
    sendErrors.current = 0;
    setLoad({ kind: 'loading', pct: 5, slowSecs: 0 });
    if (dry) {
      // Dev dry run: a realistic split delay (?splitms=, default 8 s) so the warm-up can be seen.
      const sats = usdToSats(cab.creditUsd, bsvUsd) ?? 0;
      const n = roundsFor(sats, perShotAll);
      const ms = Number(new URLSearchParams(location.search).get('splitms') ?? 8000) || 0;
      for (const pct of [15, 30, 45, 60, 75, 90]) {
        setLoad({ kind: 'loading', pct, slowSecs: 0 });
        await new Promise((r) => setTimeout(r, ms / 6));
      }
      goLive(n);
      return;
    }
    setLocking(true);
    try {
      // End the previous session first: stop its sender, release the gun's lock, save its change.
      stop.current = true;
      sessionGen.current++;
      sessionAlive.current = false;
      await b.endSession();
      // The REAL spendable balance (chain + the wallet's payment + our own change), never a stale number.
      const avail = await b.refreshGun();
      loadMark(`lock & load: gun has ${avail} sats`);
      const plan = planLoad({ gunSats: avail, pendingUsd: 0, roundSats: Math.ceil(perShotAll) + overheadSats(1) });
      let shots = roundsFrom(avail, perShotAll, overheadSats);
      if (plan.short || shots <= 0) throw new Error('SHORT');
      const feeSats = Math.ceil(shots * perShot * fee);
      if (feeSats > 0) {
        await b.fireBatch(0, [['gallery', 'fee']], { address: HOUSE, sats: feeSats }, ammo ?? DEFAULT_AMMO);
        shots = Math.max(0, Math.floor((avail - feeSats - overheadSats(shots)) / perShot));
      }
      if (stream) await b.prepareStorm(shots, perShot, (pct, slowSecs) => setLoad({ kind: 'loading', pct, slowSecs }));
      loadMark(`loaded: ${shots} rounds`);
      goLive(shots);
      if (stream) sessionRef.current(shots);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      loadMark(`load failed: ${m || 'unknown'}`);
      const have = await b.refreshGun().catch(() => 0);
      setMode('off');
      setLoadout(true);
      setLoad({ kind: 'failed', text: m === 'SHORT' ? 'Not enough ammo in your gun for a round. Put another coin in.' : safeNote(fmtCredit(satsToUsd(have, bsvUsd))) });
    } finally {
      setLocking(false);
    }
  };
  // Opening LOADOUT ends live fire; rounds already fired still finish sending, the rest stays as credit.
  useEffect(() => {
    if (loadout && modeRef.current === 'live') {
      setMode('off');
      boughtRef.current = firedRef.current;
      setBought(firedRef.current);
    }
  }, [loadout, setMode]);
  // The sender is told to finish once everything fired is sent and the trigger is off for good.
  useEffect(() => {
    if (mode !== 'off') return;
    const i = setInterval(() => {
      if (sentRef.current >= firedRef.current) stop.current = true;
    }, 500);
    return () => clearInterval(i);
  }, [mode]);

  // A smooth bar: ease forward inside each stage, never frozen on one number.
  const target = load?.kind === 'loading' ? load.pct : load?.kind === 'ready' ? 100 : 0;
  const [eased, setEased] = useState(0);
  useEffect(() => {
    const i = setInterval(() => {
      setEased((e) => {
        if (target <= 0) return 0;
        const ceil = Math.min(99, target + 14);
        const floor = Math.max(e, target);
        return Math.min(ceil, floor + Math.max(0.15, (ceil - floor) * 0.04));
      });
    }, 100);
    return () => clearInterval(i);
  }, [target]);
  const warmPct = Math.round(Math.max(target, eased));
  const packLeft = Math.max(0, bought - fired);

  // LOCK & LOAD is the bill: pay the coins (one approval), load, then lock the rounds and start by itself.
  const lockRef = useRef(lockAndLoad);
  useEffect(() => {
    lockRef.current = lockAndLoad;
  });
  const startCabinet = () => cab.payThen(() => void lockRef.current());
  const buys = (usd: number) => {
    const sats = usdToSats(usd, bsvUsd);
    return sats == null ? null : roundsFor(sats, perShotAll);
  };

  // ON CHAIN feed: sample the latest accepted txid a few times a second (no polling per tx).
  const feedAt = useRef(0);
  useEffect(() => {
    if (!run.last || performance.now() - feedAt.current < 300) return;
    feedAt.current = performance.now();
    const row = { txid: run.last, at: Date.now() };
    void Promise.resolve().then(() => setFeed((f) => (f[0]?.txid === row.txid ? f : [row, ...f].slice(0, 6))));
  }, [run.last]);

  const spent = simulated ? 0 : run.sent * perShot;
  const names = useMemo(() => new Map(weapons.map((w) => [w.id, w.name])), [weapons]);

  const hint = mode === 'warm' ? 'WARM-UP: practice rounds while your gun loads. HOLD to fire.' : (stall ?? (packLeft <= 0 ? 'Out of rounds. Press LOADOUT and put another coin in.' : `${patternLabel(pattern)} · HOLD to fire (or SPACE).`));
  const toBoard = () => {
    setOver(null);
    setLoadout(true);
    setTimeout(() => document.getElementById('gallery-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  return (
    <div className={`game-root flex flex-col gap-3 ${drFontClass} ${tbxFontClass}`}>
      <GameAudio track="arena" />
      <section className="game-stage panel relative overflow-hidden p-0" style={{ background: '#04080d' }}>
        <canvas ref={canvas} className="block h-full min-h-[420px] w-full touch-none select-none" style={{ cursor: 'none' }} aria-label="Shooting Gallery: hold to fire" />
        <div ref={reticle} className="pointer-events-none absolute left-0 top-0 h-11 w-11" aria-hidden>
          <svg viewBox="0 0 44 44" className="h-full w-full" style={{ filter: 'drop-shadow(0 0 4px rgba(0,0,0,.95)) drop-shadow(0 0 6px rgba(63,216,232,.5))' }}>
            <path d="M22 5a17 17 0 0117 17M39 22a17 17 0 01-17 17M22 39A17 17 0 015 22M5 22A17 17 0 0122 5" fill="none" stroke="#e8f1f6" strokeWidth="1.6" strokeDasharray="14 12.6" strokeLinecap="round" />
            <path d="M22 1v7M22 36v7M1 22h7M36 22h7" stroke="#3fd8e8" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="22" cy="22" r="1.8" fill="#ff3b3b" />
          </svg>
        </div>
        {!ready && (
          <div className="absolute inset-0 z-[5] grid place-items-center bg-[#03070c]/90">
            <div className="tbx-glass tbx-pop w-[min(300px,80vw)] p-4 text-center">
              <p className="tbx-eyebrow mb-3 flex items-center justify-center gap-2" style={{ color: 'var(--tbx-teal)' }}>
                <Icon name="chip" size={14} /> Building Neo-Tokyo
              </p>
              <div className="tbx-bar">
                <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
              </div>
              <p className="mt-2 text-xs text-[var(--tbx-dim)] tbx-num">{Math.round(progress * 100)}%</p>
            </div>
          </div>
        )}

        {!loadout && !over && <AmmoColumn left={packLeft} loaded={Math.max(loadedRounds, packLeft)} />}
        {!loadout && !over && <OnChainPanel accepted={run.sent} tps={run.tps} feed={feed} simulated={simulated} />}
        {stall && !loadout && !over && (
          <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 flex justify-center px-4">
            <p className="tbx-glass tbx-pop flex max-w-[560px] items-center gap-2 px-4 py-2.5 text-center text-base font-semibold" style={{ borderColor: 'var(--tbx-red)' }} role="status">
              <Icon name="bullet" size={18} className="shrink-0 text-[var(--tbx-red)]" /> {stall}
            </p>
          </div>
        )}
        {(cab.stage === 'approve' || load?.kind === 'failed') && (
          <LoadingScreen
            title={GAME_TITLE}
            kicker={GAME_KICKER}
            setting={SETTING}
            shots={LOADING_SHOTS}
            track="arena"
            lore={LORE}
            characters={CHARACTERS}
            tips={TIPS}
            state={load?.kind === 'failed' ? load : { kind: 'approve' }}
          />
        )}
        {(mode === 'warm' || cab.stage === 'loading') && !loadout && !over && (
          <div className="tbx-in-d pointer-events-none absolute inset-x-0 top-[150px] z-20 flex justify-center px-3 sm:top-[118px]" role="status" data-warmup>
            <div className="tbx-glass w-full max-w-[460px] px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-bold tracking-wide text-white">
                  <Icon name="chip" size={15} className="text-[var(--tbx-teal)]" /> WARM-UP. Your gun is loading…
                </span>
                <Ticker value={warmPct} format={(n) => `${Math.round(n)}%`} className="tbx-display text-xl" />
              </div>
              <div className="tbx-bar mt-2">
                <i style={{ transform: `scaleX(${warmPct / 100})`, transition: 'transform 0.25s linear' }} />
              </div>
              <p className="mt-1.5 text-[11px] text-white/65">Practice rounds: nothing is sent, nothing is scored. Live rounds start when the gun is loaded.</p>
            </div>
          </div>
        )}
        {!loadout && !over && <BannerStage item={bannerCur} />}
        {queueNote && !loadout && !jammed && !over && (
          <div className="tbx-glass pointer-events-none absolute bottom-[96px] left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-white/85" role="status">
            Rounds are queueing, the network is catching up.
          </div>
        )}
        {jammed && !loadout && !over && (
          <div className="absolute inset-x-0 top-1/3 z-20 flex justify-center px-4" role="alert">
            <div className="tbx-glass tbx-pop flex flex-col items-center gap-3 px-6 py-4 text-center">
              <p className="text-lg font-bold text-white">Your gun jammed. Your rounds are safe, press RELOAD.</p>
              <button type="button" data-fs-skip onClick={() => { tries.current = 0; sendErrors.current = 0; void reloadRef.current(); }} className="tbx-btn tbx-btn-red !min-h-[48px] !px-7 !text-base">
                <Icon name="refresh" size={16} /> Reload
              </button>
            </div>
          </div>
        )}
        {load?.kind === 'failed' && (
          <Modal title="Loading stopped" tone="bad" action="Back to lock & load" onAction={() => setLoad(null)}>
            {load.text}
          </Modal>
        )}
        <CabinetModals modal={cab.modal} setModal={cab.setModal} reconnect={cab.reconnect} approving={cab.stage === 'approve'} approveSince={cab.approveSince} walletName={cab.walletName} error={cab.err} />

        {!loadout && !over && (
          <Hud
            dry={dry}
            fired={mode === 'live' ? fired : run.sent}
            sent={run.sent}
            weaponName={weapon.name}
            ammo={ammo ?? DEFAULT_AMMO}
            creditUsd={cab.creditUsd}
            tps={run.tps}
            spent={simulated ? '$0.00' : fmtUsd(usdOf(spent, bsvUsd))}
            stats={hud}
            handle={handle}
            packLeft={packLeft}
            bossName="THE LIQUID UNIT"
            bossNote="Reforms the moment you let up. Keep firing."
          />
        )}
        {!loadout && !over && (
          <HudControls
            hint={hint}
            locked={locked}
            canLock={pattern.kind === 'stream'}
            canEnd={mode === 'live' && fired > 0}
            onLoadout={() => setLoadout(true)}
            onLock={() => setLocked((v) => !v)}
            onStop={() => (setLocked(false), engine.current?.setTrigger(false))}
            onEnd={finish}
          />
        )}

        {/* GAME OVER */}
        {over && <Results r={over} onAgain={() => (setOver(null), setLoadout(true))} onBoard={toBoard} />}

        {/* LOADOUT */}
        {loadout && !over && (
          <Loadout
            weapons={weapons}
            weaponId={weaponId}
            setWeaponId={setWeaponId}
            canUse={canUse}
            paymail={paymail}
            cabinet={
              <CoinCabinet
                title="Shooting Gallery"
                creditUsd={cab.creditUsd}
                pendingUsd={cab.pending}
                bsvUsd={cab.bsvUsd}
                onCoin={cab.onCoin}
                onClear={cab.onClear}
                stage={cab.stage}
                stageText={cab.stageText}
                name={name}
                setName={setName}
                priceUsd={satsToUsd(perShotAll, bsvUsd)}
                priceNote={`Rounds at cost price${fee ? `, plus a ${Math.round(fee * 100)}% fee` : ', no extra charge'}. ${dry ? 'Dry run (dev): nothing is broadcast or spent.' : free ? 'Free for the stress test until 1 Nov.' : ''}`}
                buys={buys}
                unit="shots"
                startLabel={ready ? 'Lock & load' : 'Loading…'}
                onStart={startCabinet}
                starting={locking}
                blocked={!ready || !ammo || !canUse(weapon)}
                error={err ?? cab.err}
                note={cab.pending <= 0 && b.ammo > 0 && !dry ? leftoverNote(fmtCredit(cab.creditUsd)) : null}
                walletLive={cab.walletLive}
                walletName={cab.walletName}
              />
            }
          />
        )}
      </section>

      <PrizeBanner />

      <section className="tbx-glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}><Icon name="coin" size={14} /> Credit</span>
          <span className="text-xs text-[var(--tbx-dim)]">
            {free ? <span style={{ color: 'var(--tbx-ok)' }}>Free for the stress test: no platform fee until 1 Nov</span> : `${Math.round(fee * 100)}% platform fee`} · BSV ${bsvUsd.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--tbx-dim)]">
          <span>
            Credit: <span className="tbx-num font-bold" style={{ color: 'var(--tbx-amber)' }}>{fmtCredit(cab.creditUsd)}</span>.
          </span>
          <span>
            Rounds ready: <span className="tbx-num font-bold text-white">{packLeft.toLocaleString()}</span>. Unused credit stays in your gun for later rounds.
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--tbx-dim)]">
          <span>Paymail on your rounds (from your X handle):</span>
          <IdentityPicker compact />
        </div>
        {(err || b.error) && <p className="mt-2 text-sm font-semibold text-[#ff7a70]">{err ?? b.error}</p>}
      </section>

      <section className="tbx-glass p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}><Icon name="chain" size={14} /> See them land</span>
          <span className="text-xs text-[var(--tbx-dim)]">{simulated ? 'practice numbers, not on the record' : 'live'}</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
            Watch on bsv.lol <Icon name="external" size={12} />
          </a>
          {run.last && !simulated && (
            <a href={`https://whatsonchain.com/tx/${run.last}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
              latest shot {run.last.slice(0, 12)}… <Icon name="external" size={12} />
            </a>
          )}
          {run.last && simulated && <span className="font-mono text-xs text-[var(--tbx-mute)]">sim {run.last.slice(0, 16)}…</span>}
        </div>
      </section>

      <section id="gallery-board" className="tbx-glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}><Icon name="trophy" size={14} className="text-[var(--tbx-amber)]" /> Top blasters</span>
          <div className="flex gap-1.5">
            {(['event', '24h'] as const).map((w) => (
              <button key={w} onClick={() => setBoardWin(w)} className={`tbx-btn !min-h-[32px] !px-3 !text-[11px] ${boardWin === w ? 'tbx-btn-on' : ''}`}>
                {w === 'event' ? '31 OCT EVENT' : '24H'}
              </button>
            ))}
          </div>
        </div>
        <GalleryBoard rows={board} me={handle} mine={live && !dry ? run.sent : 0} myWeapon={weaponId} myAmmo={ammo ?? DEFAULT_AMMO} names={names} />
        <p className="mt-3 text-xs text-[var(--tbx-mute)]">
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
  if (!list.length) return <p className="text-sm text-[var(--tbx-dim)]">No ranked shots yet. Be the first name on the board.</p>;
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {list.slice(0, 10).map((r, i) => (
        <li key={r.handle} className={`tbx-rise flex flex-wrap items-center justify-between gap-x-3 rounded-lg px-3 py-2 ${r.handle === me ? 'border border-[var(--tbx-teal)]/50 bg-[var(--tbx-teal)]/10' : 'bg-white/[0.035]'}`} style={{ ['--d' as string]: `${i * 0.04}s` }}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="tbx-display w-7 text-xl" style={{ color: i === 0 ? 'var(--tbx-amber)' : 'var(--tbx-mute)' }}>{String(i + 1).padStart(2, '0')}</span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">@{r.handle}</span>
            {r.weapon && <span className="text-xs text-[var(--tbx-dim)]">{names?.get(r.weapon) ?? r.weapon}</span>}
            {r.ammo && <span className="text-xs text-[var(--tbx-amber)]">{r.ammo}</span>}
          </span>
          <span className="tbx-num font-bold">{r.shots.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
