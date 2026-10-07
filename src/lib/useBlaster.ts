'use client';

/**
 * Wallet + gun state shared by the gun app and the arena: pick a wallet (chooser), load the gun
 * with one approval, fire real blasts, unload. One gun per browser (src/lib/gun.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from './discovery';
import { Gun, TOKEN_FEE } from './gun';
import { strandedCoins, tokenById, walletTokens, type Token } from './tokens';
import { loadTokens, reNoteTokens, returnTokens } from './tokenLoad';
import { connect, fund, type Wallet } from './wallet';
import { setProofWallet } from './xproof';

export function useBlaster() {
  const gun = useRef<Gun | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  // The hall of fame asks this wallet to sign for the player's X handle (src/lib/xproof.ts).
  useEffect(() => setProofWallet(wallet?.client ?? null), [wallet]);
  const [ammo, setAmmo] = useState(0);
  const [token, setToken] = useState<Token | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState<null | 'connecting' | 'loading' | 'loading-tokens' | 'unloading'>(null);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 'sats': tagged blasts (tokens never move). 'tokens': every bullet burns a real token. */
  const [mode, setMode] = useState<'sats' | 'tokens'>('sats');
  const [tokenAmmo, setTokenAmmo] = useState<number>(0); // whole tokens loaded in the gun
  const [gunAddress, setGunAddress] = useState('');
  /** Last load / unload, shown as a receipt with its transaction. */
  const [receipt, setReceipt] = useState<{ text: string; txid: string } | null>(null);

  useEffect(() => {
    const g = new Gun();
    gun.current = g;
    void Promise.resolve().then(() => setGunAddress(g.address)); // client-only key
    g.balance()
      .then((b) => setAmmo((cur) => Math.max(cur, b)))
      .catch(() => setAmmo(g.sats));
  }, []);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

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
      // The tokens really in the wallet (bWallet's bsv21 basket, else the index).
      const first = (held: Token[]) => {
        setTokens(held);
        setToken((cur) => (cur && held.some((t) => t.id === cur.id) ? held.find((t) => t.id === cur.id)! : (held[0] ?? null)));
      };
      void checkStranded(w);
      walletTokens(w, first)
        .then((held) => {
          first(held);
          if (!held[0]) setMode('sats'); // nothing to burn
        })
        .catch(() => undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [checkStranded]);

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

  const load = useCallback(
    async (sats: number, label: string) => {
      const g = gun.current;
      if (!wallet || !g) return false;
      setError(null);
      setBusy('loading');
      try {
        await g.load(await fund(wallet, g.address, sats, label));
        setAmmo(g.sats);
        return true;
      } catch (e) {
        fail(e);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [wallet],
  );

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
    async (total: number, onProgress: (sent: number, last?: string) => void, stop?: () => boolean, onStatus?: (s: string) => void) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      try {
        return await g.storm(token?.id ?? '', total, onProgress, stop, onStatus);
      } finally {
        setAmmo(g.sats);
      }
    },
    [token],
  );

  /** Many real blasts in one ARC request (the arena's hold-to-fire). */
  const fireBatch = useCallback(
    async (startN: number, extras: string[][], pay?: { address: string; sats: number }) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      const txids = await g.fireBatch(token?.id ?? '', startN, extras, pay);
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
    if (!wallet) return;
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
  // Coming back to the tab (e.g. after buying tokens elsewhere): look again.
  useEffect(() => {
    if (!wallet) return;
    const onFocus = () => document.visibilityState === 'visible' && void refreshWallet();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [wallet, refreshWallet]);

  /** What's in the gun right now: tokens by id (for the Wallet → Gun → Fired strip). */
  const [gunTokens, setGunTokens] = useState<{ id: string; amt: bigint }[]>([]);
  const refreshGun = useCallback(async () => {
    const g = gun.current;
    if (!g) return;
    setGunTokens(await g.tokensHeld().catch(() => []));
    setAmmo(g.sats);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refreshGun);
    const t = setInterval(refreshGun, 15000);
    return () => clearInterval(t);
  }, [refreshGun]);


  /** Unload everything back to the wallet: every token in the gun (so the wallet shows them), then the sats. */
  const unload = useCallback(async () => {
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
      const satsTx = await g.unload(wallet.address);
      if (satsTx) {
        parts.push('the leftover sats');
        last = satsTx;
      }
      setAmmo(0);
      setTokenAmmo(0);
      if (parts.length) setReceipt({ text: `Back in your wallet: ${parts.join(' and ')}`, txid: last });
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

  return { wallet, ammo, token, setToken, tokens, busy, chooser, setChooser, pick, connectWallet, load, fire, fireBatch, storm, fireTokens, loadTokenAmmo, refreshWallet, refreshing, stranded, fixStranded, gunTokens, refreshGun, receipt, setReceipt, unload, mode, setMode, tokenAmmo, refreshTokens, gunAddress, error, setError };
}
