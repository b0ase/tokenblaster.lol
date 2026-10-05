'use client';

/**
 * BSVGun: TeraGun-style mass blasting. Pick a size, load the gun in one approval, and it fires
 * tens of thousands of real tagged transactions in parallel lanes (src/lib/gun.ts storm()).
 */
import { useEffect, useRef, useState } from 'react';
import { STORM_FEE } from '@/lib/gun';
import { iconUrl } from '@/lib/tokens';
import { useBlaster } from '@/lib/useBlaster';
import { GunView } from './GunView';
import { WalletChooser } from './WalletChooser';

const SIZES = [1_000, 10_000, 50_000, 100_000];
const costOf = (n: number) => n * STORM_FEE + Math.ceil(n / 300) * 40 + 500;

export function BSVGun() {
  const b = useBlaster();
  const [size, setSize] = useState(50_000);
  const [sent, setSent] = useState(0);
  const [target, setTarget] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tps, setTps] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const stop = useRef(false);
  const t0 = useRef(0);

  useEffect(() => {
    if (!firing) return;
    const i = setInterval(() => setTps(Math.round(sent / Math.max(1, (performance.now() - t0.current) / 1000))), 500);
    return () => clearInterval(i);
  }, [firing, sent]);

  const canFire = Math.floor((b.ammo - 600) / STORM_FEE);
  const need = Math.max(0, costOf(size) - b.ammo);

  const fire = async () => {
    setErr(null);
    setStatus('Starting…');
    setSent(0);
    setLast(null);
    const n = Math.min(size, canFire);
    setTarget(n);
    stop.current = false;
    t0.current = performance.now();
    setFiring(true);
    try {
      await b.storm(
        n,
        (s, tx) => {
          setSent(s);
          if (tx) setLast(tx);
        },
        () => stop.current,
        setStatus,
      );
      setStatus(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setFiring(false);
    }
  };

  const pct = target ? Math.min(100, (sent / target) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <section className="panel overflow-hidden p-0">
        <GunView firing={firing} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">1 · Wallet</span>
          <span className="text-dim">{b.wallet ? 'connected' : 'not connected'}</span>
        </div>
        {!b.wallet ? (
          <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire">
            {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-dim">Tag blasts for:</span>
            <button onClick={() => b.setToken(null)} className={`btn ${!b.token ? 'btn-on' : ''}`}>
              plain BSV
            </button>
            {b.tokens.slice(0, 12).map((t) => (
              <button key={t.id} onClick={() => b.setToken(t)} className={`btn flex items-center gap-1 ${b.token?.id === t.id ? 'btn-on' : ''}`}>
                {iconUrl(t.icon) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl(t.icon)!} alt="" className="h-4 w-4" />
                )}
                ${t.sym}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">2 · How many</span>
          <span className="text-dim">~{STORM_FEE} sats network fee per blast</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((n) => (
            <button key={n} onClick={() => setSize(n)} disabled={firing} className={`btn px-4 py-2 text-lg ${size === n ? 'btn-on' : ''}`}>
              {n.toLocaleString()}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-dim">
          {size.toLocaleString()} transactions ≈ <span className="text-hot">{costOf(size).toLocaleString()} sats</span> ({(costOf(size) / 1e8).toFixed(4)} BSV). In the gun:{' '}
          <span className="text-hot">{b.ammo.toLocaleString()} sats</span> ({Math.max(0, canFire).toLocaleString()} blasts).
        </p>
        {b.wallet && (
          <div className="mt-2 flex flex-wrap gap-2">
            {need > 0 && (
              <button onClick={() => b.load(need, `BSVGun: ${size.toLocaleString()} blasts`)} disabled={!!b.busy || firing} className="btn btn-on px-4 py-2">
                {b.busy === 'loading' ? 'APPROVE IN WALLET…' : `LOAD ${need.toLocaleString()} sats`}
              </button>
            )}
            {b.ammo > 0 && !firing && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn px-4 py-2">
                UNLOAD
              </button>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">3 · Fire</span>
          <span className="text-dim">{firing ? `${tps.toLocaleString()} tx/s` : ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!firing ? (
            <button onClick={fire} disabled={!b.wallet || canFire < 10} className="btn-fire px-8 py-4 text-2xl disabled:opacity-40">
              FIRE {Math.min(size, Math.max(0, canFire)).toLocaleString()}
            </button>
          ) : (
            <button onClick={() => (stop.current = true)} className="btn-fire px-8 py-4 text-2xl">
              STOP
            </button>
          )}
          <div className="text-4xl font-bold text-hot tabular-nums">
            {sent.toLocaleString()}
            <span className="text-lg text-dim"> / {target.toLocaleString()}</span>
          </div>
        </div>
        <div className="inset mt-3 h-4 overflow-hidden">
          <div className="h-full bg-[var(--hot)] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        {status && <p className="mt-2 text-sm text-accent">{status}</p>}
        {last && (
          <p className="mt-2 text-sm text-dim">
            latest:{' '}
            <a href={`https://whatsonchain.com/tx/${last}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              {last.slice(0, 16)}… ↗
            </a>
          </p>
        )}
        {(err || b.error) && <p className="mt-2 text-sm text-hot">⚠ {err ?? b.error}</p>}
        <p className="mt-2 text-xs text-muted">
          Every blast is a real mainnet transaction carrying the TokenBlaster tag{b.token ? ` for $${b.token.sym}` : ''}, so it counts on the leaderboard. Keep this tab open while it fires.
        </p>
      </section>
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </div>
  );
}
