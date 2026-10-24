'use client';

/**
 * The coin-op cabinet front (owner, 24 Oct 2026): CREDIT counter, coin buttons that add to a running total
 * (nothing is paid per press), CLEAR, one PAY button (one wallet approval for the whole total), a LOADING AMMO
 * progress state, then NAME and the big centred LOCK & LOAD / START. Presentational only: the gate
 * (CoinOpGate) and the Shooting Gallery feed it.
 */
import { DR } from '@/lib/dr/tokens';
import { COINS_USD, MIN_CREDIT_USD, fmtCredit, hasCredit, typingName, cleanName } from '@/lib/coinop/credit';
import { HazardBar } from '../dr';

export type LoadStage = null | 'approve' | 'loading' | 'ready';

export function CreditCounter({ usd, label = 'CREDIT' }: { usd: number; label?: string }) {
  return (
    <div className="inline-flex items-baseline gap-3 border-2 bg-black px-4 py-2" style={{ borderColor: DR.colour.amber, fontFamily: DR.font.mono }} aria-live="polite">
      <span className="text-xs tracking-[0.35em]" style={{ color: DR.colour.amber }}>
        {label}
      </span>
      <span className="text-[clamp(28px,6vw,44px)] font-bold leading-none tabular-nums" style={{ color: DR.colour.amber, textShadow: `0 0 12px ${DR.colour.amber}` }} data-credit>
        {fmtCredit(usd)}
      </span>
    </div>
  );
}

