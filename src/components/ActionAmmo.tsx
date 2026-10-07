'use client';

/**
 * The LIVE token-blasting panel every arcade game shares (src/lib/useActionPay.ts): arm LIVE, pick SATS or a
 * token (the game's house coin first), LOAD / UNLOAD, see what each action costs and how many are loaded.
 * <ActionHud> is the small "N txs" counter for the game canvas.
 */
import { HazardBar, Sticker } from './dr';
import { DR } from '@/lib/dr/tokens';
import { houseFirst, houseHeld, HOUSE_GOLD } from '@/lib/gameCoins';
import { EST_FEE, PER_ACTION, SAT_LOADS, TOKEN_FEE, TOKEN_LOADS } from '@/lib/actionPay';
import type { ActionPay } from '@/lib/useActionPay';
import { BuyHouse, HouseBadge } from './HouseAmmo';
import { WalletChooser } from './WalletChooser';

export function ActionAmmo({ ap, actions }: { ap: ActionPay; actions: string }) {
  const { b } = ap;
  const held = ap.house ? houseHeld(b.tokens, ap.house) : 0;
  const tokenList = houseFirst(b.tokens, ap.house).slice(0, 4);
  const tokLoads = TOKEN_LOADS.filter((n) => n <= Math.floor(ap.token?.balance ?? 0));
  return (
    <div className="inset w-full max-w-xl text-left text-sm" onKeyDown={(e) => e.stopPropagation()} data-testid="action-ammo">
      <HazardBar colour={ap.armed ? DR.colour.amber : 'var(--border-dim)'} h={6} />
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sticker size={13} rot={-2} bg={ap.armed ? 'var(--accent-fill)' : 'var(--border-dim)'} fg="var(--on-accent)">
            LIVE BLASTING
          </Sticker>
          <button onClick={() => ap.setArmed(!ap.armed)} aria-pressed={ap.armed} className={`btn ${ap.armed ? 'btn-on' : ''}`} data-testid="arm-live">
            {ap.armed ? '● ON' : '○ OFF'}
          </button>
          <span className="text-dim">
            {ap.armed ? (
              <>
                Each <b className="text-hot">{actions}</b> = 1 real tx on paid runs.
              </>
            ) : (
              <>Optional: make every {actions} a real transaction.</>
            )}
          </span>
        </div>
        {ap.armed && (
          <>
            <p className="text-xs text-muted">
              Cost per action: {ap.payToken ? `1 $${ap.sym} + ~${TOKEN_FEE} sats fuel` : `${PER_ACTION} sat + ~${EST_FEE} sats network fee`}, to TokenBlaster. Only on PLAY · 10p runs: PRACTICE sends nothing.
              Load first, then play.
            </p>
            {!b.wallet && !ap.stub ? (
              <div>
                <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on">
                  {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET TO LOAD'}
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-dim">PAY:</span>
                  <button onClick={ap.chooseSats} disabled={!!b.busy} className={`btn ${!ap.payToken ? 'btn-on' : ''}`}>
                    SATS
                  </button>
                  {tokenList.map((t) => (
                    <button key={t.id} onClick={() => ap.chooseToken(t)} disabled={!!b.busy} className={`btn flex items-center gap-1 ${ap.payToken && ap.token?.id === t.id ? 'btn-on' : ''}`} style={ap.house?.id === t.id ? { borderColor: HOUSE_GOLD } : undefined}>
                      ${t.sym} {ap.house?.id === t.id && <HouseBadge label="HOUSE" />}
                    </button>
                  ))}
                  {ap.house && !held && <BuyHouse coin={ap.house} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {ap.payToken
                    ? tokLoads.map((n) => (
                        <button key={n} onClick={() => void b.loadTokenAmmo(n)} disabled={!!b.busy} className="btn">
                          {b.busy === 'loading-tokens' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} $${ap.sym}`}
                        </button>
                      ))
                    : SAT_LOADS.map((n) => (
                        <button key={n} onClick={() => void b.load(n, `${ap.title}: ${n.toLocaleString()} sats of live actions`)} disabled={!!b.busy} className="btn">
                          {b.busy === 'loading' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} sats`}
                        </button>
                      ))}
                  {b.wallet && (b.ammo > 0 || b.gunTokens.length > 0) && (
                    <button onClick={b.unload} disabled={!!b.busy} className="btn">
                      UNLOAD
                    </button>
                  )}
                </div>
                <p className="text-dim">
                  <span className="text-hot" data-testid="actions-loaded">
                    {ap.loaded.toLocaleString()} actions
                  </span>{' '}
                  loaded{ap.stub ? ' (dev stub: nothing is broadcast)' : ''} · sent: <span className="text-hot">{ap.sent.toLocaleString()}</span>
                  {ap.lastTx && !ap.stub && (
                    <>
                      {' · '}
                      <a href={`https://whatsonchain.com/tx/${ap.lastTx}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                        last tx ↗
                      </a>
                    </>
                  )}
                </p>
                {ap.loaded < 1 && <p className="font-bold text-accent">Nothing loaded yet: press LOAD above, approve it, then play.</p>}
              </>
            )}
          </>
        )}
        <AmmoAlerts ap={ap} />
      </div>
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </div>
  );
}

/** Out-of-ammo / broadcast-stopped lines (also shown under the canvas mid-run). */
export function AmmoAlerts({ ap }: { ap: ActionPay }) {
  return (
    <>
      {ap.live && ap.needAmmo && <p className="font-bold text-accent">Out of ammo: load more to keep blasting.</p>}
      {(ap.payErr || ap.b.error) && (
        <p className="text-accent">
          ⚠ {ap.payErr ?? ap.b.error}{' '}
          <button onClick={ap.resume} className="btn">
            RESUME
          </button>
        </p>
      )}
    </>
  );
}

/** HUD counter for the canvas: "LIVE · N txs" while a live run is blasting. */
export function ActionHud({ ap, className = '' }: { ap: ActionPay; className?: string }) {
  if (!ap.live) return null;
  return (
    <span className={`pointer-events-none rounded-sm px-1.5 py-0.5 text-xs font-bold ${className}`} style={{ background: 'var(--accent-fill)', color: 'var(--on-accent)' }} data-testid="tx-hud">
      LIVE · {ap.sent.toLocaleString()} {ap.sent === 1 ? 'tx' : 'txs'}{ap.needAmmo ? ' · OUT OF AMMO' : ''}
    </span>
  );
}
