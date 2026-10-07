'use client';

/**
 * The arcade coin slot (src/lib/coinop.ts). useCoinOp(game, tag) keeps this session's credits (in
 * memory, per game) and the txid of each coin; <InsertCoin> is the big "INSERT COIN · 10p (N sats)"
 * button plus the CREDITS counter. Starting a paid game calls `consume()`, which spends one credit
 * and returns that coin's txid (record it with the run). Render `chooserEl` once (wallet picker).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { COINOP_HOUSE, COIN_PENCE, coinSats, insertCoin, isCancel, LIVES_PER_CREDIT } from '@/lib/coinop';
import type { WalletInterface } from '@bsv/sdk';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from '@/lib/discovery';
import { WalletChooser } from './WalletChooser';

/**
 * The wallet a coin is paid from, shared by every game on the site for this visit. Paying a coin needs no
 * identity key, so there is no connect step: we use the in-app or remembered wallet directly and the
 * player sees ONE approval, the 10p (owner, 7 Oct 2026: one "pay 10p to play?" and that's it).
 */
let coinWallet: WalletInterface | null = null;
/**
 * waitForAuthentication makes a BRC-73 wallet show the site's grouped permissions (/manifest.json) ONCE,
 * incl. a small monthly spending allowance; after that each coin goes through without its own prompt.
 */
async function authorise(w: WalletInterface): Promise<WalletInterface> {
  await w.waitForAuthentication({}).catch(() => undefined);
  coinWallet = w;
  return w;
}
async function findCoinWallet(): Promise<WalletInterface | 'choose'> {
  if (coinWallet) return coinWallet;
  const all = await discoverWallets().catch(() => [] as WalletEntry[]);
  const id = rememberedWallet();
  const entry = all.find((w) => w.kind === 'in-app') ?? (id ? all.find((w) => w.id === id) : undefined);
  if (!entry) return 'choose';
  return authorise(entry.wallet);
}

// Credits live for the session (this tab), per game: each entry is the txid of a paid coin.
const credits = new Map<string, string[]>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
let coinN = 0;

