'use client';

/**
 * The coin-op cabinet front (owner, 24 Oct 2026): CREDIT counter, big coin buttons that add to a running total
 * (nothing is paid per press), a live "what this buys" readout, CLEAR, NAME, and the big centred
 * LOCK & LOAD / START. START is the bill: it sends ONE wallet request for the whole total, shows the
 * loading-ammo progress, and the caller starts the game by itself once the rounds are ready.
 * Presentational only: CoinOpGate and the Shooting Gallery feed it.
 */
import { useRef, useState } from 'react';
import { GET_NAME_URL } from '@/lib/walletBar';
import { sfx, unlockAudio } from '@/lib/sfx';
import { CoinFace, CoinSlot, ControlPanel, SevenSeg } from './hardware';
import { Icon, Modal, Ticker, useWaitSecs } from './ui';
import { loadMark } from '@/lib/gun';
import { GUN_KEY_NOTE } from '@/lib/tokenLoad';
import type { CabModal } from './useCabinet';
import { COINS_USD, MIN_CREDIT_USD, addCoin, fmtCredit, hasCredit } from '@/lib/coinop/credit';

export type LoadStage = null | 'approve' | 'loading' | 'ready';

type Missing = 'coin' | 'more' | 'price' | 'wait';
const MISSING: Record<Missing, string> = {
  coin: 'Put a coin in first.',
  more: 'Put another coin in: this game needs a little more.',
  price: 'Checking the price. Try again in a moment.',
  wait: 'The game is still loading. One moment.',
};

export function CreditCounter({ usd, label = 'CREDIT' }: { usd: number; label?: string }) {
  return <SevenSeg text={fmtCredit(usd)} label={label} />;
}

/** A wallet with no paymail: a short, readable id ("wallet 035c…7e") instead of the raw key_ tag. */
const shortId = (name: string) => {
  const k = name.replace(/^key_/, '');
  return k.length > 6 ? `wallet ${k.slice(0, 4)}…${k.slice(-2)}` : name;
};

const coinFace = (c: number) => (c < 1 ? `${Math.round(c * 100)}¢` : `$${c}`);

