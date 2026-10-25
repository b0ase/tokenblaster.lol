'use client';

/**
 * Wallet + gun state shared by the gun app and the arena: pick a wallet (chooser), load the gun
 * with one approval, fire real blasts, unload. One gun per browser (src/lib/gun.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from './discovery';
import { Gun, TOKEN_FEE, loadMark } from './gun';
import type { StormNet } from './stormRun';
import { strandedCoins, tokenById, walletTokens, type Token } from './tokens';
import { loadTokens, reNoteTokens, returnTokens } from './tokenLoad';
import { connect, fund, holdWalletForPlay, walletAlive, walletHeld, withTimeout, type Wallet } from './wallet';
import { chainHandle, needsPaymail } from './gallery';
import { setProofWallet } from './xproof';
import { forgetBasketReads } from './basketSession';
import { lookupPaymail, onWalletAsk, patchBarWallet, setBarWallet } from './walletBar';

/**
 * No background wallet calls (owner, 25 Oct 2026): connecting asks only for the identity key. The wallet's token
 * baskets are read only when the player opens the token / ammo picker (`readTokens`, or picking token ammo with
 * setMode('tokens')), once per session per basket, refusals remembered (src/lib/basketSession.ts). Nothing is read
 * on refocus, there is no liveness timer, and the wallet is held (no calls at all) while a storm session runs.
 */
