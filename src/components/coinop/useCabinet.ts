'use client';
/**
 * The cabinet's money: pending coin total, the live BSV/USD price, ONE wallet request for the total (funds the
 * player's own in-browser gun via useBlaster().load), the loading-ammo stage and the CREDIT (gun balance in $).
 */
import { useCallback, useEffect, useState } from 'react';
import type { useBlaster } from '@/lib/useBlaster';
import { MAX_PAY_USD, addCoin, satsToUsd, usdToSats } from '@/lib/coinop/credit';
import type { LoadStage } from './CoinCabinet';

type Blaster = ReturnType<typeof useBlaster>;

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

  // PAY pressed before a wallet was connected: pay as soon as it connects (still one approval for the total).
  const [payAfterConnect, setPayAfterConnect] = useState(false);
  const pay = useCallback(async () => {
    setErr(null);
    if (pending <= 0) return;
    if (opts.dry) {
      setStage('loading');
      setStageText('Dry run: nothing is paid or broadcast.');
      setTimeout(() => {
        setDryCredit((c) => addCoin(c, pending));
        setPending(0);
        setStage('ready');
      }, 600);
      return;
    }
    const sats = usdToSats(pending, bsvUsd);
    if (!sats) return setErr('No BSV price yet. Try again in a moment.');
    if (!b.wallet) {
      setPayAfterConnect(true);
      return b.connectWallet();
    }
    setStage('approve');
    setStageText(`One request: ${sats.toLocaleString()} sats into your gun.`);
    const ok = await b.load(sats, `${label}: ${pending.toFixed(2)} USD credit`);
    if (!ok) {
      setStage(null);
      setStageText(null);
      return;
    }
    setStage('loading');
    setStageText('Funding landed. Readying your rounds…');
    await b.refreshGun().catch(() => undefined);
    setPending(0);
    setStage('ready');
    setStageText(null);
  }, [pending, bsvUsd, b, label, opts.dry]);

  useEffect(() => {
    if (payAfterConnect && b.wallet && !b.busy) {
      void Promise.resolve().then(() => {
        setPayAfterConnect(false);
        void pay();
      });
    }
  }, [payAfterConnect, b.wallet, b.busy, pay]);
  // Wallet's own "loading" busy flag, while approving, shows as the approve stage.
  useEffect(() => {
    if (b.error) void Promise.resolve().then(() => setErr(b.error));
  }, [b.error]);

  return { bsvUsd, pending, onCoin, onClear, pay, stage, stageText, err, setErr, creditUsd, setDryCredit };
}
