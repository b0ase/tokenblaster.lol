'use client';

/**
 * The coin-op cabinet front (owner, 24 Oct 2026): CREDIT counter, big coin buttons that add to a running total
 * (nothing is paid per press), a live "what this buys" readout, CLEAR, NAME, and the big centred
 * LOCK & LOAD / START. START is the bill: it sends ONE wallet request for the whole total, shows the
 * loading-ammo progress, and the caller starts the game by itself once the rounds are ready.
 * Presentational only: CoinOpGate and the Shooting Gallery feed it.
 */
import { DR } from '@/lib/dr/tokens';
import { COINS_USD, MIN_CREDIT_USD, addCoin, cleanName, fmtCredit, hasCredit, typingName } from '@/lib/coinop/credit';

export type LoadStage = null | 'approve' | 'loading' | 'ready';

export function CreditCounter({ usd, label = 'CREDIT' }: { usd: number; label?: string }) {
  return (
    <div className="inline-flex items-baseline gap-3 border-2 bg-black px-4 py-1" style={{ borderColor: DR.colour.amber, fontFamily: DR.font.mono }} aria-live="polite">
      <span className="text-xs tracking-[0.35em]" style={{ color: DR.colour.amber }}>
        {label}
      </span>
      <span className="text-[clamp(26px,5vw,38px)] font-bold leading-none tabular-nums" style={{ color: DR.colour.amber, textShadow: `0 0 12px ${DR.colour.amber}` }} data-credit>
        {fmtCredit(usd)}
      </span>
    </div>
  );
}

const coinFace = (c: number) => (c < 1 ? `${Math.round(c * 100)}¢` : `$${c}`);

