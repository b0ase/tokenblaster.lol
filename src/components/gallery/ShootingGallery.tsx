'use client';

/**
 * TokenBlaster Shooting Gallery (3D). First person behind the BSVGun arsenal on a rain-wet night street,
 * against the TERRORNODE tower and its LIQUID UNIT (src/lib/galleryGame/*). Every round that lands
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
import { TxMeter } from '@/lib/txMeter';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getBarWallet, subBarWallet } from '@/lib/walletBar';
import { useBlaster } from '@/lib/useBlaster';
import { holdWalletForPlay } from '@/lib/wallet';
import { getSiteWallet } from '@/lib/siteWallet';
import { usePlayerName } from '@/components/coinop/usePlayerName';
import { LiveTxBadge } from './LiveTxBadge';
import { cachedProof } from '@/lib/xproof';
import { minigun, sfx, skipTrack, unlockAudio } from '@/lib/sfx';
import { useOrdnance } from '@/lib/useOrdnance';
import { useNpgCards } from '@/lib/useNpgCards';
import { GIRLS, girlImg, loadPick, modsFor, normalizePick, savePick, statsFor, type Pick } from '@/lib/npgLoadout';
import { CharacterSelect } from './CharacterSelect';
import { STOCK_IDS, buildWeapons, type RangeWeapon } from '@/lib/bsvgun/weapons';
import { GalleryEngine, type Hooks, type Quality, type StageEvent, type Stats } from '@/lib/galleryGame/engine';
import {
  DEFAULT_AMMO,
  blockRounds,
  overheadSats,
  roundsFor,
  ammoFromPaymail,
  fmtUsd,
  freeForStressTest,
  galleryPushes,
  HANDLE_BUDGET,
  roundHandle,
  patternLabel,
  platformFeeAt,
  shotSats,
  txPattern,
  ASSAULT_GUNS,
  STREAM_STEP,
  usdOf,
} from '@/lib/gallery';
import { SiteWalletChooser } from '@/components/SiteWalletChooser';
import { GameAudio } from '../SoundToggle';
import { drFontClass } from '../dr/fonts';
import { tbxFontClass } from '../coinop/fonts';
import { Icon, Modal, Ticker } from '../coinop/ui';
import { PlayerPanel } from './PlayerPanel';
import { AmmoCoinPick, useAmmoCoinQuote } from './AmmoCoinPick';
import { useReceipts } from './useReceipts';
import { fetchSplit, reportSplit, splitAvailable } from '@/lib/launch/splitClient';
import { SPLIT_LINE, splitOutputs } from '@/lib/launch/split';
import { PER_SHOT_BURN, type AmmoCoin } from '@/lib/launch/ammoCoins';
import { GunUnload, UnloadButton } from '../GunUnload';
import { INFO_URL } from './AssaultInfo';
import { AmmoColumn } from './AmmoColumn';
import { OnChainPanel, type FeedRow } from './OnChainPanel';
import { LoadingScreen, type LoadState } from '../coinop/LoadingScreen';
import { CHARACTERS, CREDIT, CTA, GAME_KICKER, KWEG_LOST, GAME_TITLE, LORE, LOADING_SHOTS, PRACTICE, SETTING, TIPS, actOf, forPractice, stageBrief } from '@/lib/gallery/story';
import { Hud, HudControls } from './Hud';
import { TUNING } from '@/lib/galleryGame/tuning';
import { BannerStage, RescuedBeat, useBanners } from './Banners';
import { Loadout } from './Loadout';
import { RotatePrompt } from './RotatePrompt';
import { isMobileLite, isPhone } from '@/lib/mobileLite';
import { PlayInBwalletButton, usePlayInBwallet } from './PlayInBwallet';
import type { RunSummary } from './Results';
import dynamic from 'next/dynamic';
import type { LevelId, Progress } from '@/lib/terrornode/levels';
// LEVELS: the table, the select and the clear card are their own chunks (the first load stays the same size)
const LevelSelect = dynamic(() => import('../terrornode/Levels').then((m) => m.LevelSelect), { ssr: false });
const LevelClear = dynamic(() => import('../terrornode/Levels').then((m) => m.LevelClear), { ssr: false });
type LevelsModule = typeof import('@/lib/terrornode/levels');
// the results screen only shows at the end of a run: its own chunk, fetched once the engine is up
const loadResults = () => import('./Results').then((m) => m.Results);
const Results = dynamic(loadResults, { ssr: false });
import { Flatlined, type FlatStats } from './Flatlined';
import { DamageFx, type DamageFxHandle } from './DamageFx';
import { CabinetModals, CoinCabinet } from '../coinop/CoinCabinet';

import { STORM_RELEASED, loadMark } from '@/lib/gun';
import { leftoverNote, planLoad, roundsFrom, safeNote } from '@/lib/coinop/ammo';
import { useCabinet } from '../coinop/useCabinet';
import { GALLERY_GAME, MIN_REPORT_SECS } from '@/lib/gallery';
import { cleanName, fmtCredit, satsToUsd, usdToSats } from '@/lib/coinop/credit';
import { satsWord, shotsForSats, shotsForUsd } from '@/lib/coinop/shots';

const FALLBACK_USD = 17.4;
const PREFS = 'tb:gallery-prefs';
/** Trigger held this long with rounds queued and none sent: the gun shows JAMMED (ms). */
/** Out of rounds and nobody has overrun you yet: the run ends after this long anyway (ms). */
const OUT_OF_ROUNDS_MS = 30000;
const JAM_MS = 6000;
const TUNING_FLOW = TUNING.stageFlow;
const BEFORE_EVENT = Date.parse('2026-10-24T00:00:00Z'); // first render, before the clock is read

type Run = { sent: number; started: number; last: string | null; tps: number; status: string | null };


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

/** Option A (coin-ammo swap-on-load + bulk burn) is off in Assault (owner, 25 Oct: receipts replace it). Code kept. */
const COIN_AMMO_UI = false;