export function CoinCabinet(p: {
  title: string;
  creditUsd: number;
  /** False while the gun balance or the price is still loading: CREDIT shows "----", not a false $0.00. */
  creditReady?: boolean;
  pendingUsd: number;
  bsvUsd: number | null;
  onCoin: (usd: number) => void;
  onClear: () => void;
  stage: LoadStage;
  stageText?: string | null;
  /** The wallet's paymail (or its key's short form): read only. Empty until LOCK & LOAD connects the wallet. */
  name: string;
  /** False: the wallet has no paymail yet, so a "Get a name" link shows. */
  hasPaymail?: boolean;
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
  /** Free play: no coins, no price, no wallet; the button just starts a practice run. */
  freePlay?: boolean;
}) {
  const total = addCoin(p.creditUsd, p.pendingUsd);
  const busy = p.stage === 'approve' || p.stage === 'loading' || Boolean(p.starting);
  const nameOk = hasCredit(total, MIN_CREDIT_USD);
  const enough = hasCredit(total, p.priceUsd);
  const startOk = p.freePlay ? !busy && !p.blocked : nameOk && enough && !busy && !p.blocked && Boolean(p.bsvUsd);
  const [miss, setMiss] = useState<Missing | null>(null);
  // The minimum to play is a total, not one coin (owner, 24 Oct: put 3¢ in and was told "put a coin in first").
  const short = Math.max(0, MIN_CREDIT_USD - total);
  const missText = (m: Missing) =>
    m === 'coin' && total > 0 ? `The minimum to play is ${fmtCredit(MIN_CREDIT_USD)}. Add ${fmtCredit(short)} more.` : m === 'coin' ? `Put at least ${fmtCredit(MIN_CREDIT_USD)} in to play.` : MISSING[m];
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
    if (p.freePlay) {
      sfx(p.blocked ? 'hurt' : 'click');
      if (!p.blocked) p.onStart();
      return;
    }
    const why: Missing | null = !nameOk ? 'coin' : !enough ? 'more' : !p.bsvUsd ? 'price' : p.blocked ? 'wait' : null;
    setMiss(why);
    sfx(why ? 'hurt' : 'click');
    loadMark(why ? `start blocked: ${missText(why)}` : 'start pressed');
    if (!why) p.onStart();
  };
  const pct = p.stage === 'approve' ? 25 : p.stage === 'loading' ? 70 : 100;
  const unit = p.unit ?? 'plays';
  const n = (usd: number) => {
    const v = p.buys?.(usd);
    return v == null ? '…' : v.toLocaleString('en-US');
  };
  const paySub = p.pendingUsd > 0 ? `PAY ${fmtCredit(p.pendingUsd)}` : null;
  // "$X buys N" is for the coins inserted (TO PAY) only: the gun's credit is shown on its own (owner, 25 Oct).
  const pendingBuys = p.buys ? p.buys(p.pendingUsd) : null;
  return (
    <ControlPanel>
      <div className="flex w-full flex-col gap-5" onKeyDown={(e) => e.stopPropagation()}>
        {/* Marquee: what this machine is, and the LED credit. Coins show in CREDIT the moment they drop in. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="tbx-eyebrow">Coin-op</p>
            <p className="tbx-display text-[clamp(22px,3.4vw,30px)]">{p.title}</p>
          </div>
          {/* CREDIT is only what is already in the gun (it matches the "Your gun" panel); coins not yet paid show as TO PAY. */}
          {p.freePlay ? (
            <SevenSeg text="FREE" label="FREE PLAY" />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {p.pendingUsd > 0 && <SevenSeg text={fmtCredit(p.pendingUsd)} label="TO PAY" colour="#ff5a4a" />}
              {p.creditReady === false ? <SevenSeg text="$-.--" label="CREDIT" /> : <CreditCounter usd={p.creditUsd} />}
            </div>
          )}
        </div>

        {/* INSERT COIN: each press adds to the total. The big red button below is the one wallet approval. */}
        {p.freePlay && (
          <p className="w-full rounded-lg border border-[var(--tbx-teal)]/40 bg-[var(--tbx-teal)]/10 px-3 py-2.5 text-sm font-semibold text-[var(--tbx-text)]" data-freeplay>
            Free play: nothing is paid. These are practice rounds and nothing goes on chain.
          </p>
        )}
        {!p.freePlay && <section aria-label="INSERT $b" className="flex flex-col items-center gap-3">
          <div className="flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--tbx-line-hi)]" />
            <p
              className="tbx-display flex items-center gap-3 text-[clamp(26px,4vw,40px)] text-[var(--tbx-red)]"
              style={{ textShadow: '0 0 18px rgba(255,59,48,.55)', animation: total <= 0 ? 'tbx-coin-blink 1.1s steps(1) infinite' : undefined }}
              data-attract={total <= 0 ? '' : undefined}
            >
              {/* attract mode (owner, 25 Oct): INSERT $b flashes here while there is no credit */}
              <style>{`@keyframes tbx-coin-blink{0%,49%{opacity:1}50%,100%{opacity:.25}}@media (prefers-reduced-motion:reduce){[data-attract]{animation:none!important}}`}</style>
              <Icon name="coin" size={26} /> INSERT <span className="normal-case">$b</span>
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
            Unused credit stays in your gun for later. UNLOAD in the Your gun panel sends it back to your wallet once there is something in it. Playing multiplayer? Put in as much as you&apos;ll need.
          </p>
          <p className="w-full text-xs text-[var(--tbx-mute)]" data-gun-key-note>{GUN_KEY_NOTE}</p>
        </section>}

        {/* NAME (owner, 25 Oct): the wallet's paymail, shown read only. LOCK & LOAD connects the wallet. */}
        {!p.freePlay && (
          <p className="flex w-full flex-wrap items-center gap-2 text-sm text-[var(--tbx-dim)]" data-player-name>
            <Icon name="user" size={14} />
            {p.name ? (
              <>
                Playing as <span className="font-semibold text-[var(--tbx-text)]" title={p.hasPaymail ? undefined : p.name}>{p.hasPaymail ? p.name : shortId(p.name)}</span>
                {!p.hasPaymail && (
                  <a href={GET_NAME_URL} target="_blank" rel="noreferrer" className="rounded-full border border-[var(--tbx-teal)] px-2 py-0.5 text-xs font-semibold text-[var(--tbx-teal)]" data-get-name>
                    Get a name, so your rounds carry it
                  </a>
                )}
              </>
            ) : (
              <>LOCK &amp; LOAD connects bWalletX. Your paymail goes on every round you fire.</>
            )}
          </p>
        )}

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
          {p.note && (
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
            {p.freePlay ? 'Press the button to start. Nothing is paid.' : miss ? missText(miss) : p.pendingUsd > 0 ? 'One wallet approval for the whole total, then the game starts by itself.' : nameOk ? 'Ready.' : 'Put a coin in, then press the button. It connects your wallet.'}
          </p>
          {p.error && (
            <p className="text-center text-sm font-semibold" style={{ color: '#ff7a70' }} role="alert">
              {p.error}
            </p>
          )}
        </div>
      </div>
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
  /** Give up on the open wallet request and close this (Cancel, X, Escape, a click outside). */
  cancel?: () => void;
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
  if (p.modal === 'failed')
    return (
      <Modal title="That did not go through" tone="bad" action="OK, try again" onAction={() => p.setModal(null)} onClose={() => p.setModal(null)}>
        {p.error ?? 'The payment did not complete.'} If your wallet shows a payment, it is safe in your gun: LOCK &amp; LOAD uses it, never charges twice.
      </Modal>
    );
  if (p.modal === 'refused')
    return (
      <Modal title="Your wallet said no" tone="bad" action="OK, try again" onAction={() => p.setModal(null)} onClose={() => p.setModal(null)}>
        {p.error ?? `${name} did not approve the payment. Nothing was charged.`} Press LOCK &amp; LOAD to try again.
      </Modal>
    );
  if (p.approving)
    return (
      <Modal
        title="Approve in your wallet"
        tone="wait"
        action={secs >= 20 ? 'Wallet not answering? Reconnect' : undefined}
        onAction={secs >= 20 ? p.reconnect : undefined}
        secondary={p.cancel ? 'Cancel' : undefined}
        onSecondary={p.cancel}
      >
        Approve the payment in {name}. It&apos;s waiting for you.
        <span className="mt-2 block text-sm text-[var(--tbx-mute)]" aria-live="polite">
          still waiting… {secs}s
        </span>
      </Modal>
    );
  return null;
}