export function CoinCabinet(p: {
  title: string;
  creditUsd: number;
  pendingUsd: number;
  bsvUsd: number | null;
  onCoin: (usd: number) => void;
  onClear: () => void;
  stage: LoadStage;
  stageText?: string | null;
  name: string;
  setName: (s: string) => void;
  priceUsd: number;
  priceNote: string;
  /** What a dollar amount buys, e.g. shots or plays (null while there is no price). */
  buys?: (usd: number) => number | null;
  unit?: string;
  startLabel?: string;
  /** START: pays the pending total (one approval) and then starts by itself. */
  onStart: () => void;
  starting?: boolean;
  blocked?: boolean;
  error?: string | null;
}) {
  const total = addCoin(p.creditUsd, p.pendingUsd);
  const busy = p.stage === 'approve' || p.stage === 'loading' || Boolean(p.starting);
  const nameOk = hasCredit(total, MIN_CREDIT_USD);
  const enough = hasCredit(total, p.priceUsd);
  const startOk = nameOk && enough && cleanName(p.name) !== null && !busy && !p.blocked && Boolean(p.bsvUsd);
  const pct = p.stage === 'approve' ? 25 : p.stage === 'loading' ? 70 : 100;
  const unit = p.unit ?? 'plays';
  const n = (usd: number) => {
    const v = p.buys?.(usd);
    return v == null ? '…' : v.toLocaleString('en-US');
  };
  const payLabel = p.pendingUsd > 0 ? ` · PAY ${fmtCredit(p.pendingUsd)}` : '';
  return (
    <div className="flex w-full flex-col items-center gap-2 text-center" style={{ fontFamily: DR.font.mono }} onKeyDown={(e) => e.stopPropagation()}>
      <p className="text-[10px] tracking-[0.3em] text-dim">TOKENBLASTER COIN-OP · {p.title.toUpperCase()}</p>
      <CreditCounter usd={p.creditUsd} />

      {/* INSERT COIN: each press adds to the total. START below is the one wallet approval. */}
      <div className="flex w-full max-w-[680px] flex-col items-center gap-2">
        <p className="text-xs tracking-[0.3em]" style={{ color: DR.colour.paper }}>
          INSERT COIN
        </p>
        <div className="flex w-full flex-wrap justify-center gap-2 sm:gap-4">
          {COINS_USD.map((c) => (
            <div key={c} className="flex flex-col items-center gap-1">
              <button
                type="button"
                data-fs-skip
                data-coin
                disabled={busy}
                onClick={() => p.onCoin(c)}
                className="grid aspect-square w-[64px] place-items-center rounded-full border-4 text-[22px] font-black leading-none tabular-nums transition hover:scale-105 active:scale-95 disabled:opacity-40 sm:w-[96px] sm:text-[34px]"
                style={{ fontFamily: DR.font.display, borderColor: '#fff3c4', color: DR.colour.ink, background: `radial-gradient(circle at 35% 30%, #fff3c4, ${DR.colour.amber} 45%, #9a6a00)`, boxShadow: `0 0 0 3px #5a3d00, 0 6px 0 #5a3d00, 0 0 18px ${DR.colour.amber}80` }}
                aria-label={`Add ${fmtCredit(c)}`}
              >
                {coinFace(c)}
              </button>
              {p.buys && <span className="max-w-[96px] text-[9px] leading-tight text-dim sm:text-[11px]">= {n(c)}</span>}
            </div>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-[clamp(18px,3.2vw,28px)] font-bold tabular-nums" style={{ color: DR.colour.paper }} data-pending>
            {fmtCredit(p.pendingUsd)}
            {p.buys && (
              <span style={{ color: DR.colour.amber }}>
                {' '}→ {n(total)} {unit}
              </span>
            )}
          </span>
          <button type="button" data-fs-skip disabled={busy || p.pendingUsd <= 0} onClick={p.onClear} className="btn px-4 py-2 text-sm">
            CLEAR
          </button>
        </div>
        <p className="text-[10px] text-dim">{p.bsvUsd ? `Live price: BSV $${p.bsvUsd.toFixed(2)}.` : 'Pricing…'} {p.priceNote}</p>
        <p className="text-xs font-bold" style={{ color: DR.colour.paper }} data-norefund>
          No refunds. Only put in what you want to spend. Playing multiplayer? Put in as much as you&apos;ll need.
        </p>
      </div>

      {/* NAME: once at least the minimum is in (loaded or about to be paid). */}
      <label className="flex w-full max-w-[520px] items-center gap-2">
        <span className="text-xs tracking-[0.3em]" style={{ color: nameOk ? DR.colour.paper : 'rgba(255,255,255,.35)' }}>
          NAME
        </span>
        <input
          value={p.name}
          onChange={(e) => p.setName(typingName(e.target.value))}
          disabled={!nameOk || busy}
          maxLength={20}
          placeholder={nameOk ? 'your name (a-z, 0-9, _)' : `insert ${fmtCredit(MIN_CREDIT_USD)} first`}
          className="w-full border-2 bg-black px-3 py-1.5 text-center text-lg uppercase tracking-[0.2em] outline-none disabled:opacity-40"
          style={{ borderColor: nameOk ? DR.colour.amber : 'rgba(255,255,255,.2)', color: DR.colour.amber }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Player name"
        />
      </label>

      {p.stage && p.stage !== 'ready' && (
        <div className="w-full max-w-[420px]" role="status">
          <p className="mb-1 text-xs tracking-[0.3em]" style={{ color: DR.colour.cyan }}>
            {p.stage === 'approve' ? 'APPROVE IN YOUR WALLET…' : 'LOADING AMMO…'}
          </p>
          <div className="h-2.5 border border-white/30 bg-black">
            <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: DR.colour.signal }} />
          </div>
          {p.stageText && <p className="mt-1 text-[10px] text-dim">{p.stageText}</p>}
        </div>
      )}

      <button
        type="button"
        data-fs-start
        disabled={!startOk}
        onClick={p.onStart}
        className="lock-load mx-auto w-full max-w-[600px] -skew-x-6 px-6 py-4 text-[clamp(28px,5.5vw,52px)] font-black uppercase italic leading-none tracking-[0.1em] transition hover:scale-[1.02] active:scale-[0.98] disabled:animate-none disabled:opacity-40"
        style={{ fontFamily: DR.font.display, background: `linear-gradient(180deg, #ff4a3d, ${DR.colour.signal} 55%, #8f0f08)`, color: DR.colour.paper, border: `3px solid ${DR.colour.paper}`, textShadow: '0 3px 0 rgba(0,0,0,.45)' }}
      >
        {busy ? 'Loading…' : `${p.startLabel ?? 'Lock & load'}${payLabel} ▶`}
      </button>
      <p className="text-[11px] text-dim">
        {!nameOk ? `Insert at least ${fmtCredit(MIN_CREDIT_USD)}.` : !enough ? `Not enough: one play is ${fmtCredit(p.priceUsd)}.` : !cleanName(p.name) ? 'Type your NAME.' : p.pendingUsd > 0 ? 'One wallet approval for the whole total, then the game starts by itself.' : 'Ready.'}
      </p>
      {p.error && <p className="text-sm text-hot">⚠ {p.error}</p>}
    </div>
  );
}
