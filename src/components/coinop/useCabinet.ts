'use client';
/**
 * The cabinet's money: pending coin total, the live BSV/USD price, ONE wallet request for the total (funds the
 * player's own in-browser gun via useBlaster().load), the loading-ammo stage and the CREDIT (gun balance in $).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { useBlaster } from '@/lib/useBlaster';
import { MAX_PAY_USD, addCoin, fmtCredit, satsToUsd, usdToSats } from '@/lib/coinop/credit';
import type { LoadStage } from './CoinCabinet';
import { loadMark } from '@/lib/gun';

/** The blocking prompts, each shown as a true modal by CabinetModals. */
export type CabModal = null | 'disconnected' | 'refused' | 'timeout';

type Blaster = ReturnType<typeof useBlaster>;

/** Wallet / gun errors in plain words, with the one thing to do (owner: no technical words for players). */
export function plainError(e: string | null | undefined): string {
  const t = e ?? '';
  if (/cancel|denied|reject|declin|abort|user/i.test(t)) return 'Your wallet said no. Press LOCK & LOAD to try again.';
  if (/insufficient|not enough|funds/i.test(t)) return 'Your wallet does not have enough money for that. Take a coin out and try again.';
  if (/unlock|did not answer|locked/i.test(t)) return 'Your wallet did not answer. Open and unlock it, then press LOCK & LOAD again.';
  return 'That did not go through. If your wallet shows a payment, it is safe in your gun: press LOCK & LOAD and it will be used, not charged again.';
}

export function useBsvUsd() {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/price')
        .then((r) => r.json())
        .then((j: { bsvUsd?: number }) => live && j.bsvUsd && setRate(j.bsvUsd))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return rate;
}

export function useCabinet(b: Blaster, label: string, opts: { dry?: boolean } = {}) {
  const bsvUsd = useBsvUsd();
  const [pending, setPending] = useState(0);
  const [stage, setStage] = useState<LoadStage>(null);
  const [stageText, setStageText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dryCredit, setDryCredit] = useState(0);
  const [modal, setModal] = useState<CabModal>(null);
  /** When the wallet approval request went out (for the "still waiting… 12s" timer). */
  const [approveSince, setApproveSince] = useState<number | null>(null);
  const creditUsd = opts.dry ? dryCredit : satsToUsd(b.ammo, bsvUsd);

  const onCoin = useCallback((c: number) => setPending((t) => Math.min(MAX_PAY_USD, addCoin(t, c))), []);
  const onClear = useCallback(() => setPending(0), []);

  /**
   * START: pay the pending total in ONE wallet request (connecting first if needed), then call `after` once the
   * credit has landed. Nothing pending: `after` at once.
   */
  const after = useRef<(() => void) | null>(null);
  const [landed, setLanded] = useState(0);
  const [payAfterConnect, setPayAfterConnect] = useState(false);
  const doPay = useCallback(async () => {
    setErr(null);
    if (opts.dry) {
      // Dev dry run with a realistic wallet wait (?approvems=, default 10 s), so the flow can be checked.
      setStage('approve');
      setStageText('Free play: nothing is paid.');
      const wait = Number(new URLSearchParams(location.search).get('approvems') ?? 600) || 0;
      setTimeout(() => {
        setDryCredit((c) => addCoin(c, pending));
        setPending(0);
        setStage('ready');
        setLanded((n) => n + 1);
      }, wait);
      return;
    }
    const sats = usdToSats(pending, bsvUsd);
    if (!sats) return setErr('Checking the price. Try again in a moment.');
    if (!b.wallet) {
      loadMark('pay: no wallet connected, asking to connect');
      setModal('disconnected');
      return;
    }
    // Never bill a dropped connection: check it answers first (nothing is asked of the wallet if it doesn't).
    setStage('approve');
    setStageText(`Checking ${b.wallet.name} is connected…`);
    setApproveSince(Date.now());
    loadMark(`pay: ${fmtCredit(pending)} via ${b.wallet.name}`);
    const res = await b.load(sats, `${label}: ${pending.toFixed(2)} USD credit`);
    setApproveSince(null);
    if (res !== 'ok') {
      after.current = null;
      setStage(null);
      setStageText(null);
      loadMark(`pay: ${res} (no charge was made unless the wallet says so)`);
      setModal(res === 'disconnected' ? 'disconnected' : res);
      return;
    }
    // The paid coin is saved in the gun from the wallet's own response; refresh the CREDIT from the real balance.
    void b.refreshGun().catch(() => undefined);
    setPending(0);
    setStage('ready');
    setStageText(null);
    setLanded((n) => n + 1);
  }, [pending, bsvUsd, b, label, opts.dry]);

  const payThen = useCallback(
    (then: () => void) => {
      if (pending <= 0) {
        loadMark('lock & load: no new coins, using the ammo already in the gun');
        return then();
      }
      after.current = then;
      void doPay();
    },
    [pending, doPay],
  );
  // The credit has landed and React has the new balance: run the continuation (start the game).
  useEffect(() => {
    if (!landed || !after.current) return;
    const go = after.current;
    after.current = null;
    void Promise.resolve().then(go);
  }, [landed]);

  /** The modal's Reconnect: run the wallet chooser/connect, then pay what is pending. */
  const reconnect = useCallback(() => {
    setModal(null);
    loadMark('reconnect wallet');
    if (pending > 0) setPayAfterConnect(true);
    void b.connectWallet();
  }, [b, pending]);
  const [connectedAt, setConnectedAt] = useState(0);
  useEffect(() => {
    if (b.wallet) void Promise.resolve().then(() => setConnectedAt(Date.now()));
  }, [b.wallet]);
  useEffect(() => {
    if (payAfterConnect && b.wallet && !b.busy && connectedAt) {
      void Promise.resolve().then(() => {
        setPayAfterConnect(false);
        void doPay();
      });
    }
  }, [payAfterConnect, b.wallet, b.busy, doPay, connectedAt]);
  // Wallet's own "loading" busy flag, while approving, shows as the approve stage.
  useEffect(() => {
    if (b.error) void Promise.resolve().then(() => setErr(plainError(b.error)));
  }, [b.error]);

  return { modal, setModal, reconnect, approveSince, walletName: b.wallet?.name ?? null, walletLive: Boolean(b.wallet) && b.walletLive, bsvUsd, pending, onCoin, onClear, payThen, stage, stageText, err, setErr, creditUsd, setDryCredit };
}
