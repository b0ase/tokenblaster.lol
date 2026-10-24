'use client';

/**
 * The game-side coin slot. Coin-op rules (owner, 24 Oct 2026): no free play. Credit is loaded once at the
 * GameShell cabinet (src/components/coinop/CoinOpGate.tsx: coins add up, ONE wallet approval funds the
 * player's own gun). Each play is paid from that credit to the HOUSE on chain.
 *
 * useCoinOp(game, tag) keeps its old shape so every game wires through unchanged:
 *  - `credits`: plays already paid (the gate's START pays the first).
 *  - `playPaid(start)`: use a paid play, or pay one more from the credit and start. Always `start(true)`.
 *  - `consume()`: take one paid play; returns its payment txid (recorded with the run).
 * There is no PRACTICE button any more.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { COIN_PENCE, LIVES_PER_CREDIT, isCancel } from '@/lib/coinop';
import { fmtCredit, playPriceUsd } from '@/lib/coinop/credit';
import { coinStore } from './coinop/store';

/** `pence` is kept for callers; the price is the game's dollar price (src/lib/coinop/credit.ts). */
export function useCoinOp(game: string, tag: string, pence: number = COIN_PENCE) {
  const count = useSyncExternalStore(coinStore.subscribe, coinStore.prepaidCount, () => 0);
  const credit = useSyncExternalStore(coinStore.subscribe, coinStore.credit, () => 0);
  const hasPayer = useSyncExternalStore(coinStore.subscribe, () => coinStore.payer() !== null, () => false);
  const [paying, setPaying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  const priceUsd = playPriceUsd(tag);

  /** Pay one play from the loaded credit (no wallet prompt: the credit is already in the player's gun). */
  const insert = useCallback(async (): Promise<boolean> => {
    const pay = coinStore.payer();
    if (!pay || paying) return false;
    setPaying(true);
    setMsg(null);
    try {
      const txid = await pay();
      coinStore.addPrepaid(txid);
      setMsg({ ok: true, text: `Play paid (${fmtCredit(priceUsd)}).`, txid });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: isCancel(e) ? 'Cancelled. No credit used.' : e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setPaying(false);
    }
  }, [paying, priceUsd]);

  const playPaid = useCallback(
    (start: (paid: boolean) => void) => {
      if (coinStore.prepaidCount() > 0) return start(true);
      void insert().then((ok) => ok && start(true));
    },
    [insert],
  );

  const consume = useCallback((): string | null => coinStore.takePrepaid(), []);

  return {
    credits: count,
    creditUsd: credit,
    priceUsd,
    /** Legacy fields (NPG Arena): price in sats is no longer shown; the dollar price is. */
    sats: hasPayer ? 1 : null,
    pence,
    rateErr: false,
    paying,
    msg,
    walletErr: null as string | null,
    insert: () => void insert(),
    playPaid,
    consume,
    chooserEl: null,
    enabled: hasPayer,
    game,
  };
}

export type CoinOp = ReturnType<typeof useCoinOp>;

/** The game's PLAY button: PLAY · 1 CREDIT when a play is paid, else PLAY · $0.10 from your credit. */
export function InsertCoin({ co, perCredit, start, playLabel = 'PLAY', onPress }: { co: CoinOp; perCredit?: string; start?: (paid: boolean) => void; playLabel?: string; onPress?: () => void }) {
  const short = co.credits === 0 && co.creditUsd + 1e-9 < co.priceUsd;
  const label = !co.enabled
    ? 'INSERT COIN AT THE CABINET'
    : co.paying
      ? 'PAYING…'
      : co.credits > 0 && start
        ? `▶ ${playLabel} · 1 CREDIT`
        : short
          ? `INSERT COIN · CREDIT ${fmtCredit(co.creditUsd)}`
          : `▶ ${playLabel} · ${fmtCredit(co.priceUsd)}`;
  return (
    <div className="flex flex-col items-center gap-1" onKeyDown={(e) => e.stopPropagation()}>
      <button
        onClick={() => {
          onPress?.();
          if (start) co.playPaid(start);
          else co.insert();
        }}
        disabled={!co.enabled || co.paying || (co.credits === 0 && short)}
        className="lock-load btn btn-on border-2 border-[#ffd36a] px-8 py-4 text-lg font-black tracking-widest text-[#ffd36a] disabled:animate-none disabled:opacity-50 sm:text-2xl"
      >
        {label}
      </button>
      <p className="text-[10px] text-dim">
        {perCredit ?? `1 play = 1 game, ${LIVES_PER_CREDIT} lives.`} {fmtCredit(co.priceUsd)} a play from your credit ({fmtCredit(co.creditUsd)} left), paid to the house on chain. No payouts.
      </p>
      {short && co.credits === 0 && <p className="text-xs text-accent">Out of credit. Reload the page to get back to the cabinet and insert coin.</p>}
      {co.msg && !co.msg.ok && <p className="text-xs text-accent">{co.msg.text}</p>}
    </div>
  );
}

/** Title / game-over controls. Owner, 24 Oct 2026: no PRACTICE, only paid play. Extra props kept for callers. */
export function CoinOpButtons({
  co,
  start,
  perCredit,
  playLabel = 'PLAY',
  onPress,
}: {
  co: CoinOp;
  start: (paid: boolean) => void;
  perCredit?: string;
  playLabel?: string;
  practiceLabel?: string;
  onPress?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <InsertCoin co={co} perCredit={perCredit} start={start} playLabel={playLabel} onPress={onPress} />
    </div>
  );
}

/** The run's mode, for the canvas. */
export const coinOpModeLabel = (paid: boolean, credits: number) => `${paid ? 'CREDIT GAME' : 'INSERT COIN'} · PLAYS PAID: ${credits}`;
