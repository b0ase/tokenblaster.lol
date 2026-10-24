'use client';

/**
 * TokenBlaster Shooting Gallery: hold the trigger on THE GUNNER's minigun and every bullet is a real BSV
 * transaction ("tokenblaster.lol" <token> <chain:n> "gallery" [<handle>]).
 *
 * How the money moves (non-custodial, same gun as BSVGun / Arena, src/lib/gun.ts):
 *  1. LOAD: the player's wallet (bWalletX first, any BRC-100) funds the browser gun: one approval, the pack's
 *     network cost + the platform fee. The gun's key lives only in this browser.
 *  2. FEE: if PLATFORM_FEE > 0, one tagged tx from the gun pays it to the house address (fireBatch `pay`).
 *  3. FIRE: holding the trigger runs gun.storm(): the coin fans out into up to 100 lanes it controls, each lane
 *     chains its own shots, every CPU core signs and broadcasts to GorillaPool ARC. The counter only moves on
 *     shots ARC ACCEPTED. Letting go stops the storm; the lanes merge back into the gun.
 *  4. UNLOAD: whatever is left goes back to the player's wallet. Leaving the page stops firing at once.
 *
 * FREE PRACTICE never touches the chain: a simulated chain feeds the same counter. `?dryrun=1` also makes
 * LIVE use the simulator (no wallet, no broadcast), for testing and screenshots.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlaster } from '@/lib/useBlaster';
import { cleanHandle } from '@/lib/identity';
import { cachedProof } from '@/lib/xproof';
import { minigun, sfx, unlockAudio } from '@/lib/sfx';
import { PACKS, PLATFORM_FEE, PRIZE, chainHandle, fmtBsv, fmtUsd, galleryPushes, inEvent, quote, shotSats, usdOf, type BoardRow } from '@/lib/gallery';
import { WalletChooser } from '../WalletChooser';
import { GameAudio } from '../SoundToggle';
import { IdentityPicker, useMyHandle } from '../PlayerBadge';
import { GalleryScene, type SceneStats } from './galleryScene';
import { PrizeBanner } from './PrizeBanner';

const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU'; // bCorp's receiving address (public, not a key)
const FALLBACK_USD = 17.4;

type Mode = 'practice' | 'live';
type Run = { sent: number; started: number; last: string | null; tps: number; status: string | null };

/** A pretend chain: ramps to ~1,500 tx/s while the trigger is held, makes up txids. Never broadcasts. */
type Sim = { on: boolean; rate: number; carry: number };
function simTick(s: Sim, dt: number) {
  s.rate += ((s.on ? 1500 : 0) - s.rate) * Math.min(1, dt * (s.on ? 1.2 : 6));
  s.carry += s.rate * dt * (0.85 + Math.random() * 0.3);
  const n = Math.floor(s.carry);
  s.carry -= n;
  return n;
}
const fakeTxid = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

