'use client';

/**
 * Wallet + gun state shared by the gun app and the arena: pick a wallet (chooser), load the gun
 * with one approval, fire real blasts, unload. One gun per browser (src/lib/gun.ts).
 */
import { earlierPayCovers } from '@/lib/coinop/payFlow';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletEntry } from './discovery';
import { cancelSiteWalletWait, closeChooser, connectEntry, getSiteWallet, markSiteWalletAnswered, openChooser, openSiteWallet, setSiteWalletError, setSiteWalletLive, setSiteWalletWaiting, walletErrorText } from './siteWallet';
import { WALLET_CANCELLED, WALLET_SENT_PENDING, isRefusal } from './wallet';
import { useSiteWallet } from './useSiteWallet';
import { GUN_LOCKED, Gun, GunNeedsSats, TOKEN_FEE, loadMark } from './gun';
import { newPayRef } from './payRef';
import { BACKUP_RETRY_MS, restoreGunIfNeeded, scheduleGunBackup } from './gunBackup';
import { restoreGate } from './gunRestoreGate';
import { payIntoGun } from './lockLoadPay';
import type { StormNet } from './stormRun';
import { strandedCoins, tokenById, walletTokens, type Token } from './tokens';
import { loadTokens, reNoteTokens, returnTokens } from './tokenLoad';
import { APPROVE_TIMEOUT_MS, raceApproval, retryDecision, type LatePay } from './approveTimeout';
import { cancelWalletCalls, fund, holdWalletForPlay, walletAlive, walletBusy, walletHeld, walletPaying, withTimeout, type Wallet } from './wallet';
import { chainHandle, needsPaymail } from './gallery';
import { forgetBasketReads } from './basketSession';
import { lookupPaymail, patchBarWallet } from './walletBar';
import type { AmmoCoin, SwapLoadQuote } from './launch/ammoCoins';
import { swapLoad } from './launch/swapLoad';
import { BURN_FEE } from './launch/ammoCoins';

/**
 * No background wallet calls (owner, 25 Oct 2026): connecting asks only for the identity key. The wallet's token
 * baskets are read only when the player opens the token / ammo picker (`readTokens`, or picking token ammo with
 * setMode('tokens')), once per session per basket, refusals remembered (src/lib/basketSession.ts). Nothing is read
 * on refocus, there is no liveness timer, and the wallet is held (no calls at all) while a storm session runs.
 */
/** How long a background "wallet is alive" answer lets LOCK & LOAD skip its own check (ms). */
const WARM_MS = 45_000;
/**
 * Per-attempt wait for the wallet's isAuthenticated (walletAlive tries twice). It was 15 s, and that was the ~15 s the
 * owner waited for the sheet (27 Oct): an asleep extension drops the first call, the second one wakes and answers.
 */
const ALIVE_MS = 4_000;