export function useCoinOp(game: string, tag: string) {
  const count = useSyncExternalStore(subscribe, () => credits.get(tag)?.length ?? 0, () => 0);
  const [rate, setRate] = useState<number | null>(null);
  const [rateErr, setRateErr] = useState(false);
  const [paying, setPaying] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  // The game to start as soon as the coin lands (PLAY · 10p): paying IS pressing start.
  const startNext = useRef<((paid: boolean) => void) | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/price/gbp')
        .then((r) => r.json())
        .then((j: { bsvGbp?: number }) => {
          if (!live) return;
          setRate(j.bsvGbp ?? null);
          setRateErr(!j.bsvGbp);
        })
        .catch(() => live && setRateErr(true));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const sats = coinSats(rate);

  const payWith = useCallback(
    async (client: WalletInterface) => {
      if (!sats) return;
      setPaying(true);
      setMsg(null);
      try {
        const txid = await insertCoin(client, { game, tag, sats, n: ++coinN });
        credits.set(tag, [...(credits.get(tag) ?? []), txid]);
        emit();
        setMsg({ ok: true, text: `Coin accepted (${sats.toLocaleString('en-GB')} sats).`, txid });
        const go = startNext.current;
        startNext.current = null;
        go?.(true);
      } catch (e) {
        startNext.current = null;
        if (!isCancel(e)) coinWallet = null; // a dead or locked wallet: look again next time
        setMsg({ ok: false, text: isCancel(e) ? 'Cancelled in the wallet. No coin taken.' : `Coin not taken: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setPaying(false);
      }
    },
    [sats, game, tag],
  );

  const insert = useCallback(async () => {
    if (!COINOP_HOUSE || !sats || paying) return;
    setPaying(true);
    const w = await findCoinWallet();
    setPaying(false);
    if (w === 'choose') return setChoosing(true); // first visit only: pick a wallet once
    void payWith(w);
  }, [sats, paying, payWith]);

  const pick = useCallback(
    (entry: WalletEntry) => {
      setChoosing(false);
      rememberWallet(entry.id);
      void authorise(entry.wallet).then(payWith);
    },
    [payWith],
  );

  /** PLAY · 10p: use a credit if there is one, otherwise take a coin and start the moment it lands. */
  const playPaid = useCallback(
    (start: (paid: boolean) => void) => {
      if ((credits.get(tag)?.length ?? 0) > 0) return start(true);
      startNext.current = start;
      void insert();
    },
    [tag, insert],
  );

  const chooserEl = choosing && (
    <WalletChooser
      note="Pick the wallet to pay from. You'll only be asked once."
      onPick={pick}
      onClose={() => {
        startNext.current = null;
        setChoosing(false);
      }}
    />
  );

/** Spend one credit; returns its coin's txid, or null when there are no credits. */
  const consume = useCallback((): string | null => {
    const list = credits.get(tag) ?? [];
    if (!list.length) return null;
    const [txid, ...rest] = list;
    credits.set(tag, rest);
    emit();
    return txid;
  }, [tag]);

  return { credits: count, sats, rateErr, paying, msg, walletErr: null as string | null, insert, playPaid, consume, chooserEl, enabled: Boolean(COINOP_HOUSE) };
}

export type CoinOp = ReturnType<typeof useCoinOp>;

/**
 * The coin slot: ONE big button. With credits left it says PLAY · 1 CREDIT; without, PLAY · 10p, which takes
 * the coin and starts the game the moment it lands (owner, 7 Oct 2026: paying then hunting for a
 * separate start button was bad design). Without `start` it only takes a coin (a credit for later).
 */
export function InsertCoin({ co, perCredit, start, playLabel = 'PLAY', onPress }: { co: CoinOp; perCredit?: string; start?: (paid: boolean) => void; playLabel?: string; onPress?: () => void }) {
  const label = !co.enabled
    ? 'COIN SLOT CLOSED'
    : co.paying
      ? 'APPROVE IN YOUR WALLET…'
      : co.credits > 0 && start
        ? `▶ ${playLabel} · 1 CREDIT (${co.credits} left)`
        : co.sats
          ? `🪙 ${start ? `${playLabel} · ` : 'INSERT COIN · '}${COIN_PENCE}p (${co.sats.toLocaleString('en-GB')} sats)`
          : co.rateErr
            ? 'PRICE UNAVAILABLE'
            : 'PRICING…';
  const canUseCredit = Boolean(start) && co.credits > 0;
  return (
    <div className="flex flex-col items-center gap-1" onKeyDown={(e) => e.stopPropagation()}>
      <button
        onClick={() => {
          onPress?.(); // runs inside the click, so a game can ask for fullscreen while the user gesture is live
          if (start) co.playPaid(start);
          else void co.insert();
        }}
        disabled={!co.enabled || co.paying || (!canUseCredit && !co.sats)}
        className="btn btn-on border-2 border-[#ffd36a] px-5 py-2.5 text-base font-bold tracking-widest text-[#ffd36a] shadow-[0_0_14px_#ffd36a80] disabled:opacity-50 sm:text-lg"
      >
        {label}
      </button>
      {co.enabled ? (
        <p className="text-[10px] text-dim">
          {perCredit ?? `1 coin = 1 game, ${LIVES_PER_CREDIT} lives.`} One wallet approval, then the game starts. Plus the network fee. No payouts.
        </p>
      ) : (
        <p className="text-[10px] text-dim">Paid play is off here: no house address is set (NEXT_PUBLIC_TB_HOUSE_ADDRESS). Practice is free.</p>
      )}
      {co.msg && !co.msg.ok && <p className="text-xs text-accent">{co.msg.text}</p>}
      {co.walletErr && <p className="text-xs text-accent">{co.walletErr}</p>}
    </div>
  );
}

/** Title / game-over controls: PLAY · 10p (pays and starts), PRACTICE (free). */
export function CoinOpButtons({
  co,
  start,
  perCredit,
  playLabel = 'PLAY',
  practiceLabel = '▶ PRACTICE · FREE',
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
      <button
        onClick={() => {
          onPress?.();
          start(false);
        }}
        className="btn px-3 py-1 text-sm"
      >
        {practiceLabel}
      </button>
    </div>
  );
}

/** The run's mode, for the canvas: credit game or free practice. */
export const coinOpModeLabel = (paid: boolean, credits: number) => `${paid ? 'CREDIT GAME · 10p paid' : 'PRACTICE · free, nothing on chain'} · CREDITS: ${credits}`;
