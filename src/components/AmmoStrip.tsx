'use client';

/**
 * The ammo flow shared by the arena and Double-O Kweg:
 *   1 CONNECT WALLET → 2 PICK what to fire + how many, ONE LOAD (one approval) → 3 PLAY.
 * Steps that don't apply yet are dimmed. Errors show inline. UNLOAD and the last receipt stay
 * underneath; anything else (gun address, fixers) goes in `details`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { TOKEN_FEE } from '@/lib/gun';
import { iconUrl } from '@/lib/tokens';
import type { useBlaster } from '@/lib/useBlaster';

type Blaster = ReturnType<typeof useBlaster>;

const CHOICE_KEY = 'tb:ammo-choice';

function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-hot border-t-transparent" />;
}

export function AmmoStrip({
  b,
  armed,
  title = 'AMMO',
  tokenPresets = [10, 50, 100],
  initialTokenLoad = 50,
  sats,
  remember = false,
  playLabel,
  onPlay,
  playReady = true,
  onPractice,
  practiceLabel = '▶ PLAY PRACTICE',
  details,
}: {
  b: Blaster;
  /** The gun holds enough of the chosen ammo to play live. */
  armed: boolean;
  title?: string;
  tokenPresets?: number[];
  initialTokenLoad?: number;
  /** Offer plain sats blasts (no tokens spent). `picker` chooses how many; `onLoad` loads them. */
  sats?: { picker: ReactNode; label: string; onLoad: () => void };
  /** Remember the last choice (sats or which token) in this browser. */
  remember?: boolean;
  playLabel: string;
  onPlay: () => void;
  playReady?: boolean;
  onPractice?: () => void;
  practiceLabel?: string;
  details?: ReactNode;
}) {
  const [tokenLoad, setTokenLoad] = useState(initialTokenLoad);
  // Spinner from LOAD until the gun shows the ammo (or the load fails).
  const [waiting, setWaiting] = useState(false);
  const loading = b.busy === 'loading' || b.busy === 'loading-tokens';
  useEffect(() => {
    if (!waiting) return;
    if (armed || (b.error && !loading)) {
      void Promise.resolve().then(() => setWaiting(false));
      return;
    }
    const t = setTimeout(() => setWaiting(false), 30_000);
    return () => clearTimeout(t);
  }, [waiting, armed, b.error, loading]);

  const satsMode = Boolean(sats) && b.mode === 'sats';

  // Remember the last choice; restore it once the wallet's tokens are known.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!remember || restored || !b.wallet || !b.tokens.length) return;
    void Promise.resolve().then(() => setRestored(true));
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CHOICE_KEY);
    } catch {
      /* no storage */
    }
    if (!saved) return;
    if (saved === 'sats' && sats) b.setMode('sats');
    else {
      const t = b.tokens.find((x) => x.id === saved);
      if (t) {
        b.setToken(t);
        b.setMode('tokens');
      }
    }
  }, [remember, restored, b, sats]);
  const save = (v: string) => {
    if (!remember) return;
    try {
      localStorage.setItem(CHOICE_KEY, v);
    } catch {
      /* no storage */
    }
  };

  const heldTok = b.tokens.find((t) => t.id === b.token?.id);
  const held = Math.max(0, Math.floor(heldTok?.balance ?? 0));
  const count = Math.max(1, Math.min(tokenLoad, held));
  const stepNo = !b.wallet ? 1 : armed ? 3 : 2;
  const stepCls = (n: number) => `inset flex flex-col gap-2 bg-black/60 p-2 ${stepNo === n ? 'border-fg' : stepNo > n ? 'opacity-80' : 'pointer-events-none opacity-40'}`;
  const spinning = loading || waiting;
  const lockPick = spinning || b.busy === 'unloading';

  const load = () => {
    b.setError(null);
    setWaiting(true);
    if (satsMode) sats!.onLoad();
    else void b.loadTokenAmmo(count);
  };

  return (
    <div className="inset flex w-full flex-col gap-2 bg-black/70 p-3 text-left text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-hot">{title}</span>
        {b.wallet && (
          <button onClick={b.refreshWallet} disabled={b.refreshing} className="btn px-2 py-0.5 text-xs" title="Look in your wallet again">
            {b.refreshing ? 'checking…' : '↻ refresh'}
          </button>
        )}
      </div>

      {/* 1 · connect */}
      <div className={stepCls(1)}>
        <span className="text-xs font-bold tracking-widest text-dim">1 · CONNECT WALLET {b.wallet && <span className="text-[#60ff90]">✓</span>}</span>
        {!b.wallet ? (
          <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire !px-3 !text-base">
            {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
          </button>
        ) : (
          <span className="truncate text-xs text-accent">{b.wallet.name}</span>
        )}
      </div>

      {/* 2 · pick + load */}
      <div className={stepCls(2)}>
        <span className="text-xs font-bold tracking-widest text-dim">
          2 · PICK {sats ? 'AMMO' : 'TOKEN'} + LOAD {armed && <span className="text-[#60ff90]">✓</span>}
        </span>
        {b.wallet && (
          <>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
              {sats && (
                <button
                  disabled={lockPick}
                  onClick={() => {
                    b.setMode('sats');
                    save('sats');
                  }}
                  className={`inset flex items-center gap-2 bg-black/60 px-2 py-1 text-left ${satsMode ? 'border-fg text-hot' : 'text-dim hover:text-hot'}`}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-input">₿</div>
                  <span className="min-w-0 flex-1 truncate font-bold">Sats blasts</span>
                  <span className="text-xs">no tokens spent</span>
                </button>
              )}
              {b.tokens.map((t) => {
                const on = !satsMode && t.id === b.token?.id;
                const ic = iconUrl(t.icon);
                return (
                  <button
                    key={t.id}
                    disabled={lockPick}
                    onClick={() => {
                      b.setToken(t);
                      b.setMode('tokens');
                      save(t.id);
                    }}
                    className={`inset flex items-center gap-2 bg-black/60 px-2 py-1 text-left ${on ? 'border-fg text-hot' : 'text-dim hover:text-hot'}`}
                  >
                    {ic ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ic} alt="" className="h-7 w-7 shrink-0 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="h-7 w-7 shrink-0 rounded bg-input" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-bold">${t.sym}</span>
                    <span className="text-xs">{t.balance?.toLocaleString()}</span>
                  </button>
                );
              })}
              {!b.tokens.length && <p className="text-xs text-dim">No tokens found in your wallet. {sats ? 'Fire sats blasts, or play practice.' : 'Get some PNEE, or play practice.'}</p>}
            </div>

            {satsMode ? (
              <>
                {sats!.picker}
                <button onClick={load} disabled={!!b.busy || spinning} className="btn px-3 py-2 font-bold">
                  {spinning ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner /> APPROVE IN WALLET…
                    </span>
                  ) : (
                    sats!.label
                  )}
                </button>
              </>
            ) : (
              b.token &&
              (held > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-1">
                    {tokenPresets
                      .filter((n) => n <= held)
                      .map((n) => (
                        <button key={n} disabled={lockPick} onClick={() => setTokenLoad(n)} className={`btn px-2 py-0.5 text-xs ${tokenLoad === n ? 'btn-on' : ''}`}>
                          {n.toLocaleString()}
                        </button>
                      ))}
                    <button disabled={lockPick} onClick={() => setTokenLoad(held)} className={`btn px-2 py-0.5 text-xs ${tokenLoad === held ? 'btn-on' : ''}`}>
                      all ({held.toLocaleString()})
                    </button>
                  </div>
                  <p className="text-xs text-dim">
                    One bullet = one ${b.token.sym} = one transaction. One approval loads the tokens plus {(count * TOKEN_FEE).toLocaleString()} sats of network fees. Unfired fees come back on
                    Unload.
                  </p>
                  <button onClick={load} disabled={!!b.busy || spinning} className="btn px-3 py-2 font-bold">
                    {spinning ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> APPROVE IN WALLET…
                      </span>
                    ) : (
                      `LOAD ${count.toLocaleString()} $${b.token.sym}`
                    )}
                  </button>
                </>
              ) : (
                <p className="text-xs text-dim">Your wallet has no ${b.token.sym} to load right now.</p>
              ))
            )}
            {b.error && <p className="text-xs text-hot">⚠ {b.error}</p>}
          </>
        )}
      </div>

      {/* 3 · play */}
      <div className={stepCls(3)}>
        <span className="text-xs font-bold tracking-widest text-dim">3 · PLAY</span>
        {armed ? (
          <>
            <p className="text-xs text-dim">
              In the gun:{' '}
              {satsMode ? (
                <span className="text-hot">{b.ammo.toLocaleString()} sats</span>
              ) : (
                <>
                  <span className="text-hot">{Math.floor(b.tokenAmmo).toLocaleString()}</span> ${b.token?.sym} · fuel {b.ammo.toLocaleString()} sats
                </>
              )}
            </p>
            <button onClick={onPlay} disabled={!playReady} className="btn-fire animate-pulse !px-3">
              {playLabel}
            </button>
          </>
        ) : (
          <p className="text-xs text-dim">Load {sats ? 'ammo' : 'tokens'} to play LIVE, or play practice for free.</p>
        )}
      </div>
      {onPractice && (
        <button onClick={onPractice} disabled={!playReady} className={armed ? 'btn px-3 py-1 font-bold' : 'btn-fire !px-3'}>
          {practiceLabel}
        </button>
      )}

      {(b.ammo > 0 || b.gunTokens.length > 0) && (
        <button onClick={b.unload} disabled={!!b.busy} className="btn px-2 py-1 text-xs">
          {b.busy === 'unloading' ? 'UNLOADING… APPROVE IN WALLET' : 'UNLOAD EVERYTHING BACK TO MY WALLET'}
        </button>
      )}
      {b.receipt && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-hot">✓ {b.receipt.text}</span>
          <a href={`https://whatsonchain.com/tx/${b.receipt.txid}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            tx ↗
          </a>
        </div>
      )}
      {details}
    </div>
  );
}
