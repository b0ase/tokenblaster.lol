'use client';

/** PRACTICE / PAID mode switch + wallet controls for arcade games using usePaidPlay. */
import { EST_FEE, HOUSE, LOADS, PER_ACTION, type usePaidPlay } from '@/lib/usePaidPlay';
import { WalletChooser } from './WalletChooser';

type Paid = ReturnType<typeof usePaidPlay>;

export function PaidPanel({ pp, game, action, actions }: { pp: Paid; game: string; action: string; actions: string }) {
  const { b, paid, setPaid, onChain, lastTx, payErr, needSats } = pp;
  return (
    <>
      <div className="inset mt-2 flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="text-dim">MODE:</span>
        <button onClick={() => setPaid(false)} className={`btn ${!paid ? 'btn-on' : ''}`}>
          PRACTICE · nothing on chain
        </button>
        <button onClick={() => setPaid(true)} disabled={!HOUSE} title={HOUSE ? undefined : 'Paid play is not switched on yet'} className={`btn ${paid ? 'btn-on' : ''} disabled:opacity-40`}>
          PAID · every {action} is a real tx
        </button>
        {paid && (
          <>
            <span className="text-dim">
              {PER_ACTION} sat to TokenBlaster + ~{EST_FEE} sats network fee per {action} ·{' '}
              <span className="text-hot">
                {Math.floor(b.ammo / (PER_ACTION + EST_FEE)).toLocaleString()} {actions}
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
                  <a href={`https://whatsonchain.com/tx/${lastTx}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    last tx ↗
                  </a>
                </>
              )}
            </span>
          </>
        )}
      </div>
      {paid && needSats && <p className="mt-1 text-sm text-hot">Out of sats: load more to keep playing.</p>}
      {(payErr || b.error) && <p className="mt-1 text-sm text-hot">⚠ {payErr ?? b.error}</p>}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </>
  );
}