export function CoinCabinet(p: {
  title: string;
  creditUsd: number;
  pendingUsd: number;
  bsvUsd: number | null;
  onCoin: (usd: number) => void;
  onClear: () => void;
  onPay: () => void;
  stage: LoadStage;
  /** Shown under the progress bar while loading ammo. */
  stageText?: string | null;
  name: string;
  setName: (s: string) => void;
  priceUsd: number;
  priceNote: string;
  startLabel?: string;
  onStart: () => void;
  starting?: boolean;
  /** START is not available yet for another reason (scene loading, weapon locked). */
  blocked?: boolean;
  walletLabel?: string | null;
  error?: string | null;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const credit = hasCredit(p.creditUsd, MIN_CREDIT_USD);
  const ready = credit && p.stage !== 'approve' && p.stage !== 'loading';
  const enough = hasCredit(p.creditUsd, p.priceUsd);
  const startOk = ready && enough && cleanName(p.name) !== null && !p.starting && !p.blocked;
  const busy = p.stage === 'approve' || p.stage === 'loading';
  const pct = p.stage === 'approve' ? 20 : p.stage === 'loading' ? 65 : 100;
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center" style={{ fontFamily: DR.font.mono }} onKeyDown={(e) => e.stopPropagation()}>
      <p className="text-[10px] tracking-[0.3em] text-dim">TOKENBLASTER COIN-OP · {p.title.toUpperCase()}</p>
      <CreditCounter usd={p.creditUsd} />

      {/* INSERT COIN: each press adds to the total; PAY is the one wallet approval. */}
      <div className="flex w-full max-w-[680px] flex-col items-center gap-2">
        <p className="text-xs tracking-[0.3em]" style={{ color: DR.colour.paper }}>
          INSERT COIN
        </p>
        <div className="flex w-full flex-wrap justify-center gap-2 sm:gap-4">
          {COINS_USD.map((c) => (
            <button
              key={c}
              type="button"
              data-fs-skip
              data-coin
              disabled={busy}
              onClick={() => p.onCoin(c)}
              className="coin-face grid aspect-square w-[64px] place-items-center rounded-full border-4 text-[22px] font-black leading-none tabular-nums transition hover:scale-105 active:scale-95 disabled:opacity-40 sm:w-[104px] sm:text-[36px]"
              style={{ fontFamily: DR.font.display, borderColor: '#fff3c4', color: DR.colour.ink, background: `radial-gradient(circle at 35% 30%, #fff3c4, ${DR.colour.amber} 45%, #9a6a00)`, boxShadow: `0 0 0 3px #5a3d00, 0 6px 0 #5a3d00, 0 0 18px ${DR.colour.amber}80` }}
              aria-label={`Add ${fmtCredit(c)}`}
            >
              {c < 1 ? `${Math.round(c * 100)}¢` : `$${c}`}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-dim">
            To pay: <span className="tabular-nums" style={{ color: DR.colour.paper }} data-pending>{fmtCredit(p.pendingUsd)}</span>
            {p.bsvUsd ? <span className="text-[10px]"> · BSV ${p.bsvUsd.toFixed(2)}</span> : <span className="text-[10px]"> · pricing…</span>}
          </span>
          <button type="button" data-fs-skip disabled={busy || p.pendingUsd <= 0} onClick={p.onClear} className="btn px-4 py-3 text-sm">
            CLEAR
          </button>
          <button type="button" data-fs-skip disabled={busy || p.pendingUsd <= 0 || !p.bsvUsd} onClick={p.onPay} className="btn-fire w-full max-w-[420px] px-6 py-4 text-[clamp(22px,4.5vw,34px)] font-black tracking-widest">
            {busy ? 'APPROVE IN WALLET…' : `PAY ${fmtCredit(p.pendingUsd)}`}
          </button>
        </div>
        <p className="text-[10px] text-dim">One wallet approval for the whole total ({p.walletLabel ?? 'bWalletX or any BRC-100 wallet'}). The credit sits in your own in-browser gun; UNLOAD returns what is left.</p>
      </div>

      {p.stage && p.stage !== 'ready' && (
        <div className="w-full max-w-[420px]" role="status">
          <p className="mb-1 text-xs tracking-[0.3em]" style={{ color: DR.colour.cyan }}>
            {p.stage === 'approve' ? 'WAITING FOR YOUR WALLET…' : 'LOADING AMMO…'}
          </p>
          <div className="h-2.5 border border-white/30 bg-black">
            <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: DR.colour.signal }} />
          </div>
          {p.stageText && <p className="mt-1 text-[10px] text-dim">{p.stageText}</p>}
        </div>
      )}

      {p.extra}

      {/* NAME: only once credit is in and the rounds are loaded. */}
      <label className="flex w-full max-w-[420px] flex-col items-center gap-1">
        <span className="text-xs tracking-[0.3em]" style={{ color: ready ? DR.colour.paper : 'rgba(255,255,255,.35)' }}>
          NAME
        </span>
        <input
          value={p.name}
          onChange={(e) => p.setName(typingName(e.target.value))}
          disabled={!ready}
          maxLength={20}
          placeholder={ready ? 'your name (a-z, 0-9, _)' : `insert ${fmtCredit(MIN_CREDIT_USD)} first`}
          className="w-full border-2 bg-black px-3 py-2 text-center text-lg uppercase tracking-[0.2em] outline-none disabled:opacity-40"
          style={{ borderColor: ready ? DR.colour.amber : 'rgba(255,255,255,.2)', color: DR.colour.amber }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Player name"
        />
      </label>

      <HazardBar h={8} />
      <button
        type="button"
        data-fs-start
        disabled={!startOk}
        onClick={p.onStart}
        className="lock-load mx-auto w-full max-w-[560px] -skew-x-6 px-6 py-5 text-[clamp(32px,7vw,64px)] font-black uppercase italic leading-none tracking-[0.12em] transition hover:scale-[1.02] active:scale-[0.98] disabled:animate-none disabled:opacity-40"
        style={{ fontFamily: DR.font.display, background: `linear-gradient(180deg, #ff4a3d, ${DR.colour.signal} 55%, #8f0f08)`, color: DR.colour.paper, border: `3px solid ${DR.colour.paper}`, textShadow: '0 3px 0 rgba(0,0,0,.45)' }}
      >
        {p.starting ? 'Paying…' : (p.startLabel ?? 'Lock & load ▶')}
      </button>
      <p className="text-[11px] text-dim">
        {!credit ? 'Insert coin, then PAY.' : !ready ? 'Loading your rounds…' : !enough ? `Not enough credit: ${p.priceNote}` : !cleanName(p.name) ? 'Type your NAME to start.' : p.priceNote}
      </p>
      {p.error && <p className="text-sm text-hot">⚠ {p.error}</p>}
      {p.footer}
    </div>
  );
}