export function useBlaster() {
  const gun = useRef<Gun | null>(null);
  // The site's ONE wallet (src/lib/siteWallet.ts): the top bar, this page and every other Connect share it. The store
  // also keeps the top bar chip and the X-proof wallet in step.
  const site = useSiteWallet();
  const wallet = site.wallet;
  // null until the gun's balance has been read once: CREDIT shows "checking", never a false $0.00 (owner, 25 Oct).
  const [ammoRead, setAmmo] = useState<number | null>(null);
  const ammo = ammoRead ?? 0;
  const ammoKnown = ammoRead !== null;
  /** The last chain read of the CREDIT failed: the counter is not a real $0.00. Retried a few times on its own. */
  const [creditUnknown, setCreditUnknown] = useState(false);
  const [token, setToken] = useState<Token | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [ownBusy, setBusy] = useState<null | 'connecting' | 'loading' | 'loading-tokens' | 'unloading'>(null);
  const busy = ownBusy ?? (site.busy ? 'connecting' : null);
  const chooser = site.chooser;
  const setChooser = useCallback((c: { note: string | null } | null) => (c ? openChooser(c.note) : closeChooser()), []);
  const [ownError, setOwnError] = useState<string | null>(null);
  const error = ownError ?? site.error;
  /** The wallet's own words for the last failed payment, shown small under the friendly line (29 Oct audit). */
  const [walletSaid, setWalletSaid] = useState<string | null>(null);
  const setError = useCallback((e: string | null) => {
    setOwnError(e);
    if (!e) {
      setSiteWalletError(null);
      setWalletSaid(null);
    }
  }, []);
  /** 'sats': tagged blasts (tokens never move). 'tokens': every bullet burns a real token. */
  const [mode, setModeState] = useState<'sats' | 'tokens'>('sats');
  const [tokenAmmo, setTokenAmmo] = useState<number>(0); // whole tokens loaded in the gun
  const [gunAddress, setGunAddress] = useState('');
  /** Last load / unload, shown as a receipt with its transaction. */
  const [receipt, setReceipt] = useState<{ text: string; txid: string } | null>(null);
  /** False when the connected wallet stopped answering (owner, 24 Oct 2026: the connection drops mid-session). */
  const walletLive = site.live;
  /** A payment whose outcome we never heard (timeout / Cancel): checked for its payment id on chain before any re-pay. */
  const unknownPay = useRef<{ sats: number; ref: string; txid?: string } | null>(null);
  /** A payment whose approval outlived our 20 s wait: still open in the wallet, honoured if it pays late. */
  const latePay = useRef<{ late: LatePay<unknown>; sats: number; ref: string } | null>(null);
  /** Bumped when a timed-out payment pays after all: the cabinet starts the game, no new charge. */
  const [latePaid, setLatePaid] = useState(0);

  useEffect(() => {
    const g = new Gun();
    gun.current = g;
    void Promise.resolve().then(() => setGunAddress(g.address)); // client-only key
    // The balance is read once by refreshGun's mount effect below (29 Oct audit: two reads on load).
  }, []);

  /** The stored gun could not be read and no wallet backup restored it yet: nothing loads into it (no orphaned coins). */
  const [gunLocked, setGunLocked] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setGunLocked(Boolean(gun.current?.locked)));
  }, []);
  /**
   * Recoverable gun (25 Oct 2026). Restore only, and only when this browser has no readable gun (no wallet call at all
   * when it has one). It runs ONLY after the player presses a button that needs the wallet (LOCK & LOAD, UNLOAD,
   * Connect), never on page load or a silent resume (owner, 25 Oct, after #95: nothing may ask the wallet on load;
   * src/lib/gunRestoreGate.ts). The BACKUP runs after a paid LOCK & LOAD, in the background, never awaited.
   * A failed restore is shown (31 Oct 2026): "Credit not found on this device", with recovery steps.
   */
  const gate = useRef(restoreGate());
  /** The restore found the wallet's earlier gun(s) but none came back here ('missing'), or could not check ('unchecked'). */
  const [gunMissing, setGunMissing] = useState<null | 'missing' | 'unchecked'>(null);
  const syncBackup = useCallback(async (w: Wallet | null = wallet ?? getSiteWallet().wallet): Promise<string> => {
    const g = gun.current;
    if (!w || !g || walletHeld()) return 'skip';
    return gate.current('press', w, g, restoreGunIfNeeded).then((r) => {
      if (r === 'restored') {
        setGunAddress(g.address);
        void g.balance('gun restored').then(setAmmo).catch(() => undefined);
      }
      setGunLocked(g.locked);
      if (r === 'locked') setError(`${GUN_LOCKED}. This browser has a gun record it can't read, and no backup in this wallet matched. It has been kept, not replaced.`);
      // A failed restore is shown, never silent (owner, 31 Oct 2026): "Credit not found on this device".
      if (r === 'missing') setGunMissing('missing');
      if (r === 'error') {
        loadMark('gun restore failed');
        setGunMissing('unchecked');
      }
      if (r === 'restored' || r === 'ok') setGunMissing(null);
      return r;
    });
  }, [wallet, setError]);
  /**
   * After a paid LOCK & LOAD: back the gun up later, never during play. Never awaited, never blocks play: the first
   * try waits a minute, then runs only when the page is idle, no game holds the wallet and no storm session is running.
   */
  const backupLater = useCallback(() => {
    const g = gun.current;
    if (!wallet || !g) return;
    void scheduleGunBackup(wallet, g, {
      delayMs: BACKUP_RETRY_MS,
      canAsk: () => !walletHeld() && !g.inSession && !walletBusy(wallet.client),
      onError: (e) => loadMark(`gun backup not saved yet: ${e instanceof Error ? e.message : 'error'}`),
    });
  }, [wallet]);
  /** The "Back up gun key" button, after the player confirmed: the WIF, never logged. */
  const exportGunKey = useCallback(() => gun.current?.exportWif() ?? null, []);

  const fail = useCallback((e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    setWalletSaid(m.trim() || null);
    // The wallet's real reason, never a guess (owner, 25 Oct: "reload" in any error became "lost touch").
    setError(/reload/i.test(m) ? walletErrorText(e, wallet ? { kind: wallet.id === 'phone' ? 'phone' : 'extension', name: wallet.name } : undefined) : m);
  }, [setError, wallet]);

  /** Coins TokenBlaster returned to the wallet without a note (the wallet can't see them). */
  const [stranded, setStranded] = useState<(Token & { amt: bigint; why: 'hidden' | 'icon' | 'untagged' })[]>([]);
  const checkStranded = useCallback(async (w: Wallet) => {
    const list = await strandedCoins(w.client).catch(() => []);
    const withMeta = await Promise.all(
      list.map(async (s) => {
        const t = await tokenById(s.id).catch(() => ({ id: s.id, sym: s.id.slice(0, 8), icon: null, dec: 0 }) as Token);
        return { ...t, amt: s.amt, why: s.why, balance: Number(s.amt) / 10 ** t.dec };
      }),
    );
    setStranded(withMeta);
  }, []);

  /** The player picked a wallet in the chooser: it becomes the site's wallet (no token-basket reads here). */
  const pick = useCallback(async (entry: WalletEntry) => {
    setError(null);
    const w = await connectEntry(entry);
    if (w) loadMark(`wallet connected: ${w.name}`);
    if (w) void syncBackup(w); // the player's press: the restore may ask now
  }, [setError, syncBackup]);

  /** Inside bWallet: its wallet, no chooser. Else the remembered wallet, else the chooser. */
  const connectWallet = useCallback(async () => {
    setError(null);
    await openSiteWallet();
    const w = getSiteWallet().wallet;
    if (w) void syncBackup(w); // the player's press: the restore may ask now
  }, [setError, syncBackup]);


  /** Check the wallet answers right now. Updates `walletLive`. */
  // LOCK & LOAD speed (owner, 27 Oct: the wallet sheet took ~15 s to appear): the liveness check is what wakes an
  // asleep extension, so it runs AHEAD of the press (warmWallet: cabinet open, coin in) and the press reuses a fresh
  // answer instead of waiting for a second round trip. Still never bills a dropped connection: no recent "alive",
  // the full check runs as before.
  const warm = useRef<{ at: number; ok: boolean; key: string } | null>(null);
  const warming = useRef<Promise<boolean | 'busy'> | null>(null);
  const aliveNow = useCallback(async (): Promise<boolean | 'busy'> => {
    if (!wallet) return false;
    const key = wallet.publicKey;
    if (!warming.current) {
      const p = walletAlive(wallet, ALIVE_MS).finally(() => {
        if (warming.current === p) warming.current = null;
      });
      warming.current = p;
      void p.then((a) => {
        if (a !== 'busy') warm.current = { at: performance.now(), ok: a === true, key };
      });
    }
    return warming.current;
  }, [wallet]);
  /** Ask the wallet "are you there?" in the background (no sheet), so a press right after needs no wait. */
  const warmWallet = useCallback(() => {
    if (!wallet || walletHeld()) return;
    const w = warm.current;
    if (w && w.ok && w.key === wallet.publicKey && performance.now() - w.at < WARM_MS / 2) return;
    void aliveNow().catch(() => undefined);
  }, [wallet, aliveNow]);
  const checkWallet = useCallback(async () => {
    if (!wallet) return false;
    const w = warm.current;
    if (w && w.ok && w.key === wallet.publicKey && performance.now() - w.at < WARM_MS && !walletBusy(wallet.client)) {
      loadMark(`wallet checked ${Math.round((performance.now() - w.at) / 1000)} s ago: straight to the payment`);
      setSiteWalletLive(true);
      return true;
    }
    let alive = await aliveNow();
    if (alive === 'busy') {
      // Something is queued or open in the wallet. An open payment stays (fund() refuses a second one); anything else
      // (a background read, a backup sheet nobody saw) is dropped so the payment goes straight to the wallet.
      loadMark(`wallet busy: ${walletPaying() ? 'a payment is open' : 'clearing queued calls'}`);
      if (walletPaying()) return true;
      cancelWalletCalls(wallet.client, 'WALLET_BUSY_CLEARED');
      alive = await walletAlive(wallet, ALIVE_MS);
    }
    const ok = alive === true;
    setSiteWalletLive(ok);
    if (!ok) {
      warm.current = null;
      loadMark(`wallet not answering: ${wallet.name}`);
    }
    return ok;
  }, [wallet, aliveNow]);
  // No liveness timer: checkWallet runs only right before a payment (isAuthenticated, never a sheet).

  /**
   * Pay `sats` into the gun. Only after a confirmed live connection; the paid coin is saved straight from the
   * wallet's response, so a payment can never be taken without the gun holding it.
   * Returns 'ok', 'disconnected' (nothing was asked of the wallet), 'timeout' or 'refused'.
   */

  const loadOnce = useCallback(
    async (sats: number, label: string): Promise<'ok' | 'disconnected' | 'timeout' | 'refused' | 'failed'> => {
      const g = gun.current;
      if (!wallet || !g) return 'disconnected';
      setError(null);
      // Never pay into a gun we can't read back. No wallet call here: LOCK & LOAD is ONE request, the payment (#45).
      if (g.locked) {
        setError(GUN_LOCKED);
        return 'failed';
      }
      // Never pay into a key a reload could lose (31 Oct 2026): storage blocked / private window = no payment.
      if (!g.persisted) {
        setError("This browser can't save your game key (private window or site storage blocked), so nothing was paid: a reload would lose the credit. Use a normal window, or play inside bWalletX.");
        return 'failed';
      }
      // An earlier payment's outcome is unknown (timed out / cancelled while its sheet was open): read the gun's own
      // balance first, and if that payment landed, use it instead of charging again (owner, 25 Oct 2026).
      // Retry after "bWalletX didn't respond" (#95 no-double-pay rules): use the late answer or the gun's chain
      // balance if the first request paid; re-send the same request only once it provably did not.
      const lp = latePay.current;
      if (lp) {
        loadMark('retry');
        setSiteWalletWaiting({ text: 'Checking whether your last payment reached the gun…', since: Date.now(), kind: 'pay' });
        const out = await retryDecision(lp.late, {
          // This payment's own id on chain, never a balance difference (26 Oct: a 3 s balance fallback read an old
          // coin as a new payment and said "paid" for a request the wallet had refused).
          paidOnChain: () => g.findPayment(lp.ref),
          cancelHung: () => cancelWalletCalls(wallet.client, 'WALLET_TIMEOUT'),
        });
        setSiteWalletWaiting(null);
        if (out === 'paid' && earlierPayCovers(lp.sats, sats)) {
          latePay.current = null;
          unknownPay.current = null;
          setAmmo(g.sats);
          void g.balance('after payment').then(setAmmo).catch(() => undefined);
          loadMark('retry: the first request paid, no new charge');
          return 'ok';
        }
        if (out === 'paid') {
          // The earlier request paid a DIFFERENT amount: that is credit already in the gun. Ask for what was picked now.
          loadMark(`retry: the earlier ${lp.sats} sats paid (credit in the gun); now asking for the ${sats} sats picked`);
          void g.balance('after payment').then(setAmmo).catch(() => undefined);
        }
        if (out === 'unknown') {
          setError('Could not confirm whether your last payment went through, so nothing was sent again. Try again in a moment.');
          return 'refused';
        }
        latePay.current = null;
        unknownPay.current = null; // the chain read just said it did not pay
        loadMark('retry: first request did not pay, sending it again');
      }
      const unk = unknownPay.current;
      if (unk) {
        setSiteWalletWaiting({ text: 'Checking whether your last payment reached the gun…', since: Date.now(), kind: 'pay' });
        const landed = await g.findPayment(unk.ref, unk.txid);
        setSiteWalletWaiting(null);
        void g.balance('after payment').then(setAmmo).catch(() => undefined);
        if (landed && earlierPayCovers(unk.sats, sats)) {
          unknownPay.current = null;
          loadMark(`the earlier payment ${unk.ref} landed: using it, no new charge`);
          return 'ok';
        }
        if (landed) loadMark(`the earlier payment ${unk.ref} (${unk.sats} sats) landed as credit; now asking for the ${sats} sats picked`);
        if (landed === null) {
          setError('Could not read the gun balance to check your last payment. Try again in a moment (no charge was made).');
          return 'refused';
        }
        unknownPay.current = null;
      }
      if (!(await checkWallet())) return 'disconnected';
      setBusy('loading');
      // This payment's id, carried on chain: a retry looks for exactly this payment (src/lib/payRef.ts).
      const ref = newPayRef();
      setSiteWalletWaiting({ text: `Waiting for ${wallet.name}… open it to approve the payment.`, since: Date.now(), kind: 'pay' });
      try {
        loadMark('approve start');
        // A real approval can take a while; a wallet that never answers at all counts as disconnected.
        // After 20 s with no answer the player gets Retry / Cancel (approveTimeout.ts); a late answer is still honoured.
        const payP = payIntoGun(wallet, g, sats, label, {
          fund,
          ref,
          // Paid: the wallet wait is over NOW. Nothing after this (a slow balance read) may leave the waiting card up,
          // where a timeout or Cancel used to reset the cabinet and charge again (owner log, 25 Oct: paid twice).
          onAnswered: () => {
            markSiteWalletAnswered(wallet);
            setSiteWalletWaiting(null);
          },
          afterPaid: backupLater, // in the background: never chained to the pay
        });
        // Our own 20 s wait (the wallet module's is 3 min): on timeout the request stays open and is honoured if it
        // pays late; Retry checks it (and the chain) before ever sending again.
        const raced = await raceApproval(payP, APPROVE_TIMEOUT_MS);
        if (raced.kind === 'timeout') {
          loadMark('approve timeout');
          const entry = { late: raced.late as LatePay<unknown>, sats, ref };
          latePay.current = entry;
          unknownPay.current = { sats, ref };
          void raced.late.done.then(() => {
            if (raced.late.state !== 'paid' || latePay.current !== entry) return;
            latePay.current = null;
            unknownPay.current = null;
            loadMark('late approval arrived: paid, no new charge');
            setAmmo(g.sats);
            void g.balance('after payment').then(setAmmo).catch(() => undefined);
            setLatePaid((n) => n + 1);
          });
          return 'timeout';
        }
        // The coin is in the gun from the wallet's own response: the CREDIT shows it at once, the chain read follows.
        setAmmo(g.sats);
        void g.balance('after payment').then(setAmmo).catch(() => undefined);
        return 'ok';
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        loadMark(`payment not made: ${m}`);
        // Timed out or cancelled with the sheet open: it may still go through. Remember, so the next press checks first.
        if (m === 'WALLET_TIMEOUT' || m === WALLET_CANCELLED) unknownPay.current = { sats, ref };
        if (m === WALLET_CANCELLED) {
          setError('Payment cancelled. If your wallet still shows it, you can approve it: the next LOCK & LOAD checks your gun first, so you are never charged twice.');
          return 'refused';
        }
        if (m === 'WALLET_TIMEOUT') {
          setSiteWalletLive(false);
          return 'timeout';
        }
        if (m.startsWith(WALLET_SENT_PENDING)) {
          // Approved and sent, only the transaction is not back yet: wait for it to reach the gun, never say "no".
          const txid = m.slice(WALLET_SENT_PENDING.length + 1);
          loadMark(`wallet sent ${txid}, waiting for it to reach the gun`);
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            if (await g.findPayment(ref, txid)) {
              void g.balance('after payment').then(setAmmo).catch(() => undefined);
              loadMark('gun has the coin (found the payment on chain)');
              return 'ok';
            }
          }
          unknownPay.current = { sats, ref, txid };
          setError(`Your wallet sent the payment (${txid.slice(0, 8)}…) and it is on its way. Press LOCK & LOAD in a moment: it will be used, not charged again.`);
          return 'failed';
        }
        fail(e);
        return isRefusal(m) ? 'refused' : 'failed';
      } finally {
        setSiteWalletWaiting(null);
        setBusy(null);
      }
    },
    [wallet, checkWallet, fail, setError, backupLater],
  );

  /** The LOCK & LOAD payment in flight: a second press (or a Reconnect) joins it, never opens a second sheet. */
  const paying = useRef<Promise<'ok' | 'disconnected' | 'timeout' | 'refused' | 'failed'> | null>(null);
  const payingSats = useRef(0);
  const load = useCallback(
    (sats: number, label: string): Promise<'ok' | 'disconnected' | 'timeout' | 'refused' | 'failed'> => {
      if (paying.current) {
        // Only the SAME amount joins the open request (31 Oct 2026: a $1 press joined an open $0.10 one and was
        // told "paid"). A different amount waits for the open one to finish: nothing new is asked meanwhile.
        if (earlierPayCovers(payingSats.current, sats)) {
          loadMark('pay: the same payment is already in flight, joining it (no second wallet request)');
          return paying.current;
        }
        loadMark(`pay: a different payment (${payingSats.current} sats) is still open; ${sats} sats not asked`);
        setError('Another payment is still open in your wallet. Approve or cancel it there, then press again.');
        return Promise.resolve('refused');
      }
      payingSats.current = sats;
      const p = loadOnce(sats, label).finally(() => {
        if (paying.current === p) paying.current = null;
      });
      paying.current = p;
      return p;
    },
    [loadOnce, setError],
  );

  /** End the gun's running storm session (sender finished, locks released, change saved). */
  const endSession = useCallback(async () => {
    await gun.current?.endSession();
  }, []);

  /** One real blast. Resolves to the txid; ammo updates as it goes. */
  const fire = useCallback(
    async (n: number, extra: string[] = []) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      const txid = await g.fire(token?.id ?? '', n, extra); // sats shots: tagged with your token, or untagged
      setAmmo(g.sats);
      return txid;
    },
    [token],
  );

  /** BSVGun: thousands of blasts in parallel lanes. */
  const storm = useCallback(
    async (
      total: number,
      onProgress: (sent: number, last?: string, net?: StormNet) => void,
      stop?: () => boolean,
      onStatus?: (s: string) => void,
      tag?: { game?: string; extra?: string[] },
      perBlast?: number,
      /** The <token> push instead of the picked token (the Shooting Gallery's free-text ammo label). */
      tokenLabel?: string,
      /** True while the trigger is released: hold fire but keep the session (lanes) alive. */
      paused?: () => boolean,
      step?: number,
    ) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      // Every round carries the player's paymail (owner, 25 Oct). The page passes the bar's; if it only had the
      // key_ name (the lookup had not answered, or failed), ask pay.bwallet.space once more (HTTP, not the wallet).
      if (tag && wallet && needsPaymail(tag.extra?.[0])) {
        const id = await withTimeout(lookupPaymail(wallet.publicKey), 3000, 'LOOKUP_TIMEOUT').catch(() => null);
        const pm = chainHandle(id?.paymail);
        if (pm) {
          patchBarWallet({ publicKey: wallet.publicKey, paymail: id?.paymail, alias: id?.alias });
          tag = { ...tag, extra: [pm, ...(tag.extra ?? []).slice(1)] };
        }
      }
      console.info(`[tb-fire] round tag: tokenblaster.lol ${tokenLabel ?? token?.id ?? ''} <n> ${tag?.game ?? 'bsvgun'} ${(tag?.extra ?? []).join(' ')}`);
      // Nothing may be waiting on the wallet once play starts (owner, 25 Oct: a "Waiting for bWalletX… 185s" card
      // was still up after the game): drop any leftover wait, it can not be answered during play anyway.
      if (getSiteWallet().waiting) cancelSiteWalletWait();
      holdWalletForPlay(true, 'storm'); // the gun signs every round itself: nothing may ask the wallet meanwhile
      try {
        return await g.storm(tokenLabel ?? token?.id ?? '', total, onProgress, stop, onStatus, tag, perBlast, paused, step);
      } finally {
        holdWalletForPlay(false, 'storm');
        setAmmo(await g.balance('after storm').catch(() => g.sats)); // the session's saved change, from the real coin set
      }
    },
    [token, wallet],
  );

  /** LOCK & LOAD: find the coin, split it into lanes, wait for the network. Then storm() fires at once. */
  const prepareStorm = useCallback(async (total: number, perBlast: number, onStep?: (pct: number, slowSecs: number) => void) => {
    const g = gun.current;
    if (!g) throw new Error('No gun.');
    try {
      await g.prepareStorm(total, perBlast, onStep);
    } finally {
      // Never block the start on a chain read (owner log, 25 Oct: stuck at 100% for 68 s on this balance).
      setAmmo(g.sats);
      void g.balance('after prepare').then(setAmmo).catch(() => undefined);
    }
  }, []);

  /** Turn whatever credit is at the gun's address into its one firing coin (no wallet call). Returns the sats. */
  const gatherGun = useCallback(async () => {
    const g = gun.current;
    if (!g) throw new Error('No gun.');
    try {
      return await g.gather();
    } finally {
      setAmmo(g.sats);
    }
  }, []);

  /** Many real blasts in one ARC request (the arena's hold-to-fire). */
  const fireBatch = useCallback(
    async (startN: number, extras: string[][], pay?: { address: string; sats: number } | { address: string; sats: number }[], tokenLabel?: string, signal?: AbortSignal) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      const txids = await g.fireBatch(tokenLabel ?? token?.id ?? '', startN, extras, pay, signal);
      setAmmo(g.sats);
      return txids;
    },
    [token],
  );

  // Token ammo: poll the gun's token balance while in token mode.
  const lastLoad = useRef(0);
  const refreshTokens = useCallback(async () => {
    const g = gun.current;
    if (!g || !token) return;
    try {
      const base = await g.tokenAmmo(token.id);
      const v = Number(base) / 10 ** token.dec;
      // Right after a load the indexer can lag and report a stale (lower) balance: keep ours.
      setTokenAmmo((x) => (Date.now() - lastLoad.current < 60_000 && v < x ? x : v));
    } catch {
      /* keep the last known balance */
    }
  }, [token]);
  useEffect(() => {
    if (mode !== 'tokens') return;
    void Promise.resolve().then(refreshTokens); // once on entering token mode; loads re-read it, no idle timer
  }, [mode, refreshTokens]);

  /** Burn real tokens: one whole token per bullet, chained and sent to ARC in one batch. */
  const fireTokens = useCallback(
    async (startN: number, extras: string[][], to?: string) => {
      const g = gun.current;
      if (!g || !token) throw new Error('Pick a token first.');
      const per = BigInt(10) ** BigInt(token.dec);
      // Solo: burned. Hitting another player: sent to their gun.
      const txids = await g.fireTokens(token.id, per, startN, extras, to);
      setAmmo(g.sats);
      setTokenAmmo((n) => Math.max(0, n - txids.length));
      return txids;
    },
    [token],
  );

  /** Load `count` whole tokens from the wallet into the gun: one approval in the wallet. */
  const loadTokenAmmo = useCallback(
    async (count: number) => {
      const g = gun.current;
      if (!wallet || !g || !token) return;
      setError(null);
      setBusy('loading-tokens');
      try {
        // Per-load cap for TOKEN ammo (gun safety): a bad gun state can't swallow a big balance. Sats are not capped.
        const n = Math.floor(count);
        const amt = BigInt(n) * BigInt(10) ** BigInt(token.dec);
        // Top up fuel so every loaded token can be fired, in the same approval.
        const fuel = Math.max(0, n * TOKEN_FEE + 200 - g.sats); // one transaction per token: fees for every one
        const tx = await loadTokens(wallet.client, token.id, amt, g.address, token.sym, n.toLocaleString(), fuel, token.dec, token.icon);
        g.adoptTokenCoin(token.id, tx, 0, amt);
        if (fuel > 0) await g.load(tx);
        setAmmo(g.sats);
        lastLoad.current = Date.now();
        setTokenAmmo((x) => x + n);
        setReceipt({ text: `Loaded ${n.toLocaleString()} $${token.sym} into your gun${fuel ? ` with ${fuel.toLocaleString()} sats of fuel` : ''}`, txid: tx.id('hex') });
        walletTokens(wallet)
          .then(setTokens)
          .catch(() => undefined);
        setTimeout(() => void refreshTokens(), 4000); // the index catches up
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [wallet, token, refreshTokens, fail, setError],
  );

  const fixStranded = useCallback(
    async (t: Token) => {
      if (!wallet) return;
      setError(null);
      setBusy('loading-tokens');
      try {
        await reNoteTokens(wallet.client, t.id, t.sym, t.dec, t.icon);
        await checkStranded(wallet);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [wallet, checkStranded, fail, setError],
  );

  /** Re-read the wallet's tokens (after buying or receiving more). */
  const [refreshing, setRefreshing] = useState(false);
  const refreshWallet = useCallback(async () => {
    if (!wallet || walletHeld()) return;
    forgetBasketReads(); // the player tapped refresh: really re-read (refused baskets stay refused)
    setRefreshing(true);
    try {
      void checkStranded(wallet);
      const held = await walletTokens(wallet, setTokens);
      setTokens(held);
      setToken((cur) => (cur ? (held.find((t) => t.id === cur.id) ?? cur) : (held[0] ?? null)));
    } catch (e) {
      fail(e);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, checkStranded, fail]);
  /** The player opened the token / ammo picker: read the wallet's tokens (once per session per basket). */
  const tokensAsked = useRef(false);
  const [tokensRead, setTokensRead] = useState(false);
  const readTokens = useCallback(async () => {
    if (!wallet || walletHeld() || tokensAsked.current) return;
    tokensAsked.current = true;
    await refreshWallet();
    setTokensRead(true);
  }, [wallet, refreshWallet]);
  useEffect(() => {
    tokensAsked.current = false;
    void Promise.resolve().then(() => setTokensRead(false));
  }, [wallet]);
  /** Picking token ammo is the player's tap: it reads the wallet's tokens first time. */
  const setMode = useCallback(
    (m: 'sats' | 'tokens') => {
      setModeState(m);
      if (m === 'tokens') void readTokens();
    },
    [readTokens],
  );

  /** What's in the gun right now: tokens by id (for the Wallet → Gun → Fired strip). */
  const [gunTokens, setGunTokens] = useState<{ id: string; amt: bigint }[]>([]);
  /** Re-read the gun: tokens held and the REAL spendable sats (chain + wallet responses + own change). */
  const refreshGun = useCallback(async (caller = 'refresh'): Promise<number> => {
    const g = gun.current;
    if (!g) return 0;
    setGunTokens(await g.tokensHeld().catch(() => []));
    // Strict: a chain read that failed is "unknown", never $0.00 (31 Oct: a reload after a paid load showed no credit).
    const sats = await g.balance(caller, true).catch(() => null);
    setCreditUnknown(sats === null);
    if (sats === null) {
      // What this browser itself knows the gun holds (the wallet's saved payment response). Unknown stays "$-.--".
      if (g.sats > 0) setAmmo(g.sats);
      return g.sats;
    }
    setAmmo(sats);
    return sats;
  }, []);
  const creditTries = useRef(0);
  useEffect(() => {
    if (!creditUnknown || creditTries.current >= 4) return;
    const t = setTimeout(() => {
      creditTries.current += 1;
      void refreshGun('credit retry');
    }, 3000 * 2 ** creditTries.current);
    return () => clearTimeout(t);
  }, [creditUnknown, refreshGun]);
  // Read once on load; after that only after a pay, load, send or unload (29 Oct audit: a 15 s timer re-read the
  // chain all the time while idle).
  useEffect(() => {
    void Promise.resolve().then(() => refreshGun('page load'));
  }, [refreshGun]);


  /**
   * UNLOAD (bWalletX gun safety, 25 Oct 2026): send everything still in the gun back to the player's wallet:
   * every token it holds (returnTokens, so the wallet counts them at once) and then the unused sats
   * (gun.unload sweeps the gun's address to the wallet's own address). Tokens go first: their fees come from the sats.
   * `sats: false` returns only the tokens.
   */
  const unload = useCallback(async (opts: { sats?: boolean } = {}) => {
    const g = gun.current;
    if (!wallet || !g) return;
    setBusy('unloading');
    setError(null);
    try {
      const parts: string[] = [];
      const short: string[] = [];
      let need = 0;
      let last = '';
      for (const held of await g.tokensHeld()) {
        const meta = await tokenById(held.id).catch(() => ({ id: held.id, sym: held.id.slice(0, 8), icon: null, dec: 0 }) as Token);
        try {
          const r = await returnTokens(wallet.client, g, { id: held.id, sym: meta.sym, dec: meta.dec, icon: meta.icon });
          parts.push(`${(Number(r.amt) / 10 ** meta.dec).toLocaleString()} $${meta.sym}`);
          last = r.txid;
        } catch (e) {
          if (!(e instanceof GunNeedsSats)) throw e;
          short.push(`$${meta.sym}`);
          need = Math.max(need, e.sats);
        }
      }
      if (!short.length) setTokenAmmo(0);
      if (short.length) {
        // Keep the sats in the gun: they pay the token transfer once topped up.
        setError(`Your ${short.join(', ')} tokens are still in the gun: it needs ${need.toLocaleString()} more sats to pay the network fee to return them. Load at least ${need.toLocaleString()} sats, then UNLOAD again.`);
      } else if (opts.sats !== false) {
        const before = await g.balance('before unload').catch(() => g.sats);
        const txid = await g.unload(wallet.address);
        if (txid) {
          parts.push(`about ${before.toLocaleString()} sats (less the network fee)`);
          last = txid;
        }
        setAmmo(0);
      }
      if (parts.length) setReceipt({ text: `Back in your wallet: ${parts.join(' and ')}`, txid: last });
      else setReceipt(null);
      await refreshGun('after unload');
      walletTokens(wallet)
        .then(setTokens)
        .catch(() => undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [wallet, refreshGun, fail, setError]);

  /**
   * Swap on load (owner, 25 Oct 2026): ONE approval buys an ammo coin on its BlastPad curve straight into the
   * gun, with the gunpowder for the burns in the same tx (src/lib/launch/swapLoad.ts). The gun adopts both.
   */
  const swapLoadCoin = useCallback(
    async (coin: AmmoCoin, q: SwapLoadQuote, onStatus?: (s: string) => void) => {
      const g = gun.current;
      if (!wallet || !g) throw new Error('Connect a wallet first.');
      // A session left mid-way (tab closed) still owes its bulk burn: burn it before buying more.
      if (g.owedBurn()) await g.burnOwed(coin.burnPer);
      const r = await swapLoad(wallet.client, g.address, wallet.address, coin, q, onStatus);
      g.adoptTokenCoin(coin.tokenId, r.tx, 0, r.tokens);
      if (r.fuelVout !== null) await g.load(r.tx);
      setToken({ id: coin.tokenId, sym: coin.sym, icon: null, dec: 0 });
      setTokenAmmo(Number(r.tokens / (coin.burnPer > BigInt(0) ? coin.burnPer : BigInt(1))));
      setAmmo(g.sats);
      setReceipt({ text: `Bought ${r.tokens.toLocaleString()} $${coin.sym} on BlastPad straight into your gun`, txid: r.txid });
      return r;
    },
    [wallet],
  );
  /** Coin ammo, option A: count rounds fired under a coin's tag (saved with the gun), and burn them in one tx. */
  const oweCoinRounds = useCallback((id: string, n: number) => gun.current?.oweBurn(id, n), []);
  const settleCoinBurn = useCallback(async (per: bigint = BigInt(1)) => {
    const g = gun.current;
    if (!g) return null;
    const txid = await g.burnOwed(per);
    setAmmo(g.sats);
    return txid;
  }, []);
  /** $TERRORNODE receipts: the gun pays the session's settlement tx (src/lib/gun.ts payReceipts). */
  const payReceipts = useCallback(async (plan: Parameters<Gun['payReceipts']>[0]) => {
    const g = gun.current;
    if (!g) throw new Error('No gun.');
    const txid = await g.payReceipts(plan);
    setAmmo(g.sats);
    return txid;
  }, []);
  /** Coin ammo storm: fan the gun's coin out into lanes (one gun-signed tx), then burn them in the storm workers. */
  const prepareCoinStorm = useCallback(async (coin: AmmoCoin, rounds: number, lanes: number) => {
    const g = gun.current;
    if (!g) throw new Error('No gun.');
    return g.prepareCoinStorm(coin.tokenId, coin.burnPer, rounds, lanes, BURN_FEE);
  }, []);
  const coinStorm = useCallback(
    async (onProgress: (sent: number, last?: string, net?: StormNet) => void, stop: () => boolean, paused: () => boolean, tag: { game?: string; extra?: string[] }, step?: number) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      // Nothing may be waiting on the wallet once play starts (owner, 25 Oct: a "Waiting for bWalletX… 185s" card
      // was still up after the game): drop any leftover wait, it can not be answered during play anyway.
      if (getSiteWallet().waiting) cancelSiteWalletWait();
      holdWalletForPlay(true, 'storm'); // the gun signs every burn itself: nothing may ask the wallet meanwhile
      try {
        return await g.coinStorm(onProgress, stop, paused, tag, step);
      } finally {
        holdWalletForPlay(false, 'storm');
        setAmmo(await g.balance('after coin storm').catch(() => g.sats));
      }
    },
    [],
  );

  return { latePaid, warmWallet, gunLocked, gunMissing, creditUnknown, syncBackup, exportGunKey, ammoKnown, gatherGun, payReceipts, swapLoadCoin, oweCoinRounds, settleCoinBurn, prepareCoinStorm, coinStorm, wallet, walletLive, checkWallet, endSession, ammo, token, setToken, tokens, busy, chooser, setChooser, pick, connectWallet, load, fire, fireBatch, storm, prepareStorm, fireTokens, loadTokenAmmo, refreshWallet, readTokens, tokensRead, refreshing, stranded, fixStranded, gunTokens, refreshGun, receipt, setReceipt, unload, mode, setMode, tokenAmmo, refreshTokens, gunAddress, error, setError, walletSaid };
}
