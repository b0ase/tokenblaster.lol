'use client';

/**
 * The coin-op cabinet front (owner, 24 Oct 2026): CREDIT counter, big coin buttons that add to a running total
 * (nothing is paid per press), a live "what this buys" readout, CLEAR, NAME, and the big centred
 * LOCK & LOAD / START. START is the bill: it sends ONE wallet request for the whole total, shows the
 * loading-ammo progress, and the caller starts the game by itself once the rounds are ready.
 * Presentational only: CoinOpGate and the Shooting Gallery feed it.
 */
import { useRef, useState } from 'react';
import { DR } from '@/lib/dr/tokens';
import { sfx, unlockAudio } from '@/lib/sfx';
import { CoinFace, CoinSlot, ControlPanel, SevenSeg } from './hardware';
import { COINS_USD, MIN_CREDIT_USD, addCoin, cleanName, fmtCredit, hasCredit, typingName } from '@/lib/coinop/credit';

export type LoadStage = null | 'approve' | 'loading' | 'ready';

type Missing = 'coin' | 'more' | 'name' | 'bad' | 'price' | 'wait';
const MISSING: Record<Missing, string> = {
  coin: 'Put a coin in first.',
  more: 'Put another coin in: this game needs a little more.',
  name: 'Type your name to play.',
  bad: 'Names are letters, numbers and _ (up to 20).',
  price: 'Checking the price. Try again in a moment.',
  wait: 'The game is still loading. One moment.',
};

