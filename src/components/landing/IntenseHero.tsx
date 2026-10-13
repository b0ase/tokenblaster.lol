'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Barcode } from '@/components/dr';
import { PreviewButton } from '@/components/PreviewButton';
import { tokenMeta } from '@/lib/tokenMeta';
import { ClipDeck, type DeckApi } from './ClipDeck';
import { CutTitle, WORDMARK, type Phrase, type TitleApi } from './CutTitle';
import { SignalGrain, type GrainApi } from './SignalGrain';
import { hit, setHits, useHits } from './hits';
import { useChainPulse, type PulseEvent, type PulseSnap } from './useChainPulse';
import type { Clip } from './clips';
import './landing.css';

/** The headline cycle. Flat copy in TokenBlaster's voice: the chain is real, the fees are real, the bullets are real. */
const PHRASES: Phrase[] = [
  { parts: ['Load your tokens', { hot: '.' }] },
  { parts: ['Blast the chain', { hot: '.' }] },
  WORDMARK,
  { parts: ['Every bullet ', { hot: '= 1 real tx' }] },
  { parts: [{ hot: 'No' }, ' fake coins'] },
  { parts: ['Live on ', { hot: 'mainnet' }] },
  { parts: ['Own your ', { hot: 'guns' }] },
  { parts: [{ hot: '1 sat' }, ' per hop'] },
  WORDMARK,
  { parts: ['Play the ', { hot: 'arcade' }] },
];
/** Sticker slogans slammed in now and then (and on cue from the chain). */
const SLOGANS = ['Every bullet = 1 real tx', 'No fake coins', 'Live on mainnet', 'Fees are real', 'BSV-21 ammo', 'Own your guns', 'Play the arcade', 'Blast the chain', 'Load your tokens', 'One wallet, every game', 'Mined, not minted'];

type Slam = { id: number; text: string; sub?: string; ink: 'amber' | 'red' | 'paper' | 'ink'; x: number; y: number; ang: number; size: number; haz?: boolean; seed?: string };
type Flash = { id: number; pos: 'tr' | 'mr' | 'br' | 'tl'; rows: { k: string; v: string; cls?: string }[] };
type Block = { id: number; height: number };

const RM = '(prefers-reduced-motion: reduce)';
type Conn = { saveData?: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia(RM);
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  mq.addEventListener('change', cb);
  conn?.addEventListener?.('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
    conn?.removeEventListener?.('change', cb);
  };
};
/** Motion allowed? Not under reduced motion or Save-Data. Server snapshot false: SSR paints the poster. */
const motionSnapshot = () => !window.matchMedia(RM).matches && !(navigator as Navigator & { connection?: Conn }).connection?.saveData;
const motionServer = () => false;