export function ShootingGallery() {
  const b = useBlaster();
  const handleRaw = useMyHandle();
  const handle = chainHandle(cleanHandle(handleRaw));
  const named = !!handle;
  const [dry, setDry] = useState(false);
  const simRef = useRef<Sim>({ on: false, rate: 0, carry: 0 });
  const scene = useRef<GalleryScene | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    void Promise.resolve().then(() => setDry(qs.get('dryrun') === '1'));
    // ?autofire=1 (practice only, simulated): holds the trigger on the boss, for screenshots and demos.
    if (qs.get('autofire') === '1') {
      const t = setTimeout(() => {
        simRef.current.on = true;
        if (scene.current) {
          scene.current.trigger = true;
          scene.current.autoAim = true;
        }
      }, 300);
      return () => clearTimeout(t);
    }
  }, []);
  const [mode, setMode] = useState<Mode>('practice');
  const [pack, setPack] = useState<number>(PACKS[0]);
  const [bsvUsd, setBsvUsd] = useState(FALLBACK_USD);
  const [locked, setLocked] = useState(false);
  const [run, setRun] = useState<Run>({ sent: 0, started: 0, last: null, tps: 0, status: null });
  const [bought, setBought] = useState(0); // shots paid for this visit (the hard cap)
  const [feePaid, setFeePaid] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hud, setHud] = useState<SceneStats | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardWin, setBoardWin] = useState<'event' | '24h'>('event');
  const [firing, setFiring] = useState(false); // a live storm is running
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef(false);
  const stop = useRef(false);
  const sentRef = useRef(0);
  const [sid] = useState(() => Math.random().toString(36).slice(2, 10));
  const simLive = useRef(true);
  const simTotal = useRef(0);
  const live = mode === 'live';
  const simulated = !live || dry;

  const q = quote(pack, named);
  useEffect(() => {
    fetch('/api/price')
      .then((r) => r.json())
      .then((j: { bsvUsd?: number }) => j.bsvUsd && setBsvUsd(j.bsvUsd))
      .catch(() => undefined);
  }, []);

  // ── Scene loop ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const s = new GalleryScene(cv, 6000);
    scene.current = s;
    const fit = () => s.resize(cv.clientWidth, cv.clientHeight, window.devicePixelRatio || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      // Simulated shots (practice / dry run) are generated here; live shots arrive from the storm callback.
      if (simLive.current) {
        const n = simTick(simRef.current, dt);
        if (n) {
          s.hits(n);
          sentRef.current += n;
          simTotal.current += n;
        }
        s.flowing = simRef.current.rate > 30;
      }
      s.step(dt);
      s.draw();
      if (now - hudAt > 120) {
        hudAt = now;
        setHud(s.stats());
        if (simLive.current) setRun((r) => ({ ...r, sent: sentRef.current, last: simRef.current.rate > 30 ? fakeTxid() : r.last, tps: Math.round(simRef.current.rate) }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    simLive.current = simulated;
  }, [simulated]);
  useEffect(() => {
    scene.current?.setBossBase(live ? Math.min(100_000, Math.max(6000, Math.round(pack / 8))) : 6000);
  }, [live, pack]);

  // Dry-run LIVE: the pack cap still applies to the simulator.
  useEffect(() => {
    if (!(live && dry)) return;
    const i = setInterval(() => {
      if (sentRef.current >= bought) {
        simRef.current.on = false;
        held.current = false;
      }
    }, 100);
    return () => clearInterval(i);
  }, [live, dry, bought]);

  // Practice and live keep separate counters: practice shots never count against a paid pack.
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

  /** Report this session's accepted shots (LIVE, named, real chain only): verified on chain by its last txid. */
  const lastReport = useRef(0);
  const report = useCallback(
    async (force = false) => {
      if (!live || dry || !handle || !run.last || !sentRef.current) return;
      if (!force && Date.now() - lastReport.current < 60_000) return;
      lastReport.current = Date.now();
      const secs = Math.round((Date.now() - run.started) / 100) / 10;
      const xp = cachedProof(handle);
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'gallery', mode: 'live', name: handle, score: sentRef.current, secs, meta: { sid }, txid: run.last, x: handle, xp: xp ?? undefined }),
      }).catch(() => undefined);
      loadBoard();
    },
    [live, dry, handle, run.last, run.started, sid, loadBoard],
  );
  useEffect(() => {
    if (firing) void report();
  }, [firing, run.sent, report]);

  // ── Trigger ──
  const startLive = useCallback(async () => {
    const left = bought - sentRef.current;
    if (firing || left <= 0) return;
    setErr(null);
    stop.current = false;
    setFiring(true);
    const s = scene.current;
    const startSent = sentRef.current;
    setRun((r) => ({ ...r, started: r.started || Date.now(), status: 'Spinning up: splitting your gun into lanes…' }));
    const t0 = performance.now();
    try {
      let prev = 0;
      await b.storm(
        left,
        (n, last) => {
          const d = n - prev;
          prev = n;
          s?.hits(d);
          if (s) s.flowing = true;
          sentRef.current = startSent + n;
          setRun((r) => ({ ...r, sent: sentRef.current, last: last ?? r.last, tps: Math.round(n / Math.max(1, (performance.now() - t0) / 1000)) }));
        },
        () => stop.current || !held.current,
        (status) => setRun((r) => ({ ...r, status })),
        { game: 'gallery', extra: galleryPushes(handle).slice(1) },
        shotSats(named),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      sfx('rekt');
    } finally {
      if (s) s.flowing = false;
      setRun((r) => ({ ...r, status: null, tps: 0 }));
      setFiring(false);
    }
  }, [b, firing, bought, handle, named]);

  const press = useCallback(() => {
    unlockAudio();
    held.current = true;
    const s = scene.current;
    if (s) s.trigger = true;
    minigun(true);
    if (simulated) {
      if (live && dry && sentRef.current >= bought) return;
      simRef.current.on = true;
    } else void startLive();
  }, [simulated, live, dry, bought, startLive]);
  const release = useCallback(() => {
    if (locked) return;
    held.current = false;
    simRef.current.on = false;
    const s = scene.current;
    if (s) s.trigger = false;
    minigun(false);
  }, [locked]);
  useEffect(() => {
    if (!locked) release();
  }, [locked, release]);

  // Live: when the trigger is held but the last storm ended (e.g. ARC hiccup), don't auto-restart; the player presses again.
  // Leaving the page: stop at once. Whatever is left stays in the player's gun; UNLOAD (or next visit) returns it.
  useEffect(() => {
    const kill = () => {
      stop.current = true;
      held.current = false;
      simRef.current.on = false;
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
      kill();
      window.removeEventListener('pagehide', kill);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeunload', warn);
    };
  }, [firing]);

  // Keyboard: hold SPACE to fire.
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      press();
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && release();
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, [press, release]);

  const aimAt = (e: React.PointerEvent) => {
    const s = scene.current;
    const cv = canvas.current;
    if (!s || !cv) return;
    const r = cv.getBoundingClientRect();
    s.aim = s.toWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // ── Buy a pack ──
  const buy = async () => {
    setErr(null);
    if (dry) {
      setBought((p) => Math.max(p, sentRef.current) + pack);
      setFeePaid(true);
      sfx('coin');
      return;
    }
    if (!b.wallet) return b.connectWallet();
    const need = Math.max(0, q.total - b.ammo);
    if (need > 0) {
      const ok = await b.load(need, `Shooting Gallery: ${pack.toLocaleString()} shots`);
      if (!ok) return;
    }
    if (q.fee > 0 && PLATFORM_FEE > 0) {
      try {
        await b.fireBatch(0, [['gallery', 'fee']], { address: HOUSE, sats: q.fee });
        setFeePaid(true);
      } catch (e) {
        setErr(`Platform fee did not go through: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setBought((p) => Math.max(p, sentRef.current) + pack);
    sfx('coin');
  };

  const spent = run.sent * shotSats(named);
  const bossPct = hud ? (hud.bossHp / Math.max(1, hud.bossMax)) * 100 : 100;
  const packLeft = Math.max(0, bought - run.sent);
  const canFire = !live || packLeft > 0;

  return (
    <div className="game-root flex flex-col gap-3">
      <GameAudio track="arena" />
      <section className="game-stage panel relative overflow-hidden p-0" style={{ background: '#05060c' }}>
        <canvas
          ref={canvas}
          className="block h-full min-h-[420px] w-full touch-none select-none"
          style={{ cursor: 'crosshair' }}
          onPointerMove={aimAt}
          onPointerDown={(e) => {
            aimAt(e);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            if (canFire) press();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          aria-label="Shooting Gallery: hold to fire"
        />
        {/* HUD */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-2 sm:p-3">
          <div className="bg-black/60 px-2 py-1 font-mono">
            <div className="text-[10px] tracking-widest text-dim">{live ? (dry ? 'LIVE · DRY RUN' : 'LIVE · ON CHAIN') : 'FREE PRACTICE · SIMULATED'}</div>
            <div className="text-[clamp(24px,5vw,44px)] font-bold leading-none text-hot tabular-nums">{run.sent.toLocaleString()}</div>
            <div className="text-[10px] text-dim">{live ? 'shots accepted by ARC' : 'simulated shots'}</div>
          </div>
          <div className="min-w-[160px] flex-1 bg-black/60 px-2 py-1 sm:max-w-[420px]">
            <div className="flex justify-between font-mono text-[10px] tracking-widest">
              <span className="text-[#ff5a4a]">LIQUID UNIT · WAVE {hud?.wave ?? 1}</span>
              <span className="text-dim">{hud ? `${hud.bossHp.toLocaleString()} / ${hud.bossMax.toLocaleString()}` : ''}</span>
            </div>
            <div className="mt-1 h-3 overflow-hidden border border-[#cfd8e3]/40 bg-black">
              <div className="h-full bg-gradient-to-r from-[#8a96a8] via-[#f4f8ff] to-[#8a96a8] transition-[width] duration-100" style={{ width: `${bossPct}%` }} />
            </div>
            <div className="mt-0.5 text-[10px] text-dim">Reforms the moment you let up. Keep firing.</div>
          </div>
          <div className="bg-black/60 px-2 py-1 text-right font-mono text-[11px] leading-tight">
            <div>
              <span className="text-dim">tx/s </span>
              <span className="text-accent tabular-nums">{run.tps.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-dim">spent </span>
              <span className="tabular-nums">{simulated ? '$0.00' : fmtUsd(usdOf(spent, bsvUsd))}</span>
              <span className="text-dim"> · {(simulated ? 0 : spent).toLocaleString()} sat</span>
            </div>
            <div>
              <span className="text-dim">score </span>
              <span className="tabular-nums">{(hud?.score ?? 0).toLocaleString()}</span>
            </div>
            {live && (
              <div>
                <span className="text-dim">pack left </span>
                <span className="tabular-nums">{packLeft.toLocaleString()}</span>
              </div>
            )}
            {handle && <div className="text-accent">@{handle}</div>}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2 sm:p-3">
          <div className="max-w-[60%] bg-black/60 px-2 py-1 text-[11px] text-dim">
            {run.status ?? (canFire ? 'HOLD to fire (or hold SPACE). Aim with the mouse or your finger.' : 'Buy a pack below to fire for real.')}
          </div>
          <div className="pointer-events-auto mb-12 flex gap-2">
            <button type="button" onClick={() => setLocked((v) => !v)} className={`btn px-3 py-2 text-xs ${locked ? 'btn-on' : ''}`} title="Keep the trigger down without holding">
              {locked ? 'TRIGGER LOCKED' : 'LOCK TRIGGER'}
            </button>
            {firing && (
              <button type="button" onClick={() => ((stop.current = true), setLocked(false), release())} className="btn-fire px-3 py-2 text-xs">
                STOP
              </button>
            )}
          </div>
        </div>
      </section>

      <PrizeBanner />

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">1 · Mode</span>
          <span className="text-dim">{dry ? 'dry run: nothing is broadcast, nothing is spent' : ''}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMode('practice')} disabled={firing} className={`btn px-4 py-2 text-lg ${!live ? 'btn-on' : ''}`}>
            FREE PRACTICE
          </button>
          <button onClick={() => setMode('live')} disabled={firing} className={`btn px-4 py-2 text-lg ${live ? 'btn-on' : ''}`}>
            LIVE {dry ? '(DRY RUN)' : '(PAID)'}
          </button>
          <span className="self-center text-sm text-dim">
            {live ? 'Every bullet is a real BSV transaction from your own wallet, tagged "gallery" on chain.' : 'Simulated chain. Nothing is broadcast; nothing costs a thing.'}
          </span>
        </div>
      </section>

      {live && (
        <section className="panel">
          <div className="panel-header">
            <span className="panel-title">2 · Session pack</span>
            <span className="text-dim">
              {shotSats(named)} sat/shot network fee{PLATFORM_FEE > 0 ? ` + ${Math.round(PLATFORM_FEE * 100)}% platform fee` : ''} · BSV ${bsvUsd.toFixed(2)}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {PACKS.map((n) => {
              const qq = quote(n, named);
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
            {pack.toLocaleString()} shots: network {fmtUsd(usdOf(q.network, bsvUsd))} + platform fee {fmtUsd(usdOf(q.fee, bsvUsd))} ={' '}
            <span className="text-hot">{fmtUsd(usdOf(q.total, bsvUsd))}</span>. The pack is a hard cap: the gun never fires more. Unspent sats stay in your gun and UNLOAD
            sends them back to your wallet.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!dry && !b.wallet ? (
              <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire px-5 py-2">
                {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT bWalletX'}
              </button>
            ) : (
              <button onClick={buy} disabled={!!b.busy || firing} className="btn-fire px-5 py-2">
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
              {feePaid && PLATFORM_FEE > 0 ? ' · fee paid' : ''}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-dim">Your name on bsv.lol and the board:</span>
            <IdentityPicker compact />
            {!handle && <span className="text-xs text-muted">No handle: shots go out anonymous (26 sat each) and are not ranked.</span>}
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
        <GalleryBoard rows={board} me={handle} mine={live && !dry ? run.sent : 0} />
        <p className="mt-2 text-xs text-muted">
          Accepted LIVE shots carrying your handle, checked on chain by the tokenblaster.lol &quot;gallery&quot; tag. {inEvent() ? 'The event is on now.' : `Event: ${new Date(PRIZE.start).toUTCString().slice(0, 16)} (UTC).`}
        </p>
      </section>
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </div>
  );
}

export function GalleryBoard({ rows, me, mine = 0 }: { rows: BoardRow[]; me?: string | null; mine?: number }) {
  // This session's live count, merged in so the player sees themselves climb before the next report lands.
  const list = [...rows];
  if (me && mine) {
    const i = list.findIndex((r) => r.handle === me);
    if (i >= 0) list[i] = { ...list[i], shots: Math.max(list[i].shots, mine) };
    else list.push({ handle: me, shots: mine, sessions: 1 });
    list.sort((a, b) => b.shots - a.shots);
  }
  if (!list.length) return <p className="text-sm text-dim">No ranked shots yet. Be the first name on the board.</p>;
  return (
    <ol className="flex flex-col gap-1 font-mono text-sm">
      {list.slice(0, 10).map((r, i) => (
        <li key={r.handle} className={`flex justify-between gap-2 border-b border-[var(--border)] py-0.5 ${r.handle === me ? 'text-accent' : ''}`}>
          <span>
            <span className="text-dim">{String(i + 1).padStart(2, '0')}</span> @{r.handle}
          </span>
          <span className="tabular-nums">{r.shots.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