export function CreditCounter({ usd, label = 'CREDIT' }: { usd: number; label?: string }) {
  return <SevenSeg text={fmtCredit(usd)} label={label} />;
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
  const nameRef = useRef<HTMLInputElement>(null);
  const [miss, setMiss] = useState<Missing | null>(null);
  const [flash, setFlash] = useState(false);
  const nameMiss = miss === 'name' || miss === 'bad';
  // A coin pressed drops into the slot (animation + clink).
  const slotRef = useRef<HTMLDivElement>(null);
  const dropN = useRef(0);
  const [drops, setDrops] = useState<{ id: number; usd: number; dx: number; dy: number }[]>([]);
  const insert = (c: number, el: HTMLElement) => {
    unlockAudio();
    sfx('coin');
    p.onCoin(c);
    if (miss === 'coin' || miss === 'more') setMiss(null);
    const slot = slotRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!slot) return;
    const id = ++dropN.current;
    setDrops((d) => [...d.slice(-5), { id, usd: c, dx: r.left + r.width / 2 - (slot.left + slot.width / 2), dy: r.top + r.height / 2 - (slot.top + slot.height / 2) }]);
    setTimeout(() => setDrops((d) => d.filter((x) => x.id !== id)), 600);
  };
  const [down, setDown] = useState(false);
  /** START is always clickable: say plainly what is missing (owner, 24 Oct 2026: no silent failures). */
  const press = () => {
    const why: Missing | null = !nameOk ? 'coin' : !enough ? 'more' : !p.name ? 'name' : !cleanName(p.name) ? 'bad' : !p.bsvUsd ? 'price' : p.blocked ? 'wait' : null;
    setMiss(why);
    sfx('click');
    if (!why) return p.onStart();
    if (why === 'name' || why === 'bad') {
      nameRef.current?.focus();
      setFlash(true);
      setTimeout(() => setFlash(false), 450);
    }
  };
  const pct = p.stage === 'approve' ? 25 : p.stage === 'loading' ? 70 : 100;
  const unit = p.unit ?? 'plays';
  const n = (usd: number) => {
    const v = p.buys?.(usd);
    return v == null ? '…' : v.toLocaleString('en-US');
  };
  const payLabel = p.pendingUsd > 0 ? ` · PAY ${fmtCredit(p.pendingUsd)}` : '';
  return (
    <ControlPanel>
    <div className="flex w-full flex-col items-center gap-2 text-center" style={{ fontFamily: DR.font.mono }} onKeyDown={(e) => e.stopPropagation()}>
      <p className="text-[10px] tracking-[0.3em] text-dim">TOKENBLASTER COIN-OP · {p.title.toUpperCase()}</p>
      <CreditCounter usd={p.creditUsd} />

      {/* INSERT COIN: each press adds to the total. START below is the one wallet approval. */}
      <div className="flex w-full max-w-[680px] flex-col items-center gap-2">
        <p className="text-xs tracking-[0.3em]" style={{ color: DR.colour.paper }}>
          INSERT COIN
        </p>
        <div className="flex w-full flex-wrap justify-center gap-1.5 sm:gap-4">
          {COINS_USD.map((c) => (
            <div key={c} className="flex flex-col items-center gap-1">
              <button
                type="button"
                data-fs-skip
                data-coin
                disabled={busy}
                onClick={(e) => insert(c, e.currentTarget)}
                className="hw-coin aspect-square w-[54px] disabled:opacity-40 sm:w-[90px]"
                aria-label={`Add ${fmtCredit(c)}`}
              >
                <CoinFace usd={c} label={coinFace(c)} />
              </button>
              {p.buys && <span className="max-w-[90px] text-[9px] leading-tight text-dim sm:text-[11px]">= {n(c)}</span>}
            </div>
          ))}
        </div>
        <div ref={slotRef} className="relative w-full">
          <CoinSlot lit={!nameOk}>
            {drops.map((d) => (
              <span key={d.id} className="hw-drop left-1/2 top-1/2 -ml-[22px] -mt-[22px] h-[44px] w-[44px]" style={{ ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px` }}>
                <CoinFace usd={d.usd} label={coinFace(d.usd)} />
              </span>
            ))}
          </CoinSlot>
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

      {/* NAME: always editable; START checks everything and says plainly what is missing. */}
      <label className="flex w-full max-w-[520px] flex-col items-center gap-1">
        <span className="text-xs tracking-[0.3em]" style={{ color: DR.colour.paper }}>
          YOUR NAME
        </span>
        <input
          ref={nameRef}
          value={p.name}
          onChange={(e) => {
            p.setName(typingName(e.target.value));
            if (miss === 'name' || miss === 'bad') setMiss(null);
          }}
          disabled={busy}
          maxLength={20}
          placeholder="Your name"
          className={`w-full border-2 bg-black px-3 py-1.5 text-center text-lg uppercase tracking-[0.2em] outline-none disabled:opacity-40 ${flash ? 'coinop-shake' : ''}`}
          style={{ borderColor: nameMiss ? '#ff3b30' : DR.colour.amber, boxShadow: nameMiss ? '0 0 0 2px #ff3b30' : undefined, color: DR.colour.amber }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Your name"
          aria-invalid={nameMiss}
        />
        {nameMiss && <span className="text-sm font-bold" style={{ color: '#ff6b5e' }}>{MISSING[miss!]}</span>}
      </label>

      {p.stage && p.stage !== 'ready' && (
        <div className="w-full max-w-[420px]" role="status">
          <p className="mb-1 text-sm font-bold" style={{ color: DR.colour.cyan }}>
            {p.stage === 'approve' ? 'Waiting for you to approve in your wallet…' : 'Loading…'}
          </p>
          <div className="h-3 border border-white/30 bg-black">
            <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: DR.colour.signal }} />
          </div>
          {p.stageText && <p className="mt-1 text-xs text-dim">{p.stageText}</p>}
        </div>
      )}

      <div className="hw-button-bezel lock-load mx-auto w-full max-w-[560px]">
        <button
          type="button"
          data-fs-start
          data-down={down ? '1' : '0'}
          disabled={busy}
          onPointerDown={() => setDown(true)}
          onPointerUp={() => setDown(false)}
          onPointerLeave={() => setDown(false)}
          onClick={press}
          className="hw-button px-6 py-4 text-[clamp(26px,5vw,48px)] font-black uppercase italic leading-none tracking-[0.08em]"
          style={{ fontFamily: DR.font.display, color: DR.colour.paper, textShadow: '0 3px 0 rgba(0,0,0,.45)', opacity: startOk || busy ? undefined : 0.85 }}
        >
          {busy ? 'Loading…' : `${p.startLabel ?? 'Lock & load'}${payLabel}`}
        </button>
      </div>
      <p className={`text-sm ${miss ? 'font-bold' : 'text-dim'}`} style={miss ? { color: '#ff6b5e' } : undefined} data-start-reason>
        {miss && !nameMiss ? MISSING[miss] : nameMiss ? '' : p.pendingUsd > 0 ? 'One wallet approval for the whole total, then the game starts by itself.' : nameOk ? 'Ready.' : 'Put a coin in, type your name, then press the button.'}
      </p>
      {p.error && <p className="text-sm text-hot">⚠ {p.error}</p>}
    </div>
    </ControlPanel>
  );
}