export function useBlaster() {
  const gun = useRef<Gun | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  // The hall of fame asks this wallet to sign for the player's X handle (src/lib/xproof.ts).
  useEffect(() => setProofWallet(wallet?.client ?? null), [wallet]);
  // The top bar's wallet chip shows the connected wallet (src/lib/walletBar.ts). Only set, never cleared here:
  // a page mounting with no wallet yet must not wipe one the chip connected.
  // With who you are: identity key now, the paymail once bWallet's lookup answers (re-checked on every connect).
  useEffect(() => {
    if (!wallet) return;
    setBarWallet({ id: wallet.id, name: wallet.name, publicKey: wallet.publicKey, live: true });
    let live = true;
    void lookupPaymail(wallet.publicKey, true).then((id) => {
      if (live && id) patchBarWallet({ publicKey: wallet.publicKey, paymail: id.paymail, alias: id.alias, avatar: id.avatar });
    });
    return () => {
      live = false;
    };
  }, [wallet]);
  const [ammo, setAmmo] = useState(0);
  const [token, setToken] = useState<Token | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState<null | 'connecting' | 'loading' | 'loading-tokens' | 'unloading'>(null);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 'sats': tagged blasts (tokens never move). 'tokens': every bullet burns a real token. */
  const [mode, setModeState] = useState<'sats' | 'tokens'>('sats');
  const [tokenAmmo, setTokenAmmo] = useState<number>(0); // whole tokens loaded in the gun
  const [gunAddress, setGunAddress] = useState('');
  /** Last load / unload, shown as a receipt with its transaction. */
  const [receipt, setReceipt] = useState<{ text: string; txid: string } | null>(null);
  /** False when the connected wallet stopped answering (owner, 24 Oct 2026: the connection drops mid-session). */
  const [walletLive, setWalletLive] = useState(true);

  useEffect(() => {
    const g = new Gun();
    gun.current = g;
    void Promise.resolve().then(() => setGunAddress(g.address)); // client-only key
    g.balance()
      .then(setAmmo)
      .catch(() => setAmmo(g.sats));
  }, []);

  const fail = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    // bWalletX answers "reload this page" when the extension was reloaded or updated under an open tab.
    setError(/reload/i.test(m) ? 'Your wallet lost touch with this page. Reload the page (your ammo is safe).' : m);
  };

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

  const pick = useCallback(async (entry: WalletEntry) => {
    setChooser(null);
    setError(null);
    setBusy('connecting');
    try {
      const w = await connect(entry);
      rememberWallet(entry.id);
      setWallet(w);
      setWalletLive(true);
      loadMark(`wallet connected: ${w.name}`);
      // No token-basket reads here: those wait for the player's tap (readTokens).
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Inside bWallet: its wallet, no chooser. Else the remembered wallet, else the chooser. */
  const connectWallet = useCallback(async () => {
    setError(null);
    setBusy('connecting');
    const all = await discoverWallets().catch(() => [] as WalletEntry[]);
    setBusy(null);
    const inApp = all.find((w) => w.kind === 'in-app');
    if (inApp) return pick(inApp);
    const id = rememberedWallet();
    const found = id && all.find((w) => w.id === id);
    if (found) return pick(found);
    setChooser({ note: id ? 'The wallet you used last time is not available any more.' : null });
  }, [pick]);

  useEffect(() => {
    if (wallet) patchBarWallet({ live: walletLive });
  }, [wallet, walletLive]);

  /** Check the wallet answers right now. Updates `walletLive`. */
  const checkWallet = useCallback(async () => {
    if (!wallet) return false;
    const ok = await walletAlive(wallet);
    setWalletLive(ok);
    if (!ok) loadMark(`wallet not answering: ${wallet.name}`);
    return ok;
  }, [wallet]);
  // No liveness timer: checkWallet runs only right before a payment (isAuthenticated, never a sheet).

  /**
   * Pay `sats` into the gun. Only after a confirmed live connection; the paid coin is saved straight from the
   * wallet's response, so a payment can never be taken without the gun holding it.
   * Returns 'ok', 'disconnected' (nothing was asked of the wallet), 'timeout' or 'refused'.
   */
  // The top-bar chip's Reconnect / Switch wallet.
  useEffect(
    () =>
      onWalletAsk((a) => {
        if (a === 'switch') return setChooser({ note: null });
        void connectWallet();
      }),
    [connectWallet],
  );

  const load = useCallback(
    async (sats: number, label: string): Promise<'ok' | 'disconnected' | 'timeout' | 'refused'> => {
      const g = gun.current;
      if (!wallet || !g) return 'disconnected';
      setError(null);
      if (!(await checkWallet())) return 'disconnected';
      setBusy('loading');
      try {
        loadMark('approve start');
        // A real approval can take a while; a wallet that never answers at all counts as disconnected.
        // No timeout on a payment (bWalletX): the player may take as long as they like to approve.
        const funding = await fund(wallet, g.address, sats, label);
        loadMark('approved + paid (wallet answered)');
        // The wallet has paid the gun's address: from here the money is in the gun whatever happens next,
        // so never report this as "payment not made" (owner, 24 Oct: paid $0.05, then told to reconnect).
        try {
          await g.load(funding);
          loadMark('gun has the coin');
        } catch (e) {
          loadMark(`paid, but saving the coin failed (${e instanceof Error ? e.message : e}); reading the balance instead`);
        }
        setAmmo(await g.balance().catch(() => g.sats));
        return 'ok';
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        loadMark(`payment not made: ${m}`);
        if (m === 'WALLET_TIMEOUT') {
          setWalletLive(false);
          return 'timeout';
        }
        fail(e);
        return 'refused';
      } finally {
        setBusy(null);
      }
    },
    [wallet, checkWallet],
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
      holdWalletForPlay(true, 'storm'); // the gun signs every round itself: nothing may ask the wallet meanwhile
      try {
        return await g.storm(tokenLabel ?? token?.id ?? '', total, onProgress, stop, onStatus, tag, perBlast, paused, step);
      } finally {
        holdWalletForPlay(false, 'storm');
        setAmmo(await g.balance().catch(() => g.sats)); // the session's saved change, from the real coin set
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
      setAmmo(await g.balance().catch(() => g.sats));
    }
  }, []);

  /** Many real blasts in one ARC request (the arena's hold-to-fire). */
  const fireBatch = useCallback(
    async (startN: number, extras: string[][], pay?: { address: string; sats: number }, tokenLabel?: string) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      const txids = await g.fireBatch(tokenLabel ?? token?.id ?? '', startN, extras, pay);
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
    void Promise.resolve().then(refreshTokens);
    const t = setInterval(refreshTokens, 8000);
    return () => clearInterval(t);
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
    [wallet, token, refreshTokens],
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
    [wallet, checkStranded],
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
  }, [wallet, checkStranded]);
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
  const refreshGun = useCallback(async (): Promise<number> => {
    const g = gun.current;
    if (!g) return 0;
    setGunTokens(await g.tokensHeld().catch(() => []));
    const sats = await g.balance().catch(() => g.sats);
    setAmmo(sats);
    return sats;
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refreshGun);
    const t = setInterval(refreshGun, 15000);
    return () => clearInterval(t);
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
      let last = '';
      for (const held of await g.tokensHeld()) {
        const meta = await tokenById(held.id).catch(() => ({ id: held.id, sym: held.id.slice(0, 8), icon: null, dec: 0 }) as Token);
        const r = await returnTokens(wallet.client, g, { id: held.id, sym: meta.sym, dec: meta.dec, icon: meta.icon });
        parts.push(`${(Number(r.amt) / 10 ** meta.dec).toLocaleString()} $${meta.sym}`);
        last = r.txid;
      }
      setTokenAmmo(0);
      if (opts.sats !== false) {
        const before = await g.balance().catch(() => g.sats);
        const txid = await g.unload(wallet.address);
        if (txid) {
          parts.push(`about ${before.toLocaleString()} sats (less the network fee)`);
          last = txid;
        }
        setAmmo(0);
      }
      if (parts.length) setReceipt({ text: `Back in your wallet: ${parts.join(' and ')}`, txid: last });
      else setReceipt(null);
      await refreshGun();
      walletTokens(wallet)
        .then(setTokens)
        .catch(() => undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [wallet, refreshGun]);

  return { wallet, walletLive, checkWallet, endSession, ammo, token, setToken, tokens, busy, chooser, setChooser, pick, connectWallet, load, fire, fireBatch, storm, prepareStorm, fireTokens, loadTokenAmmo, refreshWallet, readTokens, tokensRead, refreshing, stranded, fixStranded, gunTokens, refreshGun, receipt, setReceipt, unload, mode, setMode, tokenAmmo, refreshTokens, gunAddress, error, setError };
}
