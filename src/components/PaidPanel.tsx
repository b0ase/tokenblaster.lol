'use client';

/**
 * PRACTICE / LIVE pieces for arcade games using usePaidPlay:
 * - ModeBadge: the unmissable mode banner drawn over the game canvas (plus the LIVE on-chain counter,
 *   last tx link, and any broadcast error, which pauses paid actions until RESUME).
 * - PlayButtons: PLAY PRACTICE / PLAY LIVE for start and game-over screens. PLAY LIVE walks
 *   connect wallet → LOAD sats (one approval) → starts LIVE, or starts at once if the gun has sats.
 * - PaidPanel: the wallet / mode controls under the canvas (also hosts the wallet chooser, so render it once per game).
 */
import { useEffect, useState } from 'react';
import { COST, EST_FEE, HOUSE, LOADS, PER_ACTION, type usePaidPlay } from '@/lib/usePaidPlay';
import { WalletChooser } from './WalletChooser';

type Paid = ReturnType<typeof usePaidPlay>;

/** Actions worth of sats the gun needs before PLAY LIVE starts straight away. */
const MIN_ACTIONS = 10;
const txUrl = (txid: string) => `https://whatsonchain.com/tx/${txid}`;

export function ModeBadge({ pp, action, actions }: { pp: Paid; action: string; actions: string }) {
  const { b, paid, onChain, lastTx, payErr, halted, resume, needSats } = pp;
  const live = paid && Boolean(HOUSE);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex justify-center px-2">
        {live ? (
          <div className="pointer-events-auto flex animate-pulse flex-wrap items-center justify-center gap-x-2 border-2 border-hot bg-black/80 px-3 py-1 text-center text-xs font-bold text-hot shadow-[0_0_12px_var(--hot)] sm:text-sm">
            <span>● LIVE · every {action} is a real tx · {onChain.toLocaleString()} on chain</span>
            <span className="font-normal text-fg">{Math.floor(b.ammo / COST).toLocaleString()} {actions} loaded</span>
            {lastTx && (
              <a href={txUrl(lastTx)} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                last tx ↗
              </a>
            )}
          </div>
        ) : (
          <div className="border border-[var(--border-canvas)] bg-black/60 px-3 py-0.5 text-xs font-bold tracking-widest text-dim">PRACTICE · nothing on chain</div>
        )}
      </div>
      {live && (halted || needSats || b.error) && (
        <div className="absolute inset-x-0 top-6 z-30 flex justify-center px-2">
          <div className="flex max-w-[90%] flex-wrap items-center justify-center gap-2 border-2 border-hot bg-black/90 px-3 py-2 text-center text-sm font-bold text-hot">
            {halted ? (
              <>
                <span>⚠ BROADCAST STOPPED: {payErr ?? 'unknown error'} · paid {actions} paused</span>
                <button onClick={resume} className="btn btn-on px-2 py-0.5 text-xs">
                  RESUME
                </button>
              </>
            ) : needSats ? (
              <span>⚠ OUT OF SATS · load more below to keep going</span>
            ) : (
              <span>⚠ {b.error}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function PlayButtons({ pp, game, action, actions, onStart, practiceLabel = '▶ PLAY PRACTICE', liveLabel = '▶ PLAY LIVE' }: { pp: Paid; game: string; action: string; actions: string; onStart: () => void; practiceLabel?: string; liveLabel?: string }) {
  const { b, setPaid, resume } = pp;
  const [steps, setSteps] = useState(false);
  const enough = b.ammo >= MIN_ACTIONS * COST;
  const goLive = () => {
    resume();
    setPaid(true);
    setSteps(false);
    onStart();
  };
  // Waiting on the LOAD: start the moment the gun shows the sats.
  useEffect(() => {
    if (steps && b.wallet && enough && !b.busy) void Promise.resolve().then(goLive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, enough, b.wallet, b.busy]);
  const step = (n: number, on: boolean, done: boolean) => `flex items-center gap-1 ${done ? 'text-[#60ff90]' : on ? 'text-hot' : 'text-dim'}`;
  return (
    <div className="flex flex-col items-center gap-2" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => {
            setPaid(false);
            setSteps(false);
            onStart();
          }}
          className="btn px-4 py-2 font-bold"
        >
          {practiceLabel}
        </button>
        <button
          onClick={() => (b.wallet && enough ? goLive() : setSteps(true))}
          disabled={!HOUSE}
          title={HOUSE ? `Every ${action} is a real BSV transaction` : 'LIVE play is not switched on on this server yet'}
          className="btn-fire animate-pulse disabled:animate-none disabled:opacity-40"
        >
          {liveLabel}
        </button>
      </div>
      <p className="text-xs text-dim">
        PRACTICE: nothing on chain. LIVE: every {action} is a real tx ({PER_ACTION} sat to TokenBlaster + ~{EST_FEE} sats network fee).
      </p>
      {steps && (
        <div className="inset flex max-w-full flex-col gap-2 bg-black/80 px-3 py-2 text-left text-sm">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold tracking-widest">
            <span className={step(1, !b.wallet, Boolean(b.wallet))}>1 CONNECT {b.wallet ? '✓' : ''}</span>
            <span className="text-dim">→</span>
            <span className={step(2, Boolean(b.wallet) && !enough, enough)}>2 LOAD SATS {enough ? '✓' : ''}</span>
            <span className="text-dim">→</span>
            <span className={step(3, enough, false)}>3 PLAY LIVE</span>
          </div>
          {!b.wallet ? (
            <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on self-start">
              {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
            </button>
          ) : b.busy === 'loading' ? (
            <span className="flex items-center gap-2 text-hot">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-hot border-t-transparent" />
              Approve in your wallet… LIVE starts when the sats land in the gun.
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {LOADS.map((n) => (
                <button key={n} onClick={() => void b.load(n, `${game}: ${n.toLocaleString()} sats of ${actions}`)} disabled={!!b.busy} className="btn">
                  LOAD {n.toLocaleString()} sats <span className="text-dim">≈{Math.floor(n / COST).toLocaleString()} {actions}</span>
                </button>
              ))}
              <span className="text-xs text-dim">one approval · gun has {b.ammo.toLocaleString()} sats</span>
            </div>
          )}
          {b.error && <span className="text-hot">⚠ {b.error}</span>}
          <button onClick={() => setSteps(false)} className="self-start text-xs text-dim underline">
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function PaidPanel({ pp, game, action, actions }: { pp: Paid; game: string; action: string; actions: string }) {
  const { b, paid, setPaid, onChain, lastTx, payErr, halted, resume, needSats } = pp;
  return (
    <>
      <div className="inset mt-2 flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="text-dim">MODE:</span>
        <button onClick={() => setPaid(false)} className={`btn ${!paid ? 'btn-on' : ''}`}>
          PRACTICE · nothing on chain
        </button>
        <button onClick={() => setPaid(true)} disabled={!HOUSE} title={HOUSE ? undefined : 'LIVE play is not switched on yet'} className={`btn ${paid ? 'btn-on' : ''} disabled:opacity-40`}>
          LIVE · every {action} is a real tx
        </button>
        {paid && (
          <>
            <span className="text-dim">
              {PER_ACTION} sat to TokenBlaster + ~{EST_FEE} sats network fee per {action} ·{' '}
              <span className="text-hot">
                {Math.floor(b.ammo / COST).toLocaleString()} {actions}
              </span>{' '}
              loaded ({b.ammo.toLocaleString()} sats)
            </span>
            {!b.wallet ? (
              <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on">
                {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
              </button>
            ) : (
              LOADS.map((n) => (
                <button key={n} onClick={() => b.load(n, `${game}: ${n.toLocaleString()} sats of ${actions}`)} disabled={!!b.busy} className="btn">
                  {b.busy === 'loading' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} sats`}
                </button>
              ))
            )}
            {b.wallet && b.ammo > 0 && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn">
                UNLOAD
              </button>
            )}
            <span className="text-dim">
              on chain: <span className="text-hot">{onChain.toLocaleString()}</span>
              {lastTx && (
                <>
                  {' · '}
                  <a href={txUrl(lastTx)} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    last tx ↗
                  </a>
                </>
              )}
            </span>
          </>
        )}
      </div>
      {paid && needSats && <p className="mt-1 text-sm text-hot">Out of sats: load more to keep playing.</p>}
      {(payErr || b.error) && (
        <p className="mt-1 text-sm font-bold text-hot">
          ⚠ {payErr ?? b.error}
          {halted && (
            <>
              {' '}· paid {actions} paused{' '}
              <button onClick={resume} className="btn btn-on px-2 py-0.5 text-xs">
                RESUME
              </button>
            </>
          )}
        </p>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </>
  );
}
