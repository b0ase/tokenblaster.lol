'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FEED_EVENT, type FeedTx } from '@/lib/feed';
import { Gun } from '@/lib/gun';
import { PACKS, formatCount, formatUsd, packSats, usd } from '@/lib/pricing';
import { BLASTER_ID, iconUrl, tokenById, tokensHeld, type Token } from '@/lib/tokens';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from '@/lib/discovery';
import { connect, fund, hasCwi, type Wallet } from '@/lib/wallet';
import { WalletChooser } from './WalletChooser';

type Phase = 'idle' | 'connecting' | 'loading' | 'firing' | 'unloading';
type Point = { t: number; fired: number; landed: number };

/**
 * The gun app (TeraGun's layout, bsv.lol's look). Connect bWallet, pick the token you are
 * blasting for, load a pack (one bWallet approval funds the in-tab gun), fire. Every blast is a
 * real transaction broadcast to GorillaPool ARC; "landed" counts the ones the live JungleBus
 * feed has seen come back, so the feedback is the chain itself.
 */
export function GunApp() {
  const gun = useRef<Gun | null>(null);
  const stop = useRef(false);
  const sent = useRef(new Set<string>());
  const shots = useRef(0); // bumps on every blast; the canvas animates the difference
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [cwi, setCwi] = useState(false);
  const [ammo, setAmmo] = useState(0);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [token, setToken] = useState<Token | null>(null);
  const [custom, setCustom] = useState('');
  const [packIdx, setPackIdx] = useState(0);
  const [bsvUsd, setBsvUsd] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fired, setFired] = useState(0);
  const [landed, setLanded] = useState(0);
  const [series, setSeries] = useState<Point[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);

  const pack = PACKS[packIdx];
  const cost = packSats(pack);

  // Client-only setup: the gun key (sessionStorage), wallet presence, price, featured token.
  useEffect(() => {
    gun.current = new Gun();
    setAmmo(gun.current.sats);
    setCwi(hasCwi());
    fetch('/api/price')
      .then((r) => r.json())
      .then((d: { bsvUsd?: number }) => d.bsvUsd && setBsvUsd(d.bsvUsd))
      .catch(() => undefined);
    tokenById(BLASTER_ID)
      .then((t) => setToken((cur) => cur ?? t))
      .catch(() => undefined);
  }, []);

  // Count our blasts as the live feed sees them.
  useEffect(() => {
    const on = (e: Event) => {
      const f = (e as CustomEvent<FeedTx>).detail;
      if (f.kind === 'blast' && sent.current.delete(f.id)) setLanded((n) => n + 1);
    };
    window.addEventListener(FEED_EVENT, on);
    return () => window.removeEventListener(FEED_EVENT, on);
  }, []);

  // One chart point per second while there is anything to show.
  const counts = useRef({ fired: 0, landed: 0 });
  useEffect(() => {
    counts.current = { fired, landed };
  }, [fired, landed]);
  useEffect(() => {
    const t = setInterval(() => {
      const { fired: f, landed: l } = counts.current;
      if (!f) return;
      setSeries((s) => [...s.slice(-599), { t: Date.now(), fired: f, landed: l }]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const pickWallet = async (entry: WalletEntry) => {
    setChooser(null);
    setError(null);
    setPhase('connecting');
    try {
      const w = await connect(entry);
      rememberWallet(entry.id);
      setWallet(w);
      tokensHeld(w.address)
        .then((held) => {
          setTokens(held);
          if (held[0]) setToken(held[0]);
        })
        .catch(() => undefined);
    } catch (e) {
      fail(e);
    } finally {
      setPhase('idle');
    }
  };

  /** Reconnect the wallet picked last time; otherwise (or if it is gone) open the chooser. */
  const doConnect = async () => {
    setError(null);
    const id = rememberedWallet();
    if (!id) return setChooser({ note: null });
    setPhase('connecting');
    const found = (await discoverWallets().catch(() => [])).find((w) => w.id === id);
    setPhase('idle');
    if (found) return pickWallet(found);
    setChooser({ note: 'The wallet you used last time is not available any more.' });
  };

  const switchWallet = () => {
    rememberWallet(null);
    setWallet(null);
    setTokens([]);
    setChooser({ note: null });
  };

  const pickCustom = async () => {
    setError(null);
    try {
      setToken(await tokenById(custom.trim()));
      setCustom('');
    } catch (e) {
      fail(e);
    }
  };

  const doLoad = async () => {
    if (!wallet || !gun.current) return;
    setError(null);
    setPhase('loading');
    try {
      const need = cost - gun.current.sats;
      const tx = await fund(wallet, gun.current.address, need, `TokenBlaster: load ${formatCount(pack)} blasts`);
      gun.current.load(tx);
      setAmmo(gun.current.sats);
    } catch (e) {
      fail(e);
    } finally {
      setPhase('idle');
    }
  };

  const doFire = async () => {
    const g = gun.current;
    if (!g || !token) return;
    setError(null);
    setPhase('firing');
    stop.current = false;
    try {
      for (let n = 1; n <= pack && !stop.current; n++) {
        const txid = await g.fire(token.id, n);
        sent.current.add(txid);
        shots.current++;
        setFired((v) => v + 1);
        setAmmo(g.sats);
        setLast(txid);
      }
    } catch (e) {
      fail(e);
    } finally {
      setAmmo(g.sats);
      setPhase('idle');
    }
  };

  const doUnload = async () => {
    if (!wallet || !gun.current) return;
    setError(null);
    setPhase('unloading');
    try {
      await gun.current.unload(wallet.address);
      setAmmo(0);
    } catch (e) {
      fail(e);
    } finally {
      setPhase('idle');
    }
  };

  const loaded = ammo >= cost * 0.8; // enough for the pack at the real fee (~23 sats each)
  const busy = phase !== 'idle';
  const action = !wallet
    ? { label: phase === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET', ok: true, hint: cwi ? 'pick which wallet to use' : 'no wallet found: install bWalletX or open from bWallet' }
    : !token
      ? { label: 'PICK A TOKEN', ok: false, hint: 'choose what you are blasting for' }
      : phase === 'firing'
        ? { label: 'STOP', ok: true, hint: `firing for $${token.sym}` }
        : !loaded
          ? { label: phase === 'loading' ? 'APPROVE IN bWALLET…' : `LOAD ${formatCount(pack)}`, ok: true, hint: `${cost.toLocaleString()} sats into the gun, one approval` }
          : { label: `FIRE ${formatCount(pack)}`, ok: true, hint: `at the chain for $${token.sym}` };

  const onAction = () => {
    if (!wallet) void doConnect();
    else if (phase === 'firing') stop.current = true;
    else if (!loaded) void doLoad();
    else void doFire();
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">The gun</span>
        <span className="text-dim">
          {wallet ? (
            <>
              {wallet.name} <span className="text-hot">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</span>{' '}
              {!busy && (
                <button onClick={switchWallet} className="btn ml-1 text-xs">
                  switch wallet
                </button>
              )}
            </>
          ) : (
            'not connected'
          )}
        </span>
      </div>

      <BlastChart series={series} />

      <div className="mt-3 grid items-center gap-4 md:grid-cols-[220px_1fr_200px]">
        <Dial
          idx={packIdx}
          setIdx={(i) => !busy && setPackIdx(i)}
          price={bsvUsd ? formatUsd(usd(cost, bsvUsd)) : '…'}
          sats={cost}
        />
        <div className="flex flex-col items-center gap-2">
          <GunCanvas shots={shots} firing={phase === 'firing'} icon={iconUrl(token?.icon ?? null)} />
          <button onClick={onAction} disabled={!action.ok || (busy && phase !== 'firing')} className="btn-fire">
            {phase === 'firing' || phase === 'loading' ? <span className="blink">{action.label}</span> : action.label}
          </button>
          <span className="text-center text-xs text-dim">{action.hint}</span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <Readout label="AMMO" value={`${ammo.toLocaleString()} sats`} />
          <Readout label="FIRED" value={fired.toLocaleString()} />
          <Readout label="LANDED" value={landed.toLocaleString()} />
          {wallet && ammo > 0 && !busy && (
            <button onClick={doUnload} className="btn text-xs">
              UNLOAD → wallet
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 h-2 w-full bg-input">
        <div className="h-full bg-fg transition-[width]" style={{ width: `${Math.min(100, (ammo / cost) * 100)}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-dim">TOKEN:</span>
        {token && <TokenChip t={token} on />}
        {tokens
          .filter((t) => t.id !== token?.id)
          .slice(0, 6)
          .map((t) => (
            <button key={t.id} onClick={() => !busy && setToken(t)}>
              <TokenChip t={t} />
            </button>
          ))}
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pickCustom()}
          placeholder="or paste a token id (txid_vout)"
          className="inset min-w-0 flex-1 bg-input px-2 py-1 text-hot placeholder:text-muted"
        />
      </div>

      {last && (
        <p className="mt-2 truncate text-xs text-dim">
          last blast:{' '}
          <a href={`https://whatsonchain.com/tx/${last}`} target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            {last}
          </a>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-hot">⚠ {error}</p>}
      {chooser && <WalletChooser note={chooser.note} onPick={pickWallet} onClose={() => setChooser(null)} />}
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset flex items-baseline justify-between px-2 py-1">
      <span className="text-xs tracking-widest text-dim">{label}</span>
      <span className="font-bold tabular-nums text-hot">{value}</span>
    </div>
  );
}

function TokenChip({ t, on }: { t: Token; on?: boolean }) {
  const src = iconUrl(t.icon);
  return (
    <span className={`btn inline-flex items-center gap-1 text-xs ${on ? 'btn-on' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-4 w-4 [image-rendering:pixelated]" /> : null}${t.sym}
      {t.balance !== undefined && <span className="text-dim"> {t.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
    </span>
  );
}

/** TX POWER: a half-dial whose needle tracks the pack size. */
function Dial({ idx, setIdx, price, sats }: { idx: number; setIdx: (i: number) => void; price: string; sats: number }) {
  const segs = 12;
  const angle = -90 + ((idx + 0.5) / PACKS.length) * 180;
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs tracking-widest text-dim">TX POWER</span>
      <svg viewBox="-60 -60 120 70" className="w-44">
        {Array.from({ length: segs }, (_, i) => {
          const a0 = Math.PI + (i / segs) * Math.PI + 0.03;
          const a1 = Math.PI + ((i + 1) / segs) * Math.PI - 0.03;
          const lit = i < ((idx + 1) / PACKS.length) * segs;
          const p = (a: number, r: number) => `${Math.cos(a) * r} ${Math.sin(a) * r}`;
          return (
            <path
              key={i}
              d={`M ${p(a0, 52)} A 52 52 0 0 1 ${p(a1, 52)} L ${p(a1, 40)} A 40 40 0 0 0 ${p(a0, 40)} Z`}
              fill={lit ? (i > segs * 0.75 ? '#ffd0c0' : i > segs * 0.4 ? '#ff9a85' : '#ff5a48') : '#2a0a0a'}
            />
          );
        })}
        <line x1="0" y1="0" x2="0" y2="-36" stroke="#ffd0c0" strokeWidth="2.5" transform={`rotate(${angle})`} style={{ transition: 'transform .3s' }} />
        <circle r="5" fill="#ff5a48" />
      </svg>
      <div className="flex items-center gap-2">
        <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} className="btn" aria-label="Smaller pack">
          ‹
        </button>
        <span className="w-20 text-center text-3xl font-bold text-hot">
          {formatCount(PACKS[idx])}
          <span className="text-xs text-dim"> TX</span>
        </span>
        <button onClick={() => setIdx(Math.min(PACKS.length - 1, idx + 1))} disabled={idx === PACKS.length - 1} className="btn" aria-label="Bigger pack">
          ›
        </button>
      </div>
      <span className="text-lg text-accent">{price}</span>
      <span className="text-xs text-dim">{sats.toLocaleString()} sats</span>
    </div>
  );
}

/** The gun and its target: one tracer per real blast, a muzzle flash while firing. */
function GunCanvas({ shots, firing, icon }: { shots: React.RefObject<number>; firing: boolean; icon: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const firingRef = useRef(firing);
  useEffect(() => {
    firingRef.current = firing;
  }, [firing]);
  useEffect(() => {
    if (!icon) return void (img.current = null);
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.src = icon;
    i.onload = () => (img.current = i);
  }, [icon]);

  const draw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return () => undefined;
    const bullets: { x: number; y: number }[] = [];
    let seen = shots.current;
    let hit = 0;
    let raf = 0;
    const frame = (t: number) => {
      const dpr = devicePixelRatio;
      const w = (c.width = c.clientWidth * dpr);
      const h = (c.height = c.clientHeight * dpr);
      const u = h / 24; // pixel unit
      ctx.fillStyle = '#050202';
      ctx.fillRect(0, 0, w, h);
      const gx = w * 0.08;
      const gy = h * 0.5;
      const muzzle = gx + 22 * u;
      const tx = w - 7 * u;
      // Gun: blocky barrel, body, grip, magazine, sight.
      const px = (x: number, y: number, ww: number, hh: number, col: string) => {
        ctx.fillStyle = col;
        ctx.fillRect(gx + x * u, gy + y * u, ww * u, hh * u);
      };
      px(0, -3, 12, 6, '#4a1414');
      px(12, -2, 10, 3, '#6a3632');
      px(1, -2, 4, 2, '#ff5a48');
      px(4, -5, 6, 2, '#8a2222');
      px(3, 3, 3, 6, '#3a0c0c');
      px(7, 3, 3, 4, '#2a0a0a');
      for (let k = 0; k < 3; k++) px(13 + k * 3, -2, 1, 3, '#2a0a0a');
      // New blasts → new tracers.
      for (; seen < shots.current; seen++) bullets.push({ x: muzzle, y: gy - 0.5 * u + (Math.random() - 0.5) * u });
      if (firingRef.current && Math.floor(t / 60) % 2) px(22, -3, 3, 5, '#ffd0c0');
      ctx.fillStyle = '#ffd0c0';
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += 18 * dpr;
        ctx.fillRect(b.x, b.y, 3 * u, 0.6 * u);
        if (b.x >= tx - 5 * u) {
          bullets.splice(i, 1);
          hit = t;
        }
      }
      // Target: hex ring with the token's icon; flashes on hit.
      const flash = t - hit < 90;
      ctx.strokeStyle = flash ? '#ffd0c0' : '#8a2222';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        ctx.lineTo(tx + Math.cos(a) * 5.5 * u, gy + Math.sin(a) * 5.5 * u);
      }
      ctx.stroke();
      if (img.current) ctx.drawImage(img.current, tx - 3.5 * u, gy - 3.5 * u, 7 * u, 7 * u);
      else {
        ctx.fillStyle = flash ? '#ffd0c0' : '#4a1414';
        ctx.fillRect(tx - u, gy - u, 2 * u, 2 * u);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [shots]);

  useEffect(draw, [draw]);
  return <canvas ref={canvas} className="inset h-32 w-full" aria-hidden />;
}

/** Fired vs landed over this session, one point per second. */
function BlastChart({ series }: { series: Point[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = devicePixelRatio;
    const w = (c.width = c.clientWidth * dpr);
    const h = (c.height = c.clientHeight * dpr);
    ctx.fillStyle = '#050202';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a0a0a';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    ctx.font = `${10 * dpr}px monospace`;
    ctx.fillStyle = '#a05a52';
    if (series.length < 2) {
      ctx.fillText('no blasts yet this session: load the gun and fire', 10 * dpr, h / 2);
      return;
    }
    const max = Math.max(1, ...series.map((p) => p.fired));
    const line = (key: 'fired' | 'landed', color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      series.forEach((p, i) => {
        const x = (i / (series.length - 1)) * (w - 70 * dpr);
        const y = h - 8 * dpr - (p[key] / max) * (h - 24 * dpr);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      const lastP = series[series.length - 1];
      ctx.fillStyle = color;
      ctx.fillText(`${key} ${lastP[key].toLocaleString()}`, w - 66 * dpr, h - 8 * dpr - (lastP[key] / max) * (h - 24 * dpr));
    };
    line('fired', '#ff5a48');
    line('landed', '#ffd0c0');
  }, [series]);
  return <canvas ref={canvas} className="inset h-40 w-full" aria-label="Blasts fired and landed this session" />;
}
