'use client';

/**
 * The coin-op cabinet front (owner, 24 Oct 2026): CREDIT counter, big coin buttons that add to a running total
 * (nothing is paid per press), a live "what this buys" readout, CLEAR, NAME, and the big centred
 * LOCK & LOAD / START. START is the bill: it sends ONE wallet request for the whole total, shows the
 * loading-ammo progress, and the caller starts the game by itself once the rounds are ready.
 * Presentational only: CoinOpGate and the Shooting Gallery feed it.
 */
import { useRef, useState } from 'react';
import { sfx, unlockAudio } from '@/lib/sfx';
import { CoinFace, CoinSlot, ControlPanel, SevenSeg } from './hardware';
import { Icon, Modal, Ticker, useWaitSecs } from './ui';
import { loadMark } from '@/lib/gun';
import type { CabModal } from './useCabinet';
import { COINS_USD, MIN_CREDIT_USD, addCoin, cleanName, fmtCredit, hasCredit, typingName } from '@/lib/coinop/credit';

export type LoadStage = null | 'approve' | 'loading' | 'ready';

type Missing = 'coin' | 'more' | 'name' | 'bad' | 'price' | 'wait';
const MISSING: Record<Missing, string> = {
  coin: 'Put a coin in first.',
  more: 'Put another coin in: this game needs a little more.',
  name: 'Type your name to play.',
  bad: 'Use your paymail (like you@bwalletx.com) or a name of letters, numbers and _ (up to 20).',
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
  /** A plain note above the button, e.g. "You have $X of ammo loaded. Press LOCK & LOAD." */
  note?: string | null;
  /** False: the wallet stopped answering (a badge shows at once). */
  walletLive?: boolean;
  walletName?: string | null;
}) {
  const total = addCoin(p.creditUsd, p.pendingUsd);
  const busy = p.stage === 'approve' || p.stage === 'loading' || Boolean(p.starting);
  const nameOk = hasCredit(total, MIN_CREDIT_USD);
  const enough = hasCredit(total, p.priceUsd);
  const startOk = nameOk && enough && cleanName(p.name) !== null && !busy && !p.blocked && Boolean(p.bsvUsd);
  const nameRef = useRef<HTMLInputElement>(null);
  const [miss, setMiss] = useState<Missing | null>(null);
  // The minimum to play is a total, not one coin (owner, 24 Oct: put 3¢ in and was told "put a coin in first").
  const short = Math.max(0, MIN_CREDIT_USD - total);
  const missText = (m: Missing) =>
    m === 'coin' && total > 0 ? `The minimum to play is ${fmtCredit(MIN_CREDIT_USD)}. Add ${fmtCredit(short)} more.` : m === 'coin' ? `Put at least ${fmtCredit(MIN_CREDIT_USD)} in to play.` : MISSING[m];
  const [flash, setFlash] = useState(false);
  const [nameModal, setNameModal] = useState(false);
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
    sfx(why ? 'hurt' : 'click');
    loadMark(why ? `start blocked: ${missText(why)}` : 'start pressed');
    if (!why) return p.onStart();
    if (why === 'name' || why === 'bad') {
      setNameModal(true);
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
  const paySub = p.pendingUsd > 0 ? `PAY ${fmtCredit(p.pendingUsd)}` : null;
  const pendingBuys = p.buys ? p.buys(total) : null;
  return (
    <ControlPanel>
      <div className="flex w-full flex-col gap-5" onKeyDown={(e) => e.stopPropagation()}>
        {/* Marquee: what this machine is, and the LED credit. Coins show in CREDIT the moment they drop in. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="tbx-eyebrow">Coin-op</p>
            <p className="tbx-display text-[clamp(22px,3.4vw,30px)]">{p.title}</p>
          </div>
          <CreditCounter usd={total} />
        </div>

        {/* INSERT COIN: each press adds to the total. The big red button below is the one wallet approval. */}
        <section aria-label="Insert coin" className="flex flex-col items-center gap-3">
          <div className="flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--tbx-line-hi)]" />
            <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}>
              <Icon name="coin" size={14} /> Insert coin
            </p>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--tbx-line-hi)]" />
          </div>
          <div className="grid w-full grid-cols-5 gap-1.5 sm:gap-4">
            {COINS_USD.map((c) => (
              <div key={c} className="flex flex-col items-center gap-1.5">
                <button type="button" data-fs-skip data-coin disabled={busy} onClick={(e) => insert(c, e.currentTarget)} className="tbx-coin aspect-square w-full max-w-[84px] disabled:opacity-40" aria-label={`Add ${fmtCredit(c)}`}>
                  <CoinFace usd={c} label={coinFace(c)} />
                </button>
                {p.buys && <span className="tbx-num text-center text-[10px] leading-tight text-[var(--tbx-dim)] sm:text-xs">{n(c)}</span>}
              </div>
            ))}
          </div>
          <div ref={slotRef} className="relative w-full">
            <CoinSlot lit={!nameOk}>
              {drops.map((d) => (
                <span key={d.id} className="tbx-drop left-1/2 top-1/2 -ml-[22px] -mt-[22px] h-[44px] w-[44px]" style={{ ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px` }}>
                  <CoinFace usd={d.usd} label={coinFace(d.usd)} />
                </span>
              ))}
            </CoinSlot>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-2" data-pending>
              <span className="tbx-num text-[clamp(22px,4vw,30px)] font-bold" style={{ color: 'var(--tbx-amber)' }}>
                {fmtCredit(p.pendingUsd)}
              </span>
              {p.buys && (
                <span className="text-sm text-[var(--tbx-dim)]">
                  buys <Ticker value={pendingBuys ?? 0} className="font-bold text-[var(--tbx-text)]" /> {unit}
                </span>
              )}
            </div>
            <button type="button" data-fs-skip disabled={busy || p.pendingUsd <= 0} onClick={p.onClear} className="tbx-btn">
              <Icon name="close" size={14} /> Clear
            </button>
          </div>
          <p className="w-full text-xs text-[var(--tbx-mute)]">
            {p.bsvUsd ? `Live price: BSV $${p.bsvUsd.toFixed(2)}.` : 'Pricing…'} {p.priceNote}
          </p>
          <p className="flex w-full items-start gap-2 rounded-lg border border-[var(--tbx-red)]/40 bg-[var(--tbx-red)]/10 px-3 py-2 text-xs font-semibold text-[var(--tbx-text)]" data-norefund>
            <Icon name="shield" size={16} className="mt-px shrink-0 text-[var(--tbx-red)]" />
            No refunds. Only put in what you want to spend. Playing multiplayer? Put in as much as you&apos;ll need.
          </p>
        </section>

        {/* NAME: always editable; the button checks everything and says plainly what is missing. */}
        <label className="flex w-full flex-col gap-2">
          <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}>
            <Icon name="user" size={14} /> Your name <span className="text-[var(--tbx-red)]">· required</span>
          </span>
          <input
            ref={nameRef}
            value={p.name}
            onChange={(e) => {
              p.setName(typingName(e.target.value));
              if (miss === 'name' || miss === 'bad') setMiss(null);
            }}
            disabled={busy}
            maxLength={40}
            placeholder="Type your name"
            className={`tbx-input disabled:opacity-40 ${flash ? 'tbx-shake' : ''}`}
            autoComplete="off"
            spellCheck={false}
            aria-label="Your name"
            aria-invalid={nameMiss}
          />
          {nameMiss && (
            <span className="text-sm font-semibold" style={{ color: '#ff7a70' }} role="alert">
              {missText(miss!)}
            </span>
          )}
        </label>

        {p.stage && p.stage !== 'ready' && (
          <div className="w-full" role="status">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--tbx-teal)' }}>
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--tbx-teal)]" style={{ animation: 'tbx-breathe 1s ease-in-out infinite' }} />
              {p.stage === 'approve' ? 'Waiting for you to approve in your wallet…' : 'Loading…'}
            </p>
            <div className="tbx-bar">
              <i style={{ transform: `scaleX(${pct / 100})` }} />
            </div>
            {p.stageText && <p className="mt-1.5 text-xs text-[var(--tbx-mute)]">{p.stageText}</p>}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {p.walletName && p.walletLive === false && (
            <p className="mx-auto rounded-full border border-[var(--tbx-red)] bg-[var(--tbx-red)]/15 px-3 py-1 text-xs font-bold text-[#ff7a70]" role="status" data-wallet-badge>
              Wallet disconnected ({p.walletName})
            </p>
          )}
          {nameMiss && (
            <p className="tbx-shake rounded-xl border-2 border-[var(--tbx-red)] bg-[var(--tbx-red)]/15 px-4 py-3 text-center text-lg font-bold text-white" role="alert" data-name-callout>
              {missText(miss!)}
            </p>
          )}
          {p.note && !nameMiss && (
            <p className="rounded-xl border border-[var(--tbx-amber)] bg-[var(--tbx-amber)]/10 px-4 py-2 text-center text-base font-semibold text-[var(--tbx-text)]" role="status" data-ammo-note>
              {p.note}
            </p>
          )}
          <div className={`tbx-bezel ${startOk ? 'tbx-bezel-ready' : ''} mx-auto w-full`}>
            <button
              type="button"
              data-fs-start
              data-down={down ? '1' : '0'}
              disabled={busy}
              onPointerDown={() => setDown(true)}
              onPointerUp={() => setDown(false)}
              onPointerLeave={() => setDown(false)}
              onClick={press}
              className="tbx-go"
              style={{ opacity: startOk || busy ? undefined : 0.88 }}
            >
              {busy ? 'Loading…' : (p.startLabel ?? 'Lock & load')}
              {!busy && paySub && <span className="tbx-go-sub">{paySub}</span>}
            </button>
          </div>
          <p className={`text-center text-sm ${miss ? 'font-semibold' : 'text-[var(--tbx-dim)]'}`} style={miss ? { color: '#ff7a70' } : undefined} data-start-reason>
            {miss && !nameMiss ? missText(miss) : nameMiss ? '' : p.pendingUsd > 0 ? 'One wallet approval for the whole total, then the game starts by itself.' : nameOk ? 'Ready.' : 'Put a coin in, type your name, then press the button.'}
          </p>
          {p.error && (
            <p className="text-center text-sm font-semibold" style={{ color: '#ff7a70' }} role="alert">
              {p.error}
            </p>
          )}
        </div>
      </div>
      {nameModal && (
        <Modal
          title="Type your name to play"
          tone="warn"
          action="Type my name"
          onAction={() => {
            setNameModal(false);
            setTimeout(() => nameRef.current?.focus(), 0);
          }}
        >
          {MISSING[miss === 'bad' ? 'bad' : 'name']} Your name goes on every round you fire.
        </Modal>
      )}
    </ControlPanel>
  );
}

/**
 * The cabinet's blocking wallet prompts as true modals: disconnected (Reconnect), approve pending (with the
 * wallet's name and a timer), refused, timed out. Rendered by the page over everything.
 */
export function CabinetModals(p: {
  modal: CabModal;
  setModal: (m: CabModal) => void;
  reconnect: () => void;
  approving: boolean;
  approveSince: number | null;
  walletName: string | null;
  error?: string | null;
}) {
  const secs = useWaitSecs(p.approving ? p.approveSince : null);
  const name = p.walletName ?? 'your wallet';
  if (p.modal === 'disconnected')
    return (
      <Modal title="Your wallet disconnected" tone="bad" action="Reconnect to pay" onAction={p.reconnect} pulse secondary="Not now" onSecondary={() => p.setModal(null)}>
        {p.walletName ? `${name} is not answering.` : 'No wallet is connected.'} Reconnect to pay. Nothing was charged.
      </Modal>
    );
  if (p.modal === 'timeout')
    return (
      <Modal title="Your wallet did not answer" tone="bad" action="Reconnect" onAction={p.reconnect} pulse secondary="Close" onSecondary={() => p.setModal(null)}>
        {name} gave no answer. If it shows a payment, that money is safe in your gun and LOCK &amp; LOAD will use it without charging again.
      </Modal>
    );
  if (p.modal === 'refused')
    return (
      <Modal title="Your wallet said no" tone="bad" action="OK, try again" onAction={() => p.setModal(null)}>
        {p.error ?? `${name} did not approve the payment. Nothing was charged.`} Press LOCK &amp; LOAD to try again.
      </Modal>
    );
  if (p.approving)
    return (
      <Modal title="Approve in your wallet" tone="wait" secondary={secs >= 20 ? 'Wallet not answering? Reconnect' : undefined} onSecondary={secs >= 20 ? p.reconnect : undefined}>
        Approve the payment in {name}. It&apos;s waiting for you.
        <span className="mt-2 block text-sm text-[var(--tbx-mute)]" aria-live="polite">
          still waiting… {secs}s
        </span>
      </Modal>
    );
  return null;
}