export function ShootingGallery({ freePlay: freePlayProp = false }: { freePlay?: boolean } = {}) {
  // GUEST / DEMO (owner, 26 Oct: "zero out of ten for onboarding"): PLAY FREE runs the same free-play path as
  // NEXT_PUBLIC_GALLERY_PAID=0: simulated rounds, no wallet, nothing paid or broadcast. A wallet is only asked for
  // when the player picks PAID ROUNDS (LOCK & LOAD).
  const [guest, setGuest] = useState(false);
  const [coarse, setCoarse] = useState(false); // a touch screen: touch hints and the FIRE button
  const [lost, setLost] = useState(false); // the WebGL context was dropped (iOS memory pressure): offer a reload
  useEffect(() => {
    void Promise.resolve().then(() => setCoarse(window.matchMedia('(pointer: coarse)').matches));
  }, []);
  const [guestPending, setGuestPending] = useState(false);
  const freePlay = freePlayProp || guest;
  const b = useBlaster();
  const { storm, fireBatch } = b;
  const { name, hasPaymail } = usePlayerName();
  const weapons = useMemo(() => {
    // Volume guns only: sustained ~2,000 tx/s streams, no single shots or bursts (owner, 24 Oct: stress test).
    const all = buildWeapons();
    return ASSAULT_GUNS.map((id) => all.find((w) => w.id === id)).filter((w): w is RangeWeapon => !!w);
  }, []);
  const ordnance = useOrdnance(b.wallet); // wallet baskets only on the loadout's explicit tap
  const { owned } = ordnance;
  // NPG character select (src/lib/npgLoadout.ts): the girl + a weapon per hand; her stats drive small game modifiers.
  const npgCards = useNpgCards(b.wallet); // address index on connect; wallet baskets only on the explicit tap
  const [girlPick, setGirlPickRaw] = useState<Pick>(() => normalizePick(null));
  useEffect(() => void Promise.resolve().then(() => setGirlPickRaw(loadPick())), []);
  const setGirlPick = useCallback((p: Pick) => (setGirlPickRaw(p), savePick(p)), []);
  const girlMods = useMemo(() => modsFor(statsFor(girlPick)), [girlPick]);
  const girlName = GIRLS.find((g) => g.id === girlPick.girl)?.name ?? '';
  const [dry, setDry] = useState(false);
  const [autofire, setAutofire] = useState(false);
  const [weaponId, setWeaponId] = useState('minigun');
  // Rounds carry the player's paymail once a wallet pays; practice fires plain sats.
  // The paymail from bWallet's lookup for this identity key (else plain DEFAULT_AMMO).
  const barWallet = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  const paymail = b.wallet && barWallet?.publicKey === b.wallet.publicKey ? ammoFromPaymail(barWallet) : null;
  const ammo = paymail ?? DEFAULT_AMMO;
  // The NAME is the wallet's paymail (owner, 25 Oct): the on-chain handle tag and the board name (src/lib/gallery.ts roundHandle).
  const handle = roundHandle(barWallet?.paymail, cleanName(name));
  const [netSeen, setNetSeen] = useState(0);
  const netSeenRef = useRef(0); // across reload sessions (each session's count starts at 0)
  const [loadout, setLoadout] = useState(true);
  // LEVELS (src/lib/terrornode/levels.ts): which window of the block plays, what you have reached, LEVEL CLEAR.
  const [levels, setLevels] = useState<Progress>(() => ({ v: 1, reached: ['assault', 'market'], best: {} }));
  const lvMod = useRef<LevelsModule | null>(null);
  const [levelId, setLevelId] = useState<LevelId>('assault');
  const [levelClear, setLevelClear] = useState<{ id: LevelId; score: number; rounds: number } | null>(null);
  const [bsvUsd, setBsvUsd] = useState(FALLBACK_USD);
  const [locked, setLocked] = useState(false);
  const [run, setRun] = useState<Run>({ sent: 0, started: 0, last: null, tps: 0, status: null });
  const [bought, setBought] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const { cur: bannerCur, push: pushBanner, clear: clearBanners } = useBanners();
  const [hud, setHud] = useState<Stats | null>(null);
  const hudWave = useRef(1);
  const finishRef = useRef<() => void>(() => undefined); // set below, once finish exists
  const [over, setOver] = useState<RunSummary | null>(null);
  // FLATLINED: the player's health hit zero (death is back, owner 25 Oct). The CONTINUE? countdown runs on this screen.
  const [flat, setFlat] = useState<FlatStats | null>(null);
  const flatRef = useRef(false);
  const diedRef = useRef<() => void>(() => undefined);
  const statsRef = useRef<Stats | null>(null);
  const dmgFx = useRef<DamageFxHandle>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GalleryEngine | null>(null);
  const simRef = useRef<Sim>({ on: false, rate: 0, target: 2000, carry: 0 });
  const stop = useRef(false);
  const held = useRef(false);
  const sentRef = useRef(0);
  const lastAccept = useRef(0);
  const chainN = useRef(1);
  const [sid] = useState(() => Math.random().toString(36).slice(2, 10));
  const live = true; // coin-op: every round is paid
  const simulated = dry;
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];
  const girlModsRef = useRef(girlMods);
  useEffect(() => {
    girlModsRef.current = girlMods;
    if (engine.current) engine.current.mods = girlMods;
  }, [girlMods]);
  const pattern = txPattern(weapon);
  const unlocked = useMemo(() => new Set([...STOCK_IDS, ...owned]), [owned]);
  // Dry runs let you try any gun; LIVE fires the stock guns plus the 1Sat Ordnance you own.
  const canUse = (w: RangeWeapon) => simulated || unlocked.has(w.id);
  const clock = now || BEFORE_EVENT;
  const fee = platformFeeAt(clock);
  const free = freeForStressTest(clock);
  const ammoLen = (ammo ?? DEFAULT_AMMO).length;
  const perShot = shotSats(HANDLE_BUDGET, ammoLen);
  // The wallet sheet names the game the player is in (owner, 25 Oct 2026: it said "Shooting Gallery" on TerrorNode).
  const cab = useCabinet(b, 'TerrorNode', { dry });
  // $TERRORNODE receipts (owner, 25 Oct): every LIVE bullet also buys 1 receipt at the curve price (src/lib/launch/receipts.ts).
  const rc = useReceipts(!freePlay && !dry);
  // The receipts go to the connected wallet. No wallet attached right now: they stay owed (and say so), never dropped.
  const settleReceipts = () => {
    const w = b.wallet ?? getSiteWallet().wallet;
    void rc.settle({ pay: b.payReceipts, recipient: w?.address ?? null, session: sid, handle: handle ?? "", shownAs: barWallet?.paymail ?? w?.address ?? "your wallet" });
  };
  // Swap on load (owner, 25 Oct 2026): an ammo coin bought on BlastPad at LOCK & LOAD (one approval), burned per shot.
  const [ammoCoin, setAmmoCoin] = useState<AmmoCoin | null>(null);
  const [liveCoin, setLiveCoin] = useState<AmmoCoin | null>(null);
  const [slipBps, setSlipBps] = useState(300);
  const [coinStatus, setCoinStatus] = useState<string | null>(null);
  const liveCoinRef = useRef<AmmoCoin | null>(null); // read by the storm session (set before it starts)
  // FREE PLAY (production while payments are fixed): credit is on the house, so LOCK & LOAD just works.
  const { setDryCredit } = cab;
  useEffect(() => {
    if (freePlay) setDryCredit((c) => (c >= 1 ? c : 1));
  }, [freePlay, setDryCredit]);
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
      setDry(freePlay || qs.get('dryrun') === '1');
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
  }, [freePlay]);
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
  const stageRef = useRef<(e: StageEvent) => void>(() => undefined);
  const pullRef = useRef<(w: RangeWeapon) => boolean>(() => false);
  const triggerRef = useRef<(down: boolean) => void>(() => undefined);
  const hooks = useRef<Hooks>({
    pull: (w) => pullRef.current(w),
    flowing: () => (simRef.current.on ? simRef.current.rate > 20 : performance.now() - lastAccept.current < 700),
    stats: (s) => {
      statsRef.current = s;
      setHud(s);
    },
    trigger: (d) => triggerRef.current(d),
    hurt: (h) => dmgFx.current?.hit(h.angle, h.dmg),
    stage: (e) => stageRef.current(e),
    died: () => diedRef.current(),
    lost: () => setLost(true),
  });

  // ── Engine ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const phone = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency ?? 8) <= 4;
    const lite = isMobileLite();
    const quality: Quality = new URLSearchParams(location.search).get('q') === 'low' || phone || lite ? 'low' : 'high';
    const eng = new GalleryEngine(cv, hooks, { quality, weapons, bossBase: 20_000, lite });
    eng.stickEl = stickRef.current;
    eng.knobEl = knobRef.current;
    engine.current = eng;
    eng.mods = girlModsRef.current;
    if (new URLSearchParams(location.search).get('dryrun') === '1') (window as unknown as { __gallery?: GalleryEngine }).__gallery = eng; // dev only: screenshot scripts poke the combat
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
    if (ready) void loadResults();
  }, [ready]);
  // levels: what this browser has reached, and ?level=<id> to jump straight to one you have reached
  useEffect(() => {
    const want = new URLSearchParams(location.search).get('level');
    void import('@/lib/terrornode/levels').then((m) => {
      lvMod.current = m;
      const p = m.loadProgress();
      setLevels(p);
      if (m.isLevelId(want) && m.isReached(p, want)) setLevelId(want);
    });
  }, []);
  /** Put the engine on a level and back to its start (the gun, its rounds and the payment state are untouched). */
  const pickLevel = (id: LevelId) => {
    setLevelId(id);
    const e = engine.current;
    if (e) void e.setLevel(id).then(() => e.startRun());
  };
  useEffect(() => {
    const e = engine.current;
    if (ready && e && e.level.id !== levelId) void e.setLevel(levelId).then(() => e.startRun());
  }, [ready, levelId]);
  const clearLevel = (id: LevelId, score: number, rounds: number) => {
    const m = lvMod.current;
    if (!m) return;
    setLevels((p) => {
      const q = m.recordClear(p, id, score, rounds);
      m.saveProgress(q);
      return q;
    });
  };
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
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  /** GO: real rounds are live (a short banner the moment the load finishes). */
  const [goAt, setGoAt] = useState(0);
  useEffect(() => {
    if (!goAt) return;
    const t = setTimeout(() => setGoAt(0), 1300);
    return () => clearTimeout(t);
  }, [goAt]);
  // Zero wallet prompts during play: from warm-up to the end of the round nothing may reach the wallet (src/lib/wallet.ts).
  useEffect(() => {
    // Only while a round is actually on: back on the loadout / results the wallet is free again (a payment there must
    // reach it; owner, 25 Oct: "my wallet keeps saying no to lock and load").
    // FLATLINED too: CONTINUE pays through the wallet, so the round's hold must be off (the storm keeps its own hold).
    holdWalletForPlay(mode !== 'off' && !loadout && !over && !flat);
    return () => holdWalletForPlay(false);
  }, [mode, loadout, over, flat]);
  // Nothing can hurt the player unless they are actually playing (owner, 24 Oct: FLATLINED while on the loadout).
  useEffect(() => {
    const e = engine.current;
    // LOADING YOUR AMMO (owner, 25 Oct): the warm-up is safe. Nothing spawns, attacks or hurts until GO.
    if (e) e.combat = !loadout && mode === 'live' && !over;
  }, [loadout, mode, over, ready]);
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
  /** Storm-session restarts since rounds last landed. */
  const tries = useRef(0);
  /** The stream sender gave up (3 failed restarts): it needs RELOAD. Never shown on its own, see the jam watch. */
  const senderDead = useRef(false);
  /** When the trigger went down (0 = up): the jam watch only counts time with the trigger held. */
  const heldSince = useRef(0);
  /**
   * JAMMED (owner, 25 Oct): only when the trigger has been held for JAM_MS with rounds queued and NOT ONE round
   * sent or accepted in that time. It clears itself the moment a round lands. It used to latch on a count of
   * old errors and stay up while the gun kept firing.
   */
  const [jammed, setJammed] = useState(false);
  const [queueNote, setQueueNote] = useState(false);

  const acceptedMeter = useRef(new TxMeter());
  const landed = useCallback(
    (n: number, txid: string | null) => {
      if (n <= 0) return;
      sentRef.current += n;
      acceptedMeter.current.add(n);
      // A sender round can run a few rounds ahead of the trigger: those count as fired too.
      if (sentRef.current > firedRef.current) firedRef.current = sentRef.current;
      lastAccept.current = lastSent.current = performance.now();
      tries.current = 0;
      setJammed(false); // rounds are flowing: never jammed
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
      s.on = held.current && !pausedRef.current && !loadout && !flatRef.current && pattern.kind === 'stream' && (m === 'warm' || (m === 'live' && left > 0));
      s.target = pattern.kind === 'stream' ? pattern.rate : 0;
      let n = simTick(s, (t - last) / 1000);
      last = t;
      if (m === 'live') {
        n = Math.max(0, Math.min(n, left));
        firedRef.current += n;
      }
      if (n) engine.current?.accept(n);
      if (m === 'live') setFired((f) => (f === firedRef.current ? f : firedRef.current));
      // LIVE (paid): the HUD shows what ARC accepted per second, never the trigger's rate (src/lib/txMeter.ts).
      // Practice / free play: the gun's simulated stream rate, labelled rounds/s (owner: show the full volume).
      const tps = m === 'live' && !dry ? acceptedMeter.current.rate() : Math.round(s.rate);
      setRun((r) => (r.tps === tps ? r : { ...r, tps }));
    }, 50);
    return () => clearInterval(i);
  }, [loadout, pattern, dry]);

  // Bursts (shotguns, launchers): every pull fires at once and queues its rounds.
  useEffect(() => {
    triggerRef.current = (down: boolean) => {
      if (down && !held.current) heldSince.current = performance.now();
      if (!down) heldSince.current = 0;
      held.current = down;
      if (down) unlockAudio();
    };
    pullRef.current = (w: RangeWeapon) => {
      if (loadout || flatRef.current || pausedRef.current) return false;
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
  }, [loadout, freePlay]);

  // ── Sender ──
  // Dry run (dev): a fake network with a delay and failures (?sendrate= tx/s, ?sendfail= 0..1 chance a second
  // stalls, ?stallms= stall length), so it can be shown that the gun never stops while sending lags.
  useEffect(() => {
    if (!dry || mode !== 'live') return;
    const qs = new URLSearchParams(location.search);
    const rate = Number(qs.get('sendrate') ?? 600) || 600;
    const failP = Number(qs.get('sendfail') ?? 0); // practice never fakes a bad network unless asked (?sendfail=)
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
    if (dry || mode !== 'live' || pattern.kind !== 'burst' || (PER_SHOT_BURN && liveCoin)) return;
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
          sendErrors.current = 0;
        } catch (e) {
          sendErrors.current++;
          backoff = Math.min(8000, backoff ? backoff * 2 : 500);
          console.warn('[tb-fire] batch failed, retrying', e);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [dry, mode, pattern.kind, fireBatch, handle, ammo, landed, liveCoin]);

  // Live, streams: one storm session over the prepared lanes, paused whenever the queue is empty. If it ends
  // with rounds still queued (a network failure), it reloads by itself and carries on; after 3 tries: jammed.
  const sessionAlive = useRef(false);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  const sessionRef = useRef<(rounds: number) => void>(() => undefined);
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
      const seenBase = netSeenRef.current;
      // Coin ammo (option A): the rounds carry the coin's token id; every accepted round is owed as a burn.
      const coin = liveCoinRef.current;
      let released = false;
      void storm(
        rounds,
        (n, last, net) => {
          if (net) setNetSeen((netSeenRef.current = seenBase + net.seen));
          const d = n - prev;
          prev = n;
          if (coin && d > 0) b.oweCoinRounds(coin.tokenId, d);
          else if (d > 0) rc.fired(d);
          landed(d, last ?? null);
        },
        () => stop.current,
        (st) => {
          if (st === STORM_RELEASED) released = true; // idle: the gun let go of the lock, reload on the next shot
        },
        { game: GALLERY_GAME, extra: galleryPushes(handle).slice(1) },
        perShot,
        coin ? coin.tokenId : ammo,
        () => pausedRef.current || sentRef.current >= firedRef.current, // PAUSE or nothing queued: hold, keep the lanes
        STREAM_STEP, // most blasts per lane per ARC round: up to 100 lanes x 100 a round
      )
        .catch((e) => {
          sendErrors.current++;
          console.warn('[tb-fire] sender stopped', e);
        })
        .finally(() => {
          // Coin ammo: ONE bulk burn for the rounds this session fired (a failure stays owed for the next load/unload).
          if (coin) void b.settleCoinBurn(coin.burnPer).catch((e) => console.warn('[tb-fire] bulk burn deferred', e));
          if (gen !== sessionGen.current) return;
          sessionAlive.current = false;
          console.info(`[tb-fire] session ${gen} ended`);
          const left = boughtRef.current - sentRef.current;
          // Receipts settle when the session is really over (a reload keeps counting, then settles once).
          if (stop.current || left <= 0 || modeRef.current !== 'live') return settleReceipts();
          if (released) return void (reloadOnFire.current = true); // not a failure: no try used, no reload until fired
          if (++tries.current > 3) {
            settleReceipts();
            return void (senderDead.current = true);
          }
          void reloadRef.current();
        });
    };
  });
  /** The session ended because it sat idle (gun lock released): reload when something is queued to fire again. */
  const reloadOnFire = useRef(false);
  useEffect(() => {
    const i = setInterval(() => {
      if (!reloadOnFire.current || sessionAlive.current || modeRef.current !== 'live') return;
      if (pausedRef.current || document.visibilityState === 'hidden' || sentRef.current >= firedRef.current) return;
      reloadOnFire.current = false;
      void reloadRef.current();
    }, 250);
    return () => clearInterval(i);
  }, []);
  /** RELOAD: re-run the preparation for the rounds not sent yet (no new payment) and start sending again. */
  useEffect(() => {
    reloadRef.current = async () => {
      const left = boughtRef.current - sentRef.current;
      if (left <= 0) return;
      try {
        if (!dry) await b.prepareStorm(left, perShot);
        senderDead.current = false;
        if (!dry) sessionRef.current(left);
      } catch (e) {
        console.warn('[tb-fire] reload failed', e);
        senderDead.current = true;
      }
    };
  });

  // Live, ammo coin: the coin storm (multi-lane token burns in the storm workers, src/lib/stormCore.ts burn mode).
  // Each burn is tagged "tokenblaster.lol" <token id> <n> gallery <paymail>: bsv.lol shows it as TokenBlaster with
  // the coin's symbol. Held while nothing is queued, like the sats storm.
  const { coinStorm } = b;
  const coinSession = useRef<(rounds: number) => void>(() => undefined);
  useEffect(() => {
    coinSession.current = (rounds: number) => {
      if (sessionAlive.current || rounds <= 0) return;
      const gen = ++sessionGen.current;
      sessionAlive.current = true;
      stop.current = false;
      let prev = 0;
      const seenBase = netSeenRef.current;
      void coinStorm(
        (n, last, net) => {
          if (net) setNetSeen((netSeenRef.current = seenBase + net.seen));
          const d = n - prev;
          prev = n;
          landed(d, last ?? null);
        },
        () => stop.current,
        () => pausedRef.current || sentRef.current >= firedRef.current,
        { game: GALLERY_GAME, extra: galleryPushes(handle).slice(1) },
        STREAM_STEP,
      )
        .catch((e) => {
          sendErrors.current++;
          console.warn('[tb-fire] coin storm stopped', e);
        })
        .finally(() => {
          if (gen !== sessionGen.current) return;
          sessionAlive.current = false;
          if (!stop.current && boughtRef.current - sentRef.current > 0 && modeRef.current === 'live') senderDead.current = true;
        });
    };
  });

  // NOT SENDING watch (owner log, 25 Oct: "queue 3062 · sent 0" for good, nothing on screen): rounds are queued
  // and nothing has reached the network for a while. Say so on screen, retry the sender once by itself, then offer
  // the fix (no new charge: the rounds are still in the gun).
  const [notSending, setNotSending] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'live') return void Promise.resolve().then(() => setNotSending(null));
    let retried = false;
    const t0 = performance.now();
    const i = setInterval(() => {
      if (pausedRef.current) return;
      const q = firedRef.current - sentRef.current;
      const since = performance.now() - Math.max(lastSent.current, t0);
      let msg: string | null = null;
      if (q > 0 && since > 15_000) {
        const secs = Math.round(since / 1000);
        if (!retried && !reloading.current) {
          retried = true;
          reloading.current = true;
          loadMark(`sender: ${q} rounds queued, nothing sent for ${secs} s: restarting the sender`);
          void reloadRef.current().finally(() => (reloading.current = false));
        }
        msg = since > 40_000
          ? `Your rounds are not reaching the network (${secs} s, ${q.toLocaleString('en-US')} queued${sendErrors.current ? `, ${sendErrors.current} send error(s)` : ''}). Press R or LOADOUT, then LOCK & LOAD: no new charge, the rounds are still in your gun.`
          : `Waiting for the network to take your rounds (${secs} s)… retrying.`;
      }
      setNotSending((m) => (m === msg ? m : msg));
    }, 1000);
    return () => clearInterval(i);
  }, [mode]);

  // Queue note, the jam watch + [tb-fire] timing logs.
  const liveSince = useRef(0);
  const reloading = useRef(false);
  useEffect(() => {
    if (mode !== 'live') return;
    liveSince.current = performance.now();
    let prevSent = sentRef.current;
    let tLog = performance.now();
    const i = setInterval(() => {
      const t = performance.now();
      const q = firedRef.current - sentRef.current;
      const behind = q > 0 && (q > 1500 || t - lastSent.current > 3000);
      setQueueNote((v) => (v === behind ? v : behind));
      // the jam watch: trigger held JAM_MS, rounds queued, nothing sent in that whole window
      const since = Math.max(heldSince.current, lastSent.current, liveSince.current);
      const jam = held.current && heldSince.current > 0 && q > 0 && t - since > JAM_MS;
      setJammed((v) => (v === jam ? v : jam));
      if (jam && senderDead.current && !reloading.current) {
        // the sender gave up: try one quiet reload by itself before asking
        reloading.current = true;
        void reloadRef.current().finally(() => (reloading.current = false));
      }
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
      if (held.current && !loadout && modeRef.current === 'live' && boughtRef.current - firedRef.current <= 0) msg = freePlay ? 'Out of practice rounds. Press LOADOUT and LOCK & LOAD for more.' : 'Out of rounds. Press LOADOUT and put another coin in.';
      setStall((m) => (m === msg ? m : msg));
    }, 400);
    return () => clearInterval(i);
  }, [loadout, freePlay]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (locked) e.setTrigger(true);
    else if (!autofire) e.setTrigger(false);
  }, [locked, autofire]);
  useEffect(() => {
    if (loadout) engine.current?.setTrigger(false);
  }, [loadout, freePlay]);

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


  /** Report this session's accepted shots (LIVE, named, real chain only); verified on chain by the last txid. */
  const lastReport = useRef(0);
  const reportRef = useRef<(force: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => {
    reportRef.current = async (force: boolean) => {
      if (!live || dry || !handle || !run.last || !sentRef.current) return;
      if (!force && Date.now() - lastReport.current < 60_000) return;
      const secs = Math.round((Date.now() - run.started) / 100) / 10;
      // The scores function rejects a run under MIN_REPORT_SECS as "implausible run" (400): the first report fired the
      // moment the first round landed (owner, 26 Oct 2026). Wait until the run is long enough.
      if (!run.started || secs < MIN_REPORT_SECS) return;
      lastReport.current = Date.now();
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: 'gallery',
          mode: 'live',
          name: handle.split('@')[0], // the scores table name is 16 chars, no '@'; the full paymail rides in meta.x
          score: sentRef.current,
          secs,
          meta: { sid, w: weaponId, a: (ammo ?? DEFAULT_AMMO).slice(0, 32) },
          txid: run.last,
          x: handle,
          xp: cachedProof(handle) ?? undefined,
        }),
      }).catch(() => undefined);
    };
  });
  const sending = fired > run.sent;
  useEffect(() => {
    if (live && !dry && run.sent) void reportRef.current(!sending);
  }, [live, dry, run.sent, sending]);

  // STAGE FLOW (from the engine): ONE seamless ten-minute walk (owner, 24 Oct). A new stage opens under a fog
  // surge with a non-blocking banner and a new song while the fire never stops; the Liquid Unit walks in for the
  // last minutes, goes down, the hostage is free and the RESCUED beat plays before the results.
  const [rescued, setRescued] = useState(false);
  /** ACT 2 ESCORT: Dr Kweg died (DR KWEG WONG IS LOST, retry from the start of Act 2). */
  const [kwegLost, setKwegLost] = useState(false);
  const rescuedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const stageEvent = useRef<(e: StageEvent) => void>(() => undefined);
  useEffect(() => {
    stageEvent.current = (e) => {
      if (e.kind === 'enter') {
        hudWave.current = e.stage;
        skipTrack(); // a new stage, a new song
        // into Act 2 from the core: Dr Wong is cut loose, then the act card (story.ts ACTS)
        if (e.stage === 4) {
          pushBanner({ kind: 'freed' });
          pushBanner({ kind: 'act', n: 2 });
        }
        pushBanner({ kind: 'stage', n: e.stage });
        return;
      }
      if (e.kind === 'boss') {
        pushBanner({ kind: 'boss' });
        return;
      }
      if (e.kind === 'clear') {
        // LEVEL CLEAR: the swarm is called off; the rounds still in the gun carry into the next level
        held.current = false;
        engine.current?.setTrigger(false);
        clearBanners();
        clearLevel(e.level, e.score, e.rounds);
        setLevelClear({ id: e.level, score: e.score, rounds: e.rounds });
        return;
      }
      if (e.kind === 'lost') {
        held.current = false;
        engine.current?.setTrigger(false);
        clearBanners();
        setKwegLost(true);
        return;
      }
      if (e.kind === 'rescued') {
        const lr = engine.current?.levelRun();
        if (engine.current && lr) clearLevel(engine.current.level.id, lr.score, lr.rounds);
        rescuedRef.current = true;
        setRescued(true);
        clearBanners();
        held.current = false;
        simRef.current.on = false;
        engine.current?.setTrigger(false);
        setLocked(false);
        later(() => finishRef.current(), TUNING_FLOW.cutsceneSecs * 1000);
      }
    };
  });
  useEffect(() => {
    stageRef.current = (e) => stageEvent.current(e);
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  // GAME OVER: out of rounds and everything fired has been sent (or the player pressed RESULTS).
  const finish = useCallback(() => {
    setRescued(false);
    flatRef.current = false;
    setFlat(null);
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
      wave: hud?.stage ?? 1,
      rescued: rescuedRef.current,
      kills: hud?.kills ?? 0,
      secs: run.started ? Math.max(1, Math.round((Date.now() - run.started) / 1000)) : 0,
      spent: dry ? '$0.00' : fmtUsd(usdOf(run.sent * perShot, bsvUsd)),
      last: dry ? null : run.last,
      handle,
      simulated: dry,
    });
    setMode('off');
    boughtRef.current = firedRef.current;
    setBought(firedRef.current);
  }, [hud, run.started, run.sent, run.last, perShot, bsvUsd, dry, handle, setMode, clearBanners, setLocked, setOver, setBought, setFlat]);
  useEffect(() => {
    finishRef.current = finish;
  });
  // Receipts still owed with no storm running (a session replaced before its end ran, an earlier page load, a wallet
  // attached only now): settle them once play is off. The storm's own end settles the normal case.
  const settleRef = useRef(settleReceipts);
  useEffect(() => {
    settleRef.current = settleReceipts;
  });
  const walletAddr = b.wallet?.address ?? null;
  useEffect(() => {
    if (!rc.live || rc.owed <= 0 || mode !== 'off' || locking || sessionAlive.current) return;
    const t = setTimeout(() => settleRef.current(), 1500);
    return () => clearTimeout(t);
  }, [rc.live, rc.owed, mode, locking, walletAddr]);
  useEffect(() => {
    hudWave.current = hud?.stage ?? 1;
  }, [hud?.stage]);
  useEffect(() => {
    // OUT OF ROUNDS no longer ends the run on the spot (owner, 25 Oct): the swarm closes in and an empty gun gets
    // overrun (FLATLINED, CONTINUE?). This is only the fallback if nothing reaches the player in time.
    if (mode !== 'live' || loadedRounds <= 0 || bought - fired > 0 || run.sent < fired || flat) return;
    const t = setTimeout(() => finishRef.current(), OUT_OF_ROUNDS_MS);
    return () => clearTimeout(t);
  }, [mode, loadedRounds, bought, fired, run.sent, flat]);

  // ── LOCK & LOAD: turn the loaded credit into rounds (credit is the ammunition) ──
  // After the payment the player drops straight into the street in WARM-UP while the gun loads.
  const perShotAll = perShot * (1 + fee);
  // Coin ammo quote: rounds = min(tokens, what the gunpowder pays at this gun's shot cost).
  const coinQ = useAmmoCoinQuote(ammoCoin, usdToSats(cab.pending, bsvUsd), b.ammo, slipBps, perShotAll);
  // THE FULL BLOCK: how many rounds holding the trigger for all ten minutes takes at this gun's rate, and the price
  const fullBlock = blockRounds(pattern);
  const blockNote = freePlay ? `Free play loads ${fullBlock.toLocaleString('en-US')} practice rounds: enough for the full 10:00 block.` : `A full 10:00 block at this gun's rate needs ${fullBlock.toLocaleString('en-US')} rounds, about ${fmtUsd(usdOf(fullBlock * perShotAll, bsvUsd))}.`;
  const goLive = useCallback(
    (rounds: number, continued = false) => {
      setLoadedRounds(rounds);
      setBought(firedRef.current + rounds);
      boughtRef.current = firedRef.current + rounds;
      sentRef.current = firedRef.current; // warm-up rounds were never queued
      setRun((r) => ({ ...r, sent: sentRef.current }));
      setMode('live');
      setGoAt(Date.now());
      setLoad(null);
      setOver(null);
      sfx('coin');
      if (continued) return; // play resumes on the same stage: no new banners
      // GO (the overlay below) is the "gun loaded" moment now; the stage banner follows once it has gone
      setTimeout(() => {
        // the act card first (a level that starts on the roof is already Act 2), then its first stage
        const st = (engine.current?.stageIdx ?? 0) + 1;
        pushBanner({ kind: 'act', n: actOf(st).n });
        pushBanner({ kind: 'stage', n: st });
      }, 1300);
    },
    [setMode, setRun, setLoadedRounds, setBought, setLoad, pushBanner, setOver],
  );
  /** How many rounds are being loaded (for "Loading 30,000 real rounds into your gun"), and when the load began. */
  const [loadingRounds, setLoadingRounds] = useState(0);
  const [loadStart, setLoadStart] = useState(0);
  const [loadNow, setLoadNow] = useState(0);
  const loadingNow = useRef(false);
  const lockAndLoad = async (continued = false) => {
    // One load at a time: a second START / LOCK & LOAD press while this one runs is ignored (never a second load).
    if (loadingNow.current) return loadMark('lock & load: already loading, press ignored');
    loadingNow.current = true;
    try {
      await lockAndLoadOnce(continued);
    } finally {
      loadingNow.current = false;
    }
  };
  const lockAndLoadOnce = async (continued = false) => {
    setLoadStart(performance.now());
    setLoadingRounds(0);
    setErr(null);
    if (!continued) {
      rc.resetSession();
      // a fresh attempt: back to the street, the doors open, a new song
      engine.current?.startRun();
      setKwegLost(false);
      rescuedRef.current = false;
      setRescued(false);
      skipTrack();
    }
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
      // Free play / practice: enough practice rounds to hold the trigger for the whole ten-minute block at this gun's rate
      // (plus a margin), never less than $1 would buy, no waiting. (Nothing is paid.)
      const sats = usdToSats(freePlay ? 1 : cab.creditUsd, bsvUsd) ?? 0;
      const n = Math.max(roundsFor(sats, perShotAll), blockRounds(pattern)); // practice: always enough for the full block
      setLoadingRounds(n);
      const ms = freePlay ? 300 : Number(new URLSearchParams(location.search).get('splitms') ?? 2500) || 0;
      for (const pct of [15, 30, 45, 60, 75, 90]) {
        setLoad({ kind: 'loading', pct, slowSecs: 0 });
        await new Promise((r) => setTimeout(r, ms / 6));
      }
      goLive(n, continued);
      return;
    }
    setLocking(true);
    try {
      // TERRORNODE revenue goes 50/50 to NPG Ltd and bCorp (src/lib/launch/split.ts). If their destinations can't be
      // resolved and pinned right now, no paid session starts (free practice still works); nothing goes anywhere else.
      if (!(await splitAvailable())) throw new Error('PAYUNAVAIL');
      // End the previous session first: stop its sender, release the gun's lock, save its change.
      stop.current = true;
      sessionGen.current++;
      sessionAlive.current = false;
      await b.endSession();
      if (ammoCoin) {
        // Swap on load: ONE approval buys the coin into the gun with the gunpowder (src/lib/launch/swapLoad.ts).
        if (!coinQ.quote) throw new Error(`No live $${ammoCoin.sym} quote yet. Try again in a moment.`);
        const r = await b.swapLoadCoin(ammoCoin, coinQ.quote, setCoinStatus);
        cab.onClear(); // the coins in the slot paid for the swap
        setLoad({ kind: 'loading', pct: 60, slowSecs: 0 });
        const want = Math.min(coinQ.quote.rounds, Number(r.tokens / ammoCoin.burnPer));
        setLiveCoin(ammoCoin);
        if (PER_SHOT_BURN) {
          // Off by default: per-shot token burns in lanes (one gun-signed fan-out, then the workers burn them).
          const { rounds: shots } = await b.prepareCoinStorm(ammoCoin, want, coinQ.quote.lanes);
          setLoadingRounds(shots);
          goLive(shots, continued);
          coinSession.current(shots);
          return;
        }
        // Option A: plain sats storm rounds tagged with the coin's id; the tokens are burned in bulk at session end.
        liveCoinRef.current = ammoCoin;
        setLoadingRounds(want);
        await b.prepareStorm(want, perShot, (pct, slowSecs) => setLoad({ kind: 'loading', pct, slowSecs }));
        goLive(want, continued);
        sessionRef.current(want);
        return;
      }
      setLiveCoin(null);
      liveCoinRef.current = null;
      // The REAL spendable balance (chain + the wallet's payment + our own change), never a stale number.
      // Credit already in the gun becomes the firing coin first (no wallet charge): a payment the wallet only
      // answered with a txid sits at the gun's address but not in the gun's own coin (owner, 25 Oct 2026).
      // gather() already read the chain and built the one coin: its sats ARE the balance (no second chain read).
      const t0 = performance.now();
      const avail = await b.gatherGun().catch(async (e) => {
        loadMark(`gather: ${e instanceof Error ? e.message : e}`);
        return b.refreshGun();
      });
      loadMark(`gather: ${Math.round(performance.now() - t0)} ms`);
      loadMark(`lock & load: gun has ${avail} sats`);
      const plan = planLoad({ gunSats: avail, pendingUsd: 0, roundSats: Math.ceil(perShotAll) + overheadSats(1) });
      // The same count the cabinet showed (src/lib/coinop/shots.ts): each shot = round fee + its $TERRORNODE receipt,
      // the receipt money stays in the gun until settlement.
      let shots = rc.curve ? shotsForSats(avail, perShotAll, rc.curve) : roundsFrom(avail, perShotAll, overheadSats);
      if (plan.short || shots <= 0) throw new Error('SHORT');
      const feeSats = Math.ceil(shots * perShot * fee);
      if (feeSats > 0) {
        // The platform fee is TERRORNODE revenue: two outputs, 50/50 NPG Ltd · bCorp (odd sat → bCorp), then reported
        // so each company's wallet is credited.
        const split = await fetchSplit('fee', b.gunAddress || sid);
        if (!split) throw new Error('PAYUNAVAIL');
        const [feeTx] = await b.fireBatch(0, [[GALLERY_GAME, 'fee']], splitOutputs(split, feeSats), ammo ?? DEFAULT_AMMO);
        if (feeTx) void reportSplit(feeTx, split).then((ok) => ok || console.warn(`[tb-split] fee ${feeTx} not credited yet`));
        shots = Math.max(0, Math.floor((avail - feeSats - overheadSats(shots) - rc.rangeCost(shots)) / perShot));
      }
      if (rc.live) while (shots > 0 && shots * perShot + rc.rangeCost(shots) + overheadSats(shots) > avail - feeSats) shots--;
      if (shots <= 0) throw new Error('SHORT');
      setLoadingRounds(shots);
      if (stream) await b.prepareStorm(shots, perShot, (pct, slowSecs) => setLoad({ kind: 'loading', pct, slowSecs }));
      loadMark(`loaded: ${shots} rounds`);
      goLive(shots, continued);
      if (stream) sessionRef.current(shots);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      loadMark(`load failed: ${m || 'unknown'}`);
      const have = await b.refreshGun().catch(() => 0);
      setMode('off');
      boughtRef.current = firedRef.current;
      setBought(firedRef.current);
      setLoadout(true);
      setLoad({ kind: 'failed', text: m === 'SHORT' ? 'Not enough ammo in your gun for a round. Put another coin in.' : m === 'PAYUNAVAIL' ? 'Payments temporarily unavailable. Your credit is safe in your gun; free practice still works.' : safeNote(fmtCredit(satsToUsd(have, bsvUsd))) });
    } finally {
      setLocking(false);
      setCoinStatus(null);
      // Never leave the page in warm-up after a load that did not go live: that keeps the wallet held ("A round is
      // still live on this page") with no round running (owner, 25 Oct 2026).
      if (modeRef.current === 'warm') {
        setMode('off');
        setLoadout(true);
      }
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
      setLoadNow(performance.now());
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
  // seconds left on the load, from how fast the bar has moved so far (whole seconds, never negative)
  const loadEta = (() => {
    if (warmPct <= 5 || !loadStart || loadNow < loadStart) return null;
    const el = (loadNow - loadStart) / 1000;
    return Math.max(1, Math.ceil((el * (100 - warmPct)) / warmPct));
  })();
  const loadLine = `Loading ${loadingRounds > 0 ? `${loadingRounds.toLocaleString('en-US')} ` : ''}${simulated ? 'practice' : 'real'} rounds into your gun…${loadEta != null ? ` ${loadEta} s` : ''}`;
  const packLeft = Math.max(0, bought - fired);

  // LOCK & LOAD is the bill: pay the coins (one approval), load, then lock the rounds and start by itself.
  const lockRef = useRef<(continued?: boolean) => Promise<void>>(lockAndLoad);
  useEffect(() => {
    lockRef.current = lockAndLoad;
  });
  const startCabinet = () => (freePlay || (ammoCoin && !dry) ? void lockRef.current() : cab.payThen(() => void lockRef.current()));
  // "LOCK & LOAD $0.10" with no credit (owner, 25 Oct): put the minimum in, then pay it once the total has updated.
  const [quickLoad, setQuickLoad] = useState(false);
  const onQuickLoad = (usd: number) => {
    cab.onCoin(usd);
    setQuickLoad(true);
  };
  useEffect(() => {
    if (!guestPending || !dry || !ready) return;
    void Promise.resolve().then(() => {
      setGuestPending(false);
      void lockRef.current();
    });
  }, [guestPending, dry, ready]);
  const startGuest = () => {
    unlockAudio();
    setGuest(true);
    setGuestPending(true);
    setLoadout(false);
  };
  const startRef = useRef(startCabinet);
  // START on the start card: free practice (guest), or the house free play when production runs it.
  // Phones: START also asks for real fullscreen where the browser has it (Android Chrome). iPhone Safari has no element
  // fullscreen; there the phone game-mode layout (globals.css, html[data-phone-game]) is the fullscreen.
  const phoneFullscreen = () => {
    if (!isPhone()) return;
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    try {
      void el
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
        .catch(() => undefined);
    } catch {
      /* refused: the layout still fills the screen */
    }
  };
  const startFree = () => (phoneFullscreen(), freePlayProp ? (unlockAudio(), ready ? startCabinet() : (setGuestPending(true), setLoadout(false))) : startGuest());
  useEffect(() => {
    startRef.current = startCabinet;
  });
  useEffect(() => {
    if (!quickLoad || cab.pending <= 0) return;
    void Promise.resolve().then(() => {
      setQuickLoad(false);
      startRef.current();
    });
  }, [quickLoad, cab.pending]);
  // UNLOAD from a live round (pause screen): end the round first, then unload once play has stopped.
  const unloadAfterRound = useRef(false);
  useEffect(() => {
    if (mode !== 'off' || !unloadAfterRound.current) return;
    unloadAfterRound.current = false;
    void b.unload();
  }, [mode, b]);

  // ONE shot count for every "buys N shots" (coin labels, TO PAY, the receipt line, CONTINUE) and LOCK & LOAD.
  const buys = (usd: number) => shotsForUsd(usd, cab.bsvUsd ?? null, perShotAll, rc.curve);

  // ── FLATLINED: health at zero ──
  useEffect(() => {
    diedRef.current = () => {
      held.current = false;
      simRef.current.on = false;
      minigun(false);
      flatRef.current = true;
      setLocked(false);
      const st = statsRef.current;
      setFlat({ fired: firedRef.current, score: st?.score ?? 0, wave: st?.stage ?? 1, kills: st?.kills ?? 0, secs: run.started ? Math.max(1, Math.round((Date.now() - run.started) / 1000)) : 0 });
    };
  });
  /** CONTINUE: the coins on the death screen were paid in ONE approval. Health resets, the new rounds ADD to what is loaded, play resumes. */
  const resumeAfterPay = async (paidUsd: number) => {
    const remaining = Math.max(0, boughtRef.current - firedRef.current);
    flatRef.current = false;
    setFlat(null);
    engine.current?.revive();
    if (dry || freePlay) {
      const extra = freePlay ? blockRounds(pattern) : roundsFor(usdToSats(paidUsd, bsvUsd) ?? 0, perShotAll);
      goLive(remaining + extra, true);
      return;
    }
    // live: let the rounds already fired finish sending, then load everything in the gun (what was left plus the new coins)
    setMode('off');
    boughtRef.current = firedRef.current;
    setBought(firedRef.current);
    for (let i = 0; i < 40 && sentRef.current < firedRef.current; i++) await new Promise((r) => setTimeout(r, 250));
    await lockRef.current(true);
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
  // CREDIT COUNTDOWN (owner, 25 Oct): while live the credit ticks down round by round, to the micro-dollar. Paid:
  // the rounds not yet sent are what is left (real spend is rounds sent x cost). Practice: rounds not yet fired,
  // at the same cost, so it looks the same and still claims nothing on chain. It agrees with "rounds left".
  const creditLive = mode === 'live' ? { usd: usdOf(Math.max(0, bought - (simulated ? fired : run.sent)) * (perShotAll + (rc.live && rc.q ? (rc.q.nextPriceSats ?? 0) : 0)), bsvUsd), practice: simulated } : null;

  const outMsg = freePlay ? 'Out of practice rounds. Press LOADOUT and LOCK & LOAD for more.' : 'Out of rounds. Press LOADOUT and put another coin in.';
  const hint = mode === 'warm' ? 'WARM-UP SHOTS (not live) while your ammo loads. Nothing can hurt you yet. WASD to move, click to mouse-look.' : (stall ?? (packLeft <= 0 ? outMsg : `${simulated ? 'PRACTICE ROUNDS' : patternLabel(pattern)} · ${coarse ? 'HOLD FIRE. Left thumb: move · right thumb: aim.' : 'HOLD to fire (or SPACE). WASD move · mouse-look · ← → turn.'}`));
  const toBoard = () => {
    setOver(null);
    setLoadout(true);
    window.location.assign(INFO_URL);
  };

  // While JAMMED, R reloads the sender (works while pointer-locked, where no button can be clicked).
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || e.repeat || loadout) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((jammed || notSending) && modeRef.current === 'live') void reloadRef.current();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [loadout, jammed, notSending]);

  // PAUSE (owner, 25 Oct 2026): P or Esc, or the on-screen button. Freezes the world and the round sender: nothing
  // is fired or broadcast while paused. RESUME carries on with the same loaded rounds, no new payment.
  const togglePause = useCallback(() => {
    if (modeRef.current !== 'live' || loadout) return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    held.current = false;
    if (engine.current) engine.current.paused = next;
    if (next) document.exitPointerLock?.();
    setPaused(next);
    loadMark(next ? 'paused' : 'resumed');
  }, [loadout]);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat || (e.code !== 'KeyP' && e.code !== 'Escape')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.code === 'Escape' && !pausedRef.current && modeRef.current !== 'live') return;
      togglePause();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [togglePause]);
  // Leaving live play (LOADOUT, round over) always unpauses.
  useEffect(() => {
    if (mode === 'live' && !loadout) return;
    pausedRef.current = false;
    if (engine.current) engine.current.paused = false;
    void Promise.resolve().then(() => setPaused(false));
  }, [mode, loadout]);

  // No key scrolls the page while you play (owner, 25 Oct): swallow the scroll keys unless you are typing.
  useEffect(() => {
    const SCROLL = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);
    const kd = (e: KeyboardEvent) => {
      if (!SCROLL.has(e.code) && !SCROLL.has(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.code === 'Space' && t?.closest('button, a, [role="button"]') && loadout) return; // SPACE still presses a focused button on the loadout
      e.preventDefault();
    };
    window.addEventListener('keydown', kd, { capture: true });
    return () => window.removeEventListener('keydown', kd, { capture: true });
  }, [loadout]);

  // PHONE GAME MODE (owner, 27 Oct 2026): a phone on its side is full screen as soon as it is turned, before START too
  // (the loadout scrolls inside the stage, so team, wallet and LOCK & LOAD stay reachable). The stage is
  // fixed over the whole viewport and every bit of page chrome is hidden (globals.css, html[data-phone-game]).
  // Turning the phone upright mid-round pauses (the rotate prompt covers it); back on its side resumes.
  // Phones outside bWallet: "Play in bWallet (full screen)" leads; "Play here anyway" reveals START (owner, 27 Oct).
  const playInBwallet = usePlayInBwallet();
  const [playHere, setPlayHere] = useState(false);
  const [phoneLand, setPhoneLand] = useState(false);
  const [phoneUp, setPhoneUp] = useState(false);
  useEffect(() => {
    if (!isPhone()) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const on = () => (setPhoneLand(mq.matches), setPhoneUp(!mq.matches));
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const inPlay = !loadout && !over;
  const gameMode = phoneLand;
  useEffect(() => {
    const h = document.documentElement;
    if (gameMode) {
      h.dataset.phoneGame = '1';
      window.scrollTo(0, 0);
    }
    else delete h.dataset.phoneGame;
    return () => void delete h.dataset.phoneGame;
  }, [gameMode]);
  const npgCardsProp = npgCards.enabled ? { checking: npgCards.checking, checked: npgCards.checked, check: () => void npgCards.checkWallet(), error: npgCards.error } : null;
  const charSelect = <CharacterSelect pick={girlPick} setPick={setGirlPick} owned={npgCards.owned} cards={npgCardsProp} />;
  const charStrip = <CharacterSelect compact pick={girlPick} setPick={setGirlPick} owned={npgCards.owned} cards={npgCardsProp} />;
  // Act title cards on a phone: the HUD dims while a card shows (globals.css, html[data-act-card]) so nothing overlaps.
  const actCard = inPlay && (bannerCur?.kind === 'act' || bannerCur?.kind === 'freed');
  useEffect(() => {
    const h = document.documentElement;
    if (actCard) h.dataset.actCard = '1';
    else delete h.dataset.actCard;
    return () => void delete h.dataset.actCard;
  }, [actCard]);
  useEffect(() => {
    if (inPlay) return;
    if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined);
  }, [inPlay]);
  const rotatePaused = useRef(false);
  useEffect(() => {
    if (!inPlay) {
      rotatePaused.current = false;
      return;
    }
    if (phoneUp && !pausedRef.current && modeRef.current === 'live') {
      rotatePaused.current = true;
      togglePause();
    } else if (!phoneUp && rotatePaused.current) {
      rotatePaused.current = false;
      if (pausedRef.current) togglePause();
    }
  }, [phoneUp, inPlay, togglePause]);

  return (
    <div className={`game-root flex flex-col gap-3 ${drFontClass} ${tbxFontClass}`}>
      <GameAudio track="terror" />
      <RotatePrompt />
      {lost && (
        <button type="button" onClick={() => location.reload()} className="fixed inset-0 z-[999] flex items-center justify-center bg-[#03070c] text-lg font-bold tracking-[0.08em] text-[#e8f1f6]" data-context-lost>
          Tap to reload
        </button>
      )}
      <section className="game-stage panel relative overflow-hidden p-0" style={{ background: '#04080d' }}>
        <canvas ref={canvas} className="block h-full min-h-[420px] w-full touch-none select-none" style={{ cursor: 'none' }} aria-label="Shooting Gallery: hold to fire" />
        <div ref={reticle} className="pointer-events-none absolute left-0 top-0 h-11 w-11" aria-hidden data-reticle>
          <svg viewBox="0 0 44 44" className="h-full w-full" style={{ filter: 'drop-shadow(0 0 4px rgba(0,0,0,.95)) drop-shadow(0 0 6px rgba(63,216,232,.5))' }}>
            <path d="M22 5a17 17 0 0117 17M39 22a17 17 0 01-17 17M22 39A17 17 0 015 22M5 22A17 17 0 0122 5" fill="none" stroke="#e8f1f6" strokeWidth="1.6" strokeDasharray="14 12.6" strokeLinecap="round" />
            <path d="M22 1v7M22 36v7M1 22h7M36 22h7" stroke="#3fd8e8" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="22" cy="22" r="1.8" fill="#ff3b3b" />
          </svg>
        </div>
        {/* The city builds quietly behind the loadout; this only shows if play starts before it's ready (owner, 24 Oct). */}
        {!ready && (
          // The game art shows at once (no black void) while WebGL and the city load behind it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/hero/assault.jpg" alt="" aria-hidden fetchPriority="high" className="pointer-events-none absolute inset-0 z-[4] h-full w-full object-cover" data-poster />
        )}
        {!ready && !loadout && (
          <div className="absolute inset-0 z-[5] grid place-items-center bg-[#03070c]/45">
            <div className="tbx-glass tbx-pop w-[min(300px,80vw)] p-4 text-center">
              <p className="tbx-eyebrow mb-3 flex items-center justify-center gap-2" style={{ color: 'var(--tbx-teal)' }}>
                <Icon name="chip" size={14} /> Building Neo-Tokyo
              </p>
              {guestPending && <p className="mb-2 text-xs font-bold tracking-[0.2em] text-[var(--tbx-amber)]">FREE PRACTICE · STARTS BY ITSELF</p>}
              <div className="tbx-bar">
                <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
              </div>
              <p className="mt-2 text-xs text-[var(--tbx-dim)] tbx-num">{Math.round(progress * 100)}%</p>
            </div>
          </div>
        )}

        {/* Touch: the left side is a virtual stick (it appears under your thumb), the right side drags the view and fires. */}
        <div ref={stickRef} className="pointer-events-none absolute z-10 hidden h-[104px] w-[104px] rounded-full border-2 border-white/30 bg-black/30" aria-hidden data-move-stick>
          <div ref={knobRef} className="absolute left-[30px] top-[30px] h-11 w-11 rounded-full bg-[var(--tbx-teal)]/60" />
        </div>
        {!loadout && !over && !rescued && (
          <p className="pointer-events-none absolute bottom-[104px] left-3 z-10 text-[10px] font-bold tracking-[0.18em] text-white/50 sm:hidden" data-touch-help>
            LEFT: MOVE · RIGHT: LOOK + FIRE
          </p>
        )}
                {!loadout && !over && <AmmoColumn left={packLeft} loaded={Math.max(loadedRounds, packLeft)} />}
        {!loadout && !over && !simulated && <OnChainPanel accepted={run.sent} tps={run.tps} feed={feed} simulated={false} />}
        {/* INSERT $b is the attract screen (owner, 25 Oct): only while nobody is playing and there is no credit, never over a
            game in progress. In paid play the cabinet's INSERT $b heading does this job, so this overlay is free play only. */}
        {!loadout && !over && simulated && mode === 'off' && !guestPending && ready && (
          <div className="pointer-events-none absolute inset-x-0 top-[18%] z-10 flex flex-col items-center px-4 text-center" data-insert-coin>
            {/* the button: no wallet → connect one; with a wallet → back to the cabinet to put a coin in */}
            <style>{`@keyframes tbx-coin-blink{0%,49%{opacity:1}50%,100%{opacity:.12}}@media (prefers-reduced-motion:reduce){[data-insert-coin] button{animation:none!important}}`}</style>
            <button
              type="button"
              onClick={() => (guest ? startGuest() : barWallet ? setLoadout(true) : b.setChooser({ note: 'Connect a wallet to put a coin in.' }))}
              className="pointer-events-auto cursor-pointer rounded-md bg-black/70 px-5 py-2 font-black tracking-[0.12em] text-[var(--tbx-red)] ring-2 ring-[var(--tbx-red)]/70 backdrop-blur-sm"
              style={{ fontSize: 'clamp(40px, 9vw, 112px)', lineHeight: 1, textShadow: '0 0 18px rgba(255,59,48,.6), 0 3px 0 #000', animation: 'tbx-coin-blink 1.1s steps(1) infinite' }}
            >
              INSERT $b
            </button>
            <span className="mt-2 rounded bg-black/70 px-3 py-1 text-xs font-bold tracking-[0.25em] text-white sm:text-sm">
              {barWallet ? 'PRACTICE ROUNDS · NOTHING ON CHAIN' : 'CONNECT WALLET · PRACTICE ROUNDS · NOTHING ON CHAIN'}
            </span>
          </div>
        )}
        {!loadout && !over && simulated && (
          <div className="tbx-glass pointer-events-none absolute bottom-[150px] right-1.5 z-10 px-3 [@media(pointer:coarse)]:hidden py-1.5 text-[10px] font-bold tracking-[0.2em] text-[var(--tbx-amber)] sm:bottom-[88px] sm:right-3" data-practice-badge>
            {PRACTICE.badge.toUpperCase()}
          </div>
        )}
        {stall && !loadout && !over && (
          <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 flex justify-center px-4">
            <p className="tbx-glass tbx-pop flex max-w-[560px] items-center gap-2 px-4 py-2.5 text-center text-base font-semibold" style={{ borderColor: 'var(--tbx-red)' }} role="status">
              <Icon name="bullet" size={18} className="shrink-0 text-[var(--tbx-red)]" /> {stall}
            </p>
          </div>
        )}
        {((cab.stage === 'approve' && !freePlay) || load?.kind === 'failed') && (
          <LoadingScreen
            title={GAME_TITLE}
            kicker={GAME_KICKER}
            setting={`${SETTING} · ${CREDIT}`}
            shots={LOADING_SHOTS}
            track="terror"
            lore={simulated ? LORE.map((l) => ({ ...l, line: forPractice(l.line) })) : LORE}
            characters={CHARACTERS}
            tips={simulated ? TIPS.map(forPractice) : TIPS}
            state={load?.kind === 'failed' ? load : { kind: 'approve' }}
          />
        )}
        {(mode === 'warm' || cab.stage === 'loading') && !loadout && !over && (
          <div className="tbx-in-d pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4" role="status" data-warmup>
            {/* Big and centred (owner, 25 Oct: "the LOADING YOUR AMMO bar needs to be a lot bigger"). */}
            <div className="tbx-glass w-full max-w-[880px] px-6 py-6 sm:px-10 sm:py-8">
              <div className="flex items-baseline justify-between gap-4">
                <span className="tbx-display flex items-center gap-3 text-[clamp(22px,4.2vw,48px)] leading-none text-white">
                  <Icon name="chip" size={34} className="shrink-0 text-[var(--tbx-teal)]" /> LOADING YOUR AMMO
                </span>
                <Ticker value={warmPct} format={(n) => `${Math.round(n)}%`} className="tbx-display tbx-num text-[clamp(28px,5vw,60px)] leading-none text-[var(--tbx-teal)]" />
              </div>
              <div className="tbx-bar mt-5 !h-5 sm:!h-7">
                <i style={{ transform: `scaleX(${warmPct / 100})`, transition: 'transform 0.25s linear' }} />
              </div>
              <p className="tbx-num mt-4 text-[clamp(15px,2vw,22px)] font-semibold text-white" data-load-line>{loadLine}</p>
              <p className="mt-1.5 text-sm text-white/70 sm:text-base">{mode === 'warm' ? 'Warm-up shots while you wait (not live). No enemies until GO.' : 'No enemies until GO.'}</p>
            </div>
          </div>
        )}
        {goAt > 0 && !loadout && !over && (
          <div className="pointer-events-none absolute inset-x-0 top-[38%] z-30 flex flex-col items-center" role="status" data-go>
            <p className="tbx-display tbx-pop text-[clamp(72px,16vw,180px)] leading-none text-[var(--tbx-teal)]" style={{ textShadow: '0 0 50px rgba(63,216,232,.6), 0 6px 40px rgba(0,0,0,.85)' }}>
              GO
            </p>
            <p className="mt-1 rounded bg-black/70 px-3 py-1 text-xs font-bold tracking-[0.25em] text-white">{simulated ? 'PRACTICE ROUNDS LIVE' : 'REAL ROUNDS LIVE'}</p>
          </div>
        )}
        {!loadout && !over && <BannerStage item={bannerCur} practice={simulated} />}
        {rescued && !over && <RescuedBeat />}
        {kwegLost && !over && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 px-4 text-center" role="alertdialog" aria-label={KWEG_LOST.top} data-kweg-lost>
            <p className="tbx-display tbx-pop text-[clamp(30px,7vw,84px)] leading-none text-[var(--tbx-red)]" style={{ textShadow: '0 0 40px rgba(232,38,29,.6)' }}>
              {KWEG_LOST.top}
            </p>
            <p className="mt-3 max-w-md text-sm text-white/85">{KWEG_LOST.sub}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="rounded-full bg-[var(--tbx-red)] px-5 py-2.5 text-sm font-black tracking-[0.18em] text-white"
                onClick={() => {
                  setKwegLost(false);
                  engine.current?.startRun(true);
                  pushBanner({ kind: 'act', n: 2 });
                  pushBanner({ kind: 'stage', n: 4 });
                }}
                data-kweg-retry
              >
                {KWEG_LOST.retry}
              </button>
              <button type="button" className="tbx-glass rounded-full px-5 py-2.5 text-sm font-bold tracking-[0.18em] text-white" onClick={() => (setKwegLost(false), finishRef.current())}>
                RESULTS
              </button>
            </div>
          </div>
        )}
        {queueNote && !simulated && !loadout && !jammed && !over && (
          <div className="tbx-glass pointer-events-none absolute bottom-[96px] left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-white/85" role="status">
            Rounds are queueing, the network is catching up.
          </div>
        )}
        {/* JAMMED: a small screen-fixed toast, never a modal (owner, 25 Oct: the old box could not be reached while
            pointer-locked and stayed after the gun recovered). R reloads from the keyboard; ESC frees the mouse. */}
        {jammed && mode === 'live' && !loadout && !over && (
          <div className="pointer-events-none fixed inset-x-0 top-[72px] z-[60] flex justify-center px-4" role="status" aria-live="polite" data-jam-toast>
            <div className="tbx-glass tbx-pop pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 text-sm" style={{ borderColor: 'var(--tbx-red)' }}>
              <Icon name="refresh" size={16} className="shrink-0 text-[var(--tbx-red)]" />
              <span className="font-semibold text-white">No rounds getting through. Your rounds are safe.</span>
              <button type="button" data-fs-skip onClick={() => void reloadRef.current()} className="tbx-btn tbx-btn-red !min-h-[32px] !px-3 !py-1 !text-xs">
                RELOAD <kbd className="ml-1 rounded bg-black/40 px-1 font-mono">R</kbd>
              </button>
            </div>
          </div>
        )}
        {load?.kind === 'failed' && (
          <Modal title="Loading stopped" tone="bad" action="Back to lock & load" onAction={() => setLoad(null)}>
            {load.text}
          </Modal>
        )}
        <CabinetModals modal={cab.modal} setModal={cab.setModal} reconnect={cab.reconnect} cancel={cab.cancel} retry={cab.retry} giveUp={cab.giveUp} approving={cab.stage === 'approve'} approveSince={cab.approveSince} walletName={cab.walletName} error={cab.err} />

        {!loadout && !over && mode === 'live' && !dry && <LiveTxBadge last={run.last} sent={run.sent} seen={netSeen} />}
        {!loadout && !over && <DamageFx ref={dmgFx} hp={hud?.hp ?? TUNING.player.hp} hpMax={hud?.hpMax ?? TUNING.player.hp} />}
        {!loadout && !over && (
          <Hud
            dry={dry}
            fired={mode === 'live' ? fired : run.sent}
            sent={run.sent}
            weaponName={weapon.name}
            ammo={ammo ?? DEFAULT_AMMO}
            creditUsd={cab.creditUsd}
            live={creditLive}
            receipts={rc.live && rc.q ? { earned: rc.earned, priceSats: rc.q.nextPriceSats ?? 0 } : null}
            tps={run.tps}
            spent={simulated ? '$0.00' : fmtUsd(usdOf(spent, bsvUsd))}
            stats={hud}
            handle={handle}
            packLeft={packLeft}
            freePlay={freePlay}
            bossName="THE LIQUID UNIT"
            bossNote="Fire to push it back; stop and it closes in."
            stageNote={stageBrief(hud?.stage ?? 1).goal}
          />
        )}
        {!loadout && !over && girlName && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={girlImg(girlPick.girl)} alt={girlName} title={girlName} className="pointer-events-none absolute bottom-2 left-2 z-20 h-16 w-auto opacity-90 drop-shadow sm:h-24" data-hud-girl={girlPick.girl} />
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

        {/* FLATLINED: the CONTINUE? countdown (INSERT $b, or GAME OVER) */}
        {flat && !over && (
          <Flatlined
            stats={flat}
            pendingUsd={cab.pending}
            buys={buys}
            rounds={buys(cab.pending) ?? 0}
            hold={cab.stage === 'approve' || cab.stage === 'loading' || locking || cab.modal !== null}
            onCoin={cab.onCoin}
            onClear={cab.onClear}
            onContinue={() => (freePlay ? void resumeAfterPay(1) : cab.payThen(() => void resumeAfterPay(cab.pending)))}
            onGameOver={() => finishRef.current()}
            walletName={cab.walletName}
            freePlay={freePlay}
          />
        )}

        {/* GAME OVER */}
        {over && <Results r={over} onAgain={() => (setOver(null), setLoadout(true))} onBoard={toBoard} />}
        {levelClear && !over && (
          <LevelClear
            id={levelClear.id}
            score={levelClear.score}
            rounds={levelClear.rounds}
            best={levels.best[levelClear.id]?.score ?? levelClear.score}
            onNext={(nx) => {
              setLevelClear(null);
              pickLevel(nx);
              skipTrack();
            }}
            onLevels={() => (setLevelClear(null), setLoadout(true))}
          />
        )}
        {over && rc.note && (
          <p className="tbx-glass absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-[var(--tbx-teal)]" role="status" data-receipt-sent>
            {rc.note}
          </p>
        )}

        {/* NOT SENDING: rounds queued, nothing reaching the network (always on screen, never only in the console) */}
        {notSending && mode === 'live' && !paused && (
          <p className="tbx-glass absolute left-1/2 top-16 z-40 max-w-[92%] -translate-x-1/2 rounded px-4 py-2 text-center text-xs text-[#ffb3b3]" role="alert" data-not-sending>
            {notSending}
          </p>
        )}

        {/* UNLOAD on the attract screen (owner, 25 Oct): nobody playing, the gun holds credit */}
        {!loadout && !over && mode === 'off' && !dry && !freePlay && cab.creditReady && (
          <div className="tbx-glass absolute right-3 top-3 z-40 rounded-lg px-2 py-1.5" data-attract-unload>
            <UnloadButton b={b} creditUsd={cab.creditUsd} />
          </div>
        )}
        {/* CALL KWEG (touch; C or E on a keyboard, or click him): Dr Kweg sprints back to you. */}
        {mode !== 'off' && !loadout && !over && !paused && !flat && !kwegLost && hud?.kwegOn && (
          <button
            type="button"
            aria-label="Call Dr Kweg back"
            className="absolute bottom-[calc(190px+env(safe-area-inset-bottom))] right-[112px] z-30 grid h-[64px] w-[64px] touch-none select-none place-items-center rounded-full border-2 border-[var(--tbx-gold,#ffc21a)] bg-black/45 text-[10px] font-black leading-tight tracking-[0.12em] text-white backdrop-blur-sm active:bg-[#ffc21a]/50 [@media(pointer:fine)]:hidden"
            onPointerDown={(e) => (e.preventDefault(), e.stopPropagation(), engine.current?.callKweg())}
            data-call-kweg
          >
            CALL
            <br />
            KWEG
          </button>
        )}
        {/* FIRE (touch): hold to fire. The right half of the screen still drags the view and fires too. */}
        {mode !== 'off' && !loadout && !over && !paused && !flat && (
          <button
            type="button"
            aria-label="Fire (hold)"
            className="absolute bottom-[calc(178px+env(safe-area-inset-bottom))] right-4 z-30 grid h-[88px] w-[88px] touch-none select-none place-items-center rounded-full border-2 border-[var(--tbx-red)] bg-[var(--tbx-red)]/35 text-sm font-black tracking-[0.18em] text-white shadow-[0_0_24px_rgba(232,38,29,.55)] backdrop-blur-sm active:bg-[var(--tbx-red)]/70 [@media(pointer:fine)]:hidden"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
              } catch {
                /* capture is a nicety */
              }
              engine.current?.setTrigger(true);
            }}
            onPointerUp={(e) => (e.stopPropagation(), engine.current?.setTrigger(false))}
            onPointerCancel={() => engine.current?.setTrigger(false)}
            onContextMenu={(e) => e.preventDefault()}
            data-fire
          >
            FIRE
          </button>
        )}
        {/* PAUSE button (works on phones) */}
        {mode === 'live' && !loadout && !over && (
          <button
            type="button"
            onClick={togglePause}
            className="tbx-glass absolute right-3 top-3 z-40 rounded-full px-3 py-1.5 text-xs font-bold tracking-widest text-white [@media(pointer:coarse)]:bottom-[calc(278px+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:right-5 [@media(pointer:coarse)]:top-auto [@media(pointer:coarse)]:py-2.5"
            aria-label={paused ? 'Resume' : 'Pause'}
            data-pause
          >
            {paused ? '▶ RESUME' : 'II PAUSE'}
          </button>
        )}

        {/* PAUSED: the world and the round sender are frozen; nothing is fired or broadcast */}
        {paused && mode === 'live' && !loadout && !over && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-label="Paused" data-paused>
            <div className="tbx-glass flex w-[min(92%,360px)] flex-col gap-3 rounded-lg p-5 text-center text-white">
              <p className="text-lg font-bold tracking-[0.3em]">PAUSED</p>
              <p className="text-xs text-white/80">
                Loaded {bought.toLocaleString('en-US')} rounds · {packLeft.toLocaleString('en-US')} left
                {creditLive ? ` · credit ${fmtUsd(creditLive.usd)}${creditLive.practice ? ' (practice)' : ''}` : ''}
              </p>
              <p className="text-xs text-white/60">Nothing is fired or sent while paused. Resume uses the same rounds: no new payment.</p>
              <button type="button" onClick={togglePause} className="btn btn-on px-4 py-2 font-bold tracking-widest">
                RESUME
              </button>
              {cab.creditUsd > 0 || b.gunTokens.length ? (
                <UnloadButton
                  b={b}
                  creditUsd={cab.creditUsd}
                  live
                  endRound={() => {
                    unloadAfterRound.current = true; // runs once the round has stopped (mode 'off')
                    togglePause();
                    setLoadout(true); // ends live fire; the rest stays as credit
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    togglePause();
                    setLoadout(true);
                  }}
                  className="btn px-4 py-2 text-xs font-bold tracking-widest"
                >
                  END ROUND
                </button>
              )}
              <p className="text-[10px] text-white/50">P or Esc to resume</p>
            </div>
          </div>
        )}

        {/* LOADOUT */}
        {loadout && !over && (
          <Loadout
            start={
              <>
              {!phoneLand && charSelect}
              <section className="tbx-glass relative overflow-hidden rounded-xl p-0" data-start-card>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/hero/assault.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-70" />
                {phoneLand && <div className="absolute left-3 top-2 z-[1]">{charStrip}</div>}
                <div className="relative flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/55 to-black/10 p-4 pt-24 sm:flex-row sm:items-end sm:justify-between sm:p-6 sm:pt-32" data-start-body>
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.24em] text-[var(--tbx-amber)]">{freePlay ? 'FREE PRACTICE · NO WALLET · NOTHING ON CHAIN' : 'NEW HERE? PLAY FREE FIRST'}</p>
                    <p className="mt-1 max-w-[440px] text-sm text-white/85" data-start-copy>Practice rounds are simulated: nothing is paid, signed or broadcast. Pick PAID ROUNDS later to fire real BSV transactions.</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    {playInBwallet && !playHere ? (
                      <>
                        <PlayInBwalletButton />
                        <button type="button" onClick={() => setPlayHere(true)} className="text-xs font-bold tracking-[0.18em] text-white/70 underline underline-offset-4" data-play-here>
                          Play here anyway
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={startFree} className="lock-load min-h-[72px] w-full rounded-lg bg-[var(--tbx-red)] px-6 py-2 text-2xl sm:px-10 sm:text-3xl font-black tracking-[0.14em] text-white sm:w-auto" data-play-free>
                        ▶ {CTA} <span className="block text-[11px] font-bold tracking-[0.3em] text-white/85">FREE PRACTICE · NO WALLET</span>
                      </button>
                    )}
                    {guest && !freePlayProp && (
                      <button type="button" onClick={() => setGuest(false)} className="text-xs font-bold tracking-[0.18em] text-[var(--tbx-teal)] underline underline-offset-4" data-go-paid>
                        PAID ROUNDS INSTEAD (LOCK &amp; LOAD, NEEDS A WALLET)
                      </button>
                    )}
                    {!guest && !freePlayProp && <p className="text-[11px] tracking-[0.14em] text-white/60">PAID ROUNDS: LOCK &amp; LOAD BELOW</p>}
                  </div>
                </div>
              </section>
              </>
            }
            levels={<LevelSelect progress={levels} active={levelId} onPick={(id) => (setLevelClear(null), pickLevel(id))} />}
            weapons={weapons}
            weaponId={weaponId}
            setWeaponId={setWeaponId}
            canUse={canUse}
            practice={simulated}
            rounds={packLeft}
            paymail={paymail}
            player={
              <PlayerPanel
                freePlay={freePlay}
                free={free}
                fee={fee}
                bsvUsd={bsvUsd}
                credit={fmtCredit(cab.creditUsd)}
                gunAddress={b.gunAddress}
                packLeft={packLeft}
                ordnance={b.wallet ? { checking: ordnance.checking, checked: ordnance.walletChecked, check: () => void ordnance.checkWallet(), idle: mode === 'off' } : null}
                error={cab.modal ? null : (err ?? b.error)}
                unload={<GunUnload b={b} disabled={mode !== 'off'} className="mt-1" />}
              />
            }
            cabinet={
              <>
              {COIN_AMMO_UI && <AmmoCoinPick chosen={ammoCoin} setChosen={setAmmoCoin} payUsd={cab.pending} quote={coinQ.quote} quoteErr={coinQ.err} slippageBps={slipBps} setSlippageBps={setSlipBps} status={coinStatus} disabled={locking} />}
              {rc.live && rc.q && (
                <p className="tbx-glass mb-2 rounded px-3 py-2 text-xs text-white/85" data-receipt-line>
                  Each shot: {satsWord(Math.ceil(perShotAll))} fee + {satsWord(rc.q.nextPriceSats ?? 0)} for 1 $TERRORNODE receipt (rises from 1 to 200 sats as receipts sell).
                  {!rc.q.graduated && rc.q.graduateAt != null && ` ${rc.q.issued.toLocaleString('en-US')} / ${(rc.q.graduateAt / 1e6).toLocaleString('en-US')}M shots to graduation.`}
                  {cab.pending > 0 && buys(cab.pending) != null && ` ${fmtCredit(cab.pending)} buys about ${(buys(cab.pending) ?? 0).toLocaleString('en-US')} shots now.`}
                </p>
              )}
              {rc.allEarned && <p className="tbx-glass mb-2 rounded px-3 py-2 text-xs text-white/85" data-receipt-line>All $TERRORNODE earned: every receipt is issued. Play on.</p>}
              {rc.note && <p className="mb-2 text-xs text-[var(--tbx-teal)]" data-receipt-note>{rc.note}</p>}
              <CoinCabinet
                title="Shooting Gallery"
                creditUsd={cab.creditUsd}
                creditReady={cab.creditReady}
                pendingUsd={cab.pending}
                bsvUsd={cab.bsvUsd}
                onCoin={cab.onCoin}
                onClear={cab.onClear}
                stage={cab.stage}
                stageText={cab.stageText}
                name={name}
                hasPaymail={hasPaymail}
                priceUsd={satsToUsd(perShotAll, bsvUsd)}
                priceNote={`Rounds at cost price${fee ? `, plus a ${Math.round(fee * 100)}% fee` : ', no extra charge'}. ${blockNote} ${dry ? 'Free play: nothing is paid, broadcast or spent.' : free ? 'No platform fee until 1 Nov: you only pay for your rounds.' : ''}${dry ? '' : ` Receipts${fee ? ' and fee' : ''} ${SPLIT_LINE}.`}`}
                buys={buys}
                unit="shots"
                startLabel={ready ? 'Lock & load' : 'Loading…'}
                onStart={startCabinet}
                starting={locking}
                blocked={!ready || !ammo || !canUse(weapon)}
                // The friendly modal says it already: don't print the raw wallet error behind it.
                error={cab.modal ? null : (err ?? cab.err)}
                note={cab.pending <= 0 && b.ammo > 0 && !dry ? leftoverNote(fmtCredit(cab.creditUsd)) : null}
                walletLive={cab.walletLive}
                freePlay={freePlay}
                walletName={cab.walletName}
                onQuickLoad={dry || freePlay ? undefined : onQuickLoad}
                unload={!dry && !freePlay && cab.creditReady ? <UnloadButton b={b} creditUsd={cab.creditUsd} /> : null}
              />
              </>
            }
          />
        )}
      </section>

      <SiteWalletChooser />
    </div>
  );
}
