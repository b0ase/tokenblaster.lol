'use client';
/**
 * The cabinet's money: pending coin total, the live BSV/USD price, ONE wallet request for the total (funds the
 * player's own in-browser gun via useBlaster().load), the loading-ammo stage and the CREDIT (gun balance in $).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { useBlaster } from '@/lib/useBlaster';
import { MAX_PAY_USD, addCoin, payLabel, fmtCredit, satsToUsd, usdToSats } from '@/lib/coinop/credit';
import type { LoadStage } from './CoinCabinet';
import { loadMark } from '@/lib/gun';
import { isRefusal } from '@/lib/wallet';
import { cancelSiteWalletWait, openSiteWallet, setSiteWalletLive } from '@/lib/siteWallet';
import { useSiteWallet } from '@/lib/useSiteWallet';
import { connectAttemptOver } from '@/lib/coinop/payFlow';

/** The blocking prompts, each shown as a true modal by CabinetModals. */
export type CabModal = null | 'disconnected' | 'refused' | 'timeout' | 'failed';

type Blaster = ReturnType<typeof useBlaster>;

/** Wallet / gun errors in plain words, with the one thing to do (owner: no technical words for players). */
export function plainError(e: string | null | undefined): string {
  const t = e ?? '';
  if (/WALLET_HELD_DURING_PLAY/.test(t)) return 'The game was still holding your wallet. Press LOCK & LOAD again.';
  if (isRefusal(t)) return 'Your wallet said no. Press LOCK & LOAD to try again.';
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
  /** CREDIT is the gun's on-chain balance: known only once both the balance and the BSV price have loaded. */
  const creditReady = Boolean(opts.dry) || (b.ammoKnown && bsvUsd != null);

  const onCoin = useCallback((c: number) => setPending((t) => Math.min(MAX_PAY_USD, addCoin(t, c))), []);
  const onClear = useCallback(() => setPending(0), []);

  /**
   * START: pay the pending total in ONE wallet request (connecting first if needed), then call `after` once the
   * credit has landed. Nothing pending: `after` at once.
   */
  const after = useRef<(() => void) | null>(null);
  const site = useSiteWallet();
  const cancelsRef = useRef(site.cancels);
  const keepPayAfter = useRef(false);

  const [landed, setLanded] = useState(0);
  /** The game to start if a timed-out payment is approved late. */
  const lateGo = useRef<(() => void) | null>(null);
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
      // LOCK & LOAD = connect and pay (owner, 24 Oct): no wallet yet, so connect now and pay straight after.
      loadMark('pay: no wallet yet, connecting then paying');
      setPayAfterConnect(true);
      void b.connectWallet();
      return;
    }
    // Never bill a dropped connection: check it answers first (nothing is asked of the wallet if it doesn't).
    setStage('approve');
    setStageText(`Checking ${b.wallet.name} is connected…`);
    setApproveSince(Date.now());
    loadMark(`pay: ${fmtCredit(pending)} via ${b.wallet.name}`);
    // Say what the one wallet sheet is before it opens (owner, 25 Oct: players had no idea why the wallet asked).
    setStageText(`Approve this once in ${b.wallet.name}: ${fmtCredit(pending)} loads your gun. It is the only wallet approval: nothing asks again while you play.`);
    const cancelsBefore = cancelsRef.current;
    const go = after.current; // a successful payment always starts the game, whatever was cancelled meanwhile
    const res = await b.load(sats, payLabel(label, pending));
    setApproveSince(null);
    if (res === 'ok') {
      // Paid: clear the slot at once so no later press, Cancel or Reconnect can bill the same coins again.
      setPending(0);
      setModal(null);
      setPayAfterConnect(false);
      after.current = after.current ?? go;
    }
    if (res !== 'ok' && cancelsRef.current !== cancelsBefore) {
      // The player pressed Cancel: everything is already reset, no "your wallet said no" on top.
      after.current = null;
      setStage(null);
      setStageText(null);
      return;
    }
    if (res === 'timeout') lateGo.current = go; // a late approval still starts the game
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

  /**
   * Cancel (owner, 25 Oct 2026: Cancel and "wallet not answering" did nothing, and the overlay could not be closed):
   * gives up on the open wallet request (frees the wallet queue) and resets every "approve" state here. Any Cancel
   * on the site's waiting card lands here too (siteWallet `cancels`).
   */
  useEffect(() => {
    if (site.cancels === cancelsRef.current) return;
    cancelsRef.current = site.cancels;
    loadMark('wallet wait cancelled');
    after.current = null;
    void Promise.resolve().then(() => {
      if (!keepPayAfter.current) setPayAfterConnect(false);
      keepPayAfter.current = false;
      setStage((s) => (s === 'approve' ? null : s));
      setStageText(null);
      setApproveSince(null);
      setModal(null);
    });
  }, [site.cancels]);
  const cancel = useCallback(() => cancelSiteWalletWait(), []);

  /** "bWalletX didn't respond." → Retry: the same request; useBlaster checks the first one paid before re-sending. */
  const retry = useCallback(() => {
    loadMark('retry pressed');
    setModal(null);
    if (lateGo.current) after.current = lateGo.current;
    lateGo.current = null;
    void doPay();
  }, [doPay]);
  /** "bWalletX didn't respond." → Cancel: close it. A late approval is still honoured as credit. */
  const giveUp = useCallback(() => {
    loadMark('approve timeout: cancelled by player');
    setModal(null);
    lateGo.current = null;
  }, []);
  // The timed-out request paid after all: no new charge, clear the slot and start the game.
  const lateSeen = useRef(b.latePaid);
  useEffect(() => {
    if (b.latePaid === lateSeen.current) return;
    lateSeen.current = b.latePaid;
    const go = lateGo.current;
    lateGo.current = null;
    void Promise.resolve().then(() => {
      setPending(0);
      setModal((m) => (m === 'timeout' ? null : m));
      setStage('ready');
      setStageText(null);
      if (go) after.current = go;
      setLanded((n) => n + 1);
    });
  }, [b.latePaid]);

  /** The modal's Reconnect: give up on the open request, ask the wallet afresh, then pay what is pending. */
  const reconnect = useCallback(() => {
    loadMark('reconnect wallet');
    keepPayAfter.current = pending > 0;
    cancelSiteWalletWait();
    setModal(null);
    if (pending > 0) setPayAfterConnect(true);
    // A real connect, not the remembered key: the wallet that "is not answering" is asked again.
    setSiteWalletLive(false);
    void openSiteWallet();
  }, [pending]);
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
  // The connect LOCK & LOAD started ended with no wallet (chooser closed, Cancel, an error): forget the pay intent,
  // so a later Connect from the top bar never pops a payment sheet by surprise. The next LOCK & LOAD starts afresh.
  useEffect(() => {
    if (!payAfterConnect) return;
    if (!connectAttemptOver({ hasWallet: Boolean(b.wallet), chooserOpen: Boolean(site.chooser), busy: site.busy || Boolean(b.busy), waiting: Boolean(site.waiting) })) return;
    loadMark('lock & load: connect ended without a wallet, payment not started');
    after.current = null;
    void Promise.resolve().then(() => setPayAfterConnect(false));
  }, [payAfterConnect, b.wallet, b.busy, site.chooser, site.busy, site.waiting]);
  // Wallet's own "loading" busy flag, while approving, shows as the approve stage.
  useEffect(() => {
    if (b.error) void Promise.resolve().then(() => setErr(plainError(b.error)));
  }, [b.error]);

  return { modal, setModal, reconnect, cancel, retry, giveUp, approveSince, walletName: b.wallet?.name ?? null, walletLive: Boolean(b.wallet) && b.walletLive, bsvUsd, pending, onCoin, onClear, payThen, stage, stageText, err, setErr, creditUsd, creditReady, setDryCredit };
}
