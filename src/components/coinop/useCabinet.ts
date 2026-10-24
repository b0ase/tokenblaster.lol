'use client';
/**
 * The cabinet's money: pending coin total, the live BSV/USD price, ONE wallet request for the total (funds the
 * player's own in-browser gun via useBlaster().load), the loading-ammo stage and the CREDIT (gun balance in $).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { useBlaster } from '@/lib/useBlaster';
import { MAX_PAY_USD, addCoin, fmtCredit, satsToUsd, usdToSats } from '@/lib/coinop/credit';
import type { LoadStage } from './CoinCabinet';

type Blaster = ReturnType<typeof useBlaster>;

/** Wallet / gun errors in plain words, with the one thing to do (owner: no technical words for players). */
export function plainError(e: string | null | undefined): string {
  const t = e ?? '';
  if (/cancel|denied|reject|declin|abort|user/i.test(t)) return 'Your wallet said no. Press LOCK & LOAD to try again.';
  if (/insufficient|not enough|funds/i.test(t)) return 'Your wallet does not have enough money for that. Take a coin out and try again.';
  if (/unlock|did not answer|locked/i.test(t)) return 'Your wallet did not answer. Open and unlock it, then press LOCK & LOAD again.';
  return 'That did not go through. Nothing was taken. Press LOCK & LOAD to try again.';
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
      setStage('loading');
      setStageText('Dry run (dev): nothing is paid or broadcast.');
      setTimeout(() => {
        setDryCredit((c) => addCoin(c, pending));
        setPending(0);
        setStage('ready');
        setLanded((n) => n + 1);
      }, 900);
      return;
    }
    const sats = usdToSats(pending, bsvUsd);
    if (!sats) return setErr('Checking the price. Try again in a moment.');
    if (!b.wallet) {
      setPayAfterConnect(true);
      return b.connectWallet();
    }
    setStage('approve');
    setStageText(`One request for ${fmtCredit(pending)}.`);
    const ok = await b.load(sats, `${label}: ${pending.toFixed(2)} USD credit`);
    if (!ok) {
      after.current = null;
      setStage(null);
      setStageText(null);
      return;
    }
    setStage('loading');
    setStageText('Payment received. Loading…');
    await b.refreshGun().catch(() => undefined);
    setPending(0);
    setStage('ready');
    setStageText(null);
    setLanded((n) => n + 1);
  }, [pending, bsvUsd, b, label, opts.dry]);

  const payThen = useCallback(
    (then: () => void) => {
      if (pending <= 0) return then();
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

  useEffect(() => {
    if (payAfterConnect && b.wallet && !b.busy) {
      void Promise.resolve().then(() => {
        setPayAfterConnect(false);
        void doPay();
      });
    }
  }, [payAfterConnect, b.wallet, b.busy, doPay]);
  // Wallet's own "loading" busy flag, while approving, shows as the approve stage.
  useEffect(() => {
    if (b.error) void Promise.resolve().then(() => setErr(plainError(b.error)));
  }, [b.error]);

  return { bsvUsd, pending, onCoin, onClear, payThen, stage, stageText, err, setErr, creditUsd, setDryCredit };
}