const fmtSats = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 2)} BSV` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);
const fmtBsv = (bsv: number) => (bsv >= 100 ? bsv.toFixed(0) : bsv >= 10 ? bsv.toFixed(1) : bsv.toFixed(2));
const r = (a: number, b: number) => a + Math.random() * (b - a);
const wide = () => typeof window !== 'undefined' && window.innerWidth >= 1024;

/** Readouts for the corner flashes, from the pulse. */
function statRows(s: PulseSnap): Flash['rows'][number][] {
  const live = s.status === 'live';
  return [
    { k: 'TX / SEC', v: live ? s.rate.toFixed(1) : '--', cls: 'hot' },
    { k: 'SATS · 10S', v: live ? fmtSats(s.sats10) : '--' },
    { k: 'BLOCK', v: s.height ? s.height.toLocaleString() : '--', cls: 'amber' },
    { k: 'MEMPOOL · SEEN', v: live ? s.mempool.toLocaleString() : '--' },
    { k: 'BYTES · 10S', v: live ? fmtBytes(s.bytes10) : '--' },
    { k: 'TX · SESSION', v: live ? s.total.toLocaleString() : '--', cls: 'hot' },
  ];
}

/**
 * The landing hero mix. Live mainnet is the beat: the footage deck (ClipDeck) cuts faster as the tx rate climbs, a big
 * move (1 BSV+ / 40 KB+) is a hard cut with a white frame and a sticker slam, a token transfer or a blast slams its
 * own sticker, a new block drops the picture to void then sweeps a hazard wipe and the height across the frame.
 * Over the clips: signal grain whose density follows the rate (every tx throws a tick), stat flashes in the corners
 * (TX/SEC, SATS, BLOCK, MEMPOOL), DR decals (stickers, hazard bars, barcodes seeded by txids), the headline as a
 * hard-cut cycle (CutTitle), occasional void drops and soft mono stretches. One set piece at a time (`busy`), so
 * effects never stack; the clips' clean stretches hide every overlay. Reduced motion / Save-Data: the lead poster,
 * the first headline, live numbers only. Hidden tab: everything waits.
 */
export function IntenseHero({ clips, cta, sound, strip, scroll }: { clips: Clip[]; cta: ReactNode; sound?: ReactNode; strip?: ReactNode; scroll?: ReactNode }) {
  const motion = useSyncExternalStore(subscribeMotion, motionSnapshot, motionServer);
  const reduce = !motion;
  const fx = useHits();
  const [clean, setClean] = useState(false);
  const [voidOn, setVoid] = useState(false);
  const [mono, setMono] = useState(false);
  const [slam, setSlam] = useState<Slam | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [white, setWhite] = useState(0);
  const [tear, setTear] = useState(0);
  const [showing, setShowing] = useState<Clip>(clips[0]);
  const [cutN, setCutN] = useState(0);
  const deck = useRef<DeckApi | null>(null);
  const title = useRef<TitleApi | null>(null);
  const grain = useRef<GrainApi | null>(null);
  // one set piece at a time: void drop, block takeover or a chain slam; the others wait their turn
  const busy = useRef<null | 'void' | 'block' | 'slam'>(null);
  const lastSlam = useRef(0);
  const lastBig = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
    return t;
  }, []);
  useEffect(() => {
    const ts = timers.current;
    return () => ts.forEach(clearTimeout);
  }, []);
  // Hero height = viewport minus the (sticky, possibly wrapping) nav.
  useEffect(() => {
    const nav = document.querySelector('nav[aria-label="Site"]');
    if (!nav) return;
    const set = () => document.documentElement.style.setProperty('--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const doSlam = useCallback(
    (s: Omit<Slam, 'id' | 'x' | 'y' | 'ang'> & Partial<Pick<Slam, 'x' | 'y' | 'ang'>>, hold = r(2200, 3400)) => {
      if (reduce || document.hidden) return;
      const id = Date.now();
      // where a decal lands: clear of the copy (left half on desktop, bottom on phones)
      const spot = wide() ? { x: r(46, 74), y: r(8, 62) } : { x: r(4, 40), y: r(9, 38) };
      setSlam({ ang: r(-7, 5), ...spot, ...s, id });
      hit('slam');
      lastSlam.current = Date.now();
      later(() => setSlam((cur) => (cur?.id === id ? null : cur)), hold);
    },
    [later, reduce],
  );

  // ---- chain events ----
  const rateRef = useRef(0);
  const onPulse = useCallback(
    (e: PulseEvent) => {
      if (reduce || document.hidden) return;
      const now = Date.now();
      switch (e.type) {
        case 'tx':
          // a tick per tx when the chain idles; sampled down on a busy one (the grain's density follows the rate anyway)
          if (Math.random() < 30 / Math.max(30, rateRef.current)) grain.current?.tick(1 + Math.min(6, (e.tx.sats / 5e6) | 0));
          break;
        case 'big': {
          grain.current?.tick(24, true);
          if (now - lastBig.current < 4000 || busy.current) return;
          lastBig.current = now;
          // a big move is a hit: white frame, hard cut, the amount slammed in
          setWhite(now);
          hit('flash');
          deck.current?.cut();
          if (now - lastSlam.current > 5000) doSlam({ text: e.bsv >= 0.5 ? `${fmtBsv(e.bsv)} BSV` : `${fmtBytes(e.tx.bytes)} TX`, sub: `BIG MOVE · ${e.tx.id.slice(0, 10)}`, ink: 'red', size: r(44, 64), haz: true, seed: e.tx.id });
          break;
        }
        case 'token': {
          grain.current?.tick(4);
          if (busy.current || now - lastSlam.current < 7000) return;
          const m = e.tx.token ? tokenMeta(e.tx.token) : null;
          const sym = m?.sym ?? (e.tx.token ? e.tx.token.slice(0, 6) : 'BSV-21');
          if (Math.random() < 0.45) doSlam({ text: `$${sym.replace(/^\$/, '').toUpperCase()}`, sub: `${(e.tx.op ?? 'transfer').toUpperCase()}${e.tx.amt ? ` · ${e.tx.amt}` : ''} · BSV-21`, ink: 'amber', size: r(34, 52), seed: e.tx.id });
          break;
        }
        case 'blast': {
          grain.current?.tick(8, true);
          if (busy.current || now - lastSlam.current < 5000) return;
          doSlam({ text: 'Blast', sub: `${(e.tx.game ?? 'tokenblaster').toUpperCase()} · LIVE · ${e.tx.id.slice(0, 8)}`, ink: 'paper', size: r(40, 60), haz: true, seed: e.tx.id });
          break;
        }
        case 'inscription':
          grain.current?.tick(3);
          if (!busy.current && now - lastSlam.current > 12000 && Math.random() < 0.2) doSlam({ text: 'Ordinal', sub: `INSCRIBED · 1SAT · ${e.tx.id.slice(0, 8)}`, ink: 'ink', size: r(30, 44), seed: e.tx.id });
          break;
        case 'block': {
          // the beat: void, then the hazard sweep and the height
          if (busy.current === 'block') return;
          busy.current = 'block';
          setSlam(null);
          setVoid(true);
          hit('cut');
          later(() => {
            setVoid(false);
            setBlock({ id: now, height: e.height });
            hit('block');
            deck.current?.cut();
            title.current?.bump();
            grain.current?.tick(40, true);
          }, 600);
          later(() => {
            setBlock(null);
            busy.current = null;
          }, 3400);
          break;
        }
      }
    },
    [doSlam, later, reduce],
  );
  const { snap, live } = useChainPulse(onPulse);
  const isLive = snap.status === 'live';
  useEffect(() => {
    rateRef.current = snap.rate;
  }, [snap.rate]);

  // ---- the deck's cadence: faster as the chain gets busier, on a log scale (BSV idles at a few tx/s and runs at
  // hundreds): ~6.5 s quiet, ~3 s at 100 tx/s, ~2 s at 300+. Read at cut time. ----
  const nextDelay = () => {
    const k = Math.min(1, Math.log10(live.current.rate + 1) / Math.log10(301));
    const base = 6500 - k * 4500;
    return base + Math.random() * base * 0.5;
  };
  const onCut = useCallback(() => {
    setTear(Date.now());
    setCutN((n) => n + 1);
    hit('cut');
  }, []);
  const onShow = useCallback((c: Clip) => setShowing(c), []);
  const onClean = useCallback((on: boolean) => setClean(on), []);
  const dynamicPhrase = (): Phrase | null => {
    const s = live.current;
    if (s.height && Math.random() < 0.5) return { parts: ['Block ', { hot: s.height.toLocaleString() }] };
    if (s.status === 'live' && s.rate >= 1) return { parts: [{ hot: s.rate.toFixed(0) }, ' tx / sec'] };
    return null;
  };

  // ---- slow clocks: void drops, mono stretches, stat flashes, slogan slams. Nothing fires in a hidden tab. ----
  useEffect(() => {
    if (reduce) return;
    let alive = true;
    const ts = new Set<ReturnType<typeof setTimeout>>();
    const after = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        ts.delete(t);
        if (alive) fn();
      }, ms);
      ts.add(t);
    };
    const wait = (fn: () => void) => after(fn, 2500 + Math.random() * 2500);
    const voidLoop = () => {
      if (document.hidden) return after(voidLoop, 8000);
      if (busy.current) return wait(voidLoop);
      busy.current = 'void';
      setVoid(true);
      hit('cut');
      after(() => {
        setVoid(false);
        hit('cut');
        busy.current = null;
        deck.current?.cut();
      }, 900 + Math.random() * 1400);
      after(voidLoop, 25000 + Math.random() * 35000);
    };
    const monoLoop = () => {
      if (document.hidden) return after(monoLoop, 8000);
      if (busy.current === 'void') return wait(monoLoop);
      setMono(true);
      hit('cut');
      after(() => {
        setMono(false);
        hit('cut');
      }, 3000 + Math.random() * 2000);
      after(monoLoop, 90000 + Math.random() * 110000);
    };
    const flashLoop = () => {
      if (document.hidden) return after(flashLoop, 6000);
      if (busy.current !== 'block') {
        const rows = statRows(live.current);
        const a = (Math.random() * rows.length) | 0;
        const two = Math.random() < 0.5;
        const picked = two ? [rows[a], rows[(a + 1 + ((Math.random() * (rows.length - 1)) | 0)) % rows.length]] : [rows[a]];
        const pos = (wide() ? (['tr', 'mr', 'br', 'tr'] as const) : (['mr', 'tl'] as const))[(Math.random() * (wide() ? 4 : 2)) | 0];
        const id = Date.now();
        setFlash({ id, pos, rows: picked });
        hit('tick');
        after(() => setFlash((f) => (f?.id === id ? null : f)), 900 + Math.random() * 700);
      }
      after(flashLoop, 3200 + Math.random() * 4200);
    };
    const sloganLoop = () => {
      if (document.hidden) return after(sloganLoop, 8000);
      if (busy.current || Date.now() - lastSlam.current < 8000) return wait(sloganLoop);
      const text = SLOGANS[(Math.random() * SLOGANS.length) | 0];
      doSlam({ text, ink: (['amber', 'red', 'paper'] as const)[(Math.random() * 3) | 0], size: r(26, 44), haz: Math.random() < 0.4, seed: text });
      after(sloganLoop, 14000 + Math.random() * 16000);
    };
    after(flashLoop, 1800 + Math.random() * 1500);
    after(sloganLoop, 7000 + Math.random() * 6000);
    after(voidLoop, 20000 + Math.random() * 20000);
    after(monoLoop, 70000 + Math.random() * 60000);
    return () => {
      // a void or mono that is on when the clocks stop (reduced motion flipped, dev HMR) must not stick
      alive = false;
      ts.forEach(clearTimeout);
      setVoid(false);
      setMono(false);
      if (busy.current !== 'block') busy.current = null;
    };
  }, [doSlam, live, reduce]);

  const cls = useMemo(() => `tbh${clean ? ' clean' : ''}${voidOn ? ' void' : ''}${mono ? ' mono' : ''}`, [clean, voidOn, mono]);
  const status = snap.status === 'live' ? 'LIVE · MAINNET' : snap.status === 'connecting' ? 'CONNECTING · MAINNET' : snap.status === 'off' ? 'MAINNET · NO FEED' : 'MAINNET · RECONNECTING';

  return (
    <div className={cls} data-live={isLive} data-clip={showing.id}>
      {/* planes: clips, scrims, grain, decals */}
      <div className="tbh-plane tbh-vidplane">
        <ClipDeck clips={clips} still={reduce} nextDelay={nextDelay} onClean={onClean} onShow={onShow} onCut={onCut} onApi={(a) => (deck.current = a)} />
      </div>
      {/* directional scrims: dark on the text side, clear on the art side; no flat wash */}
      <div className="tbh-plane tbh-scrim z-[2] bg-[linear-gradient(to_top,var(--panel)_10%,color-mix(in_srgb,var(--panel)_82%,transparent)_50%,transparent)] lg:hidden" aria-hidden />
      <div className="tbh-plane tbh-scrim z-[2] hidden bg-[linear-gradient(90deg,var(--panel)_0%,color-mix(in_srgb,var(--panel)_88%,transparent)_28%,color-mix(in_srgb,var(--panel)_40%,transparent)_52%,transparent_74%)] lg:block" aria-hidden />
      {!reduce && (
        <div className="tbh-plane tbh-overlay z-[3]">
          <SignalGrain pulse={live} reduce={reduce} onApi={(a) => (grain.current = a)} />
        </div>
      )}
      {tear > 0 && !reduce && <div key={`t${tear}`} className="tbh-tear" aria-hidden />}
      {white > 0 && !reduce && <div key={`w${white}`} className="tbh-flash" aria-hidden />}
      <div className="tbh-plane tbh-slamplane tbh-overlay" aria-hidden>
        {slam && (
          <div key={slam.id} className={`tbh-slam ${slam.ink}`} style={{ left: `${slam.x}%`, top: `${slam.y}%`, ['--ang' as string]: `${slam.ang}deg`, ['--sz' as string]: `clamp(${Math.round(slam.size * 0.5)}px, ${(slam.size / 16).toFixed(2)}vw, ${Math.round(slam.size * 1.4)}px)` }}>
            {slam.haz && <div className="haz" />}
            <span className="stk">{slam.text}</span>
            {slam.sub && <span className="sub">{slam.sub}</span>}
            {slam.seed && (
              <div className="mt-1.5">
                <Barcode seed={slam.seed} h={14} w={96} colour="var(--text)" />
              </div>
            )}
          </div>
        )}
      </div>
      {block && (
        <div key={`b${block.id}`} className="tbh-block" aria-hidden>
          <div className="sweep" />
          <div className="slab">
            <span className="k">New block · BSV mainnet</span>
            <span className="h">
              <span className="pre">#</span>
              {block.height ? block.height.toLocaleString() : 'MINED'}
            </span>
            <Barcode seed={`BLOCK-${block.height}`} h={18} w={160} colour="var(--bg)" />
          </div>
        </div>
      )}
      {flash && (
        <div key={`s${flash.id}`} className={`tbh-stats ${flash.pos}`} aria-hidden>
          {flash.rows.map((row) => (
            <div key={row.k} className={`tbh-stat ${row.cls ?? ''}`}>
              <span className="lbl">{row.k}</span>
              <span className="num">{row.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* copy: badge row, the cut title, stickers, sound, CTAs */}
      <div className="relative z-10 flex flex-1 items-end px-4 pb-20 pt-[150px] sm:px-8 lg:items-center lg:px-12 lg:pb-20 lg:pt-8">
        <div className="min-w-0 lg:max-w-[58%]">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="tbh-badge" data-live={isLive} aria-live="off">
              <span className="dot" aria-hidden />
              {status}
            </span>
            <span className="dr-code hidden !text-[var(--accent)] sm:inline">TB-001</span>
            <span className="dr-code tabular-nums [text-shadow:0_1px_4px_var(--panel),0_0_10px_var(--panel)]" aria-label={isLive ? `${snap.rate.toFixed(1)} transactions per second` : undefined}>
              {isLive ? `${snap.rate.toFixed(1)} TX/S` : 'TokenBlaster.lol'}
              {snap.height ? ` · #${snap.height.toLocaleString()}` : ''}
            </span>
            <span className="dr-kana hidden text-[11px] text-[var(--muted)] sm:inline" aria-hidden>
              トークン発射
            </span>
            <button type="button" className="tbh-fx" onClick={() => setHits(!fx)} aria-pressed={fx} title="Arcade hits on the cuts (no music)">
              <span className="sq" aria-hidden />
              FX {fx ? 'ON' : 'OFF'}
            </button>
          </div>
          <CutTitle phrases={PHRASES} dynamic={dynamicPhrase} reduce={reduce} onApi={(a) => (title.current = a)} />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="dr-sticker text-base sm:text-xl">Every bullet = 1 real BSV tx</span>
            <span className="dr-sticker dr-sticker-red text-xs sm:text-sm">No fake coins</span>
          </div>
          {sound && <div className="mt-4">{sound}</div>}
          {cta}
        </div>
      </div>

      {/* now showing: the clip on screen, its code, music preview and a way in */}
      <div className="tbh-now" role="region" aria-label="Now showing">
        <div className="dr-hazard !h-1.5" aria-hidden />
        <div key={cutN} className="cut flex items-center justify-between gap-3 px-2.5 py-2" aria-live="off">
          <div className="min-w-0">
            <p className="dr-code overflow-hidden text-ellipsis whitespace-nowrap !text-[var(--accent)]">
              NOW · {showing.code}
            </p>
            <p className="dr-display overflow-hidden text-ellipsis whitespace-nowrap text-[22px] text-hot sm:text-[26px]">{showing.title}</p>
            <p className="dr-kana text-[10px] text-[var(--muted)]" aria-hidden>
              {showing.kana ?? 'ゲーム'}
            </p>
          </div>
          <PreviewButton href={showing.href} title={showing.title} className="!opacity-100 shrink-0" />
          <Link href={showing.href} className="btn-fire inline-flex shrink-0 items-center !px-3 !py-1.5 !text-lg">
            Play <span aria-hidden>&nbsp;▶</span>
          </Link>
        </div>
      </div>

      {scroll}
      {strip && <div className="relative z-10">{strip}</div>}
    </div>
  );
}
