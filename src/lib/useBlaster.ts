'use client';

/**
 * Wallet + gun state shared by the gun app and the arena: pick a wallet (chooser), load the gun
 * with one approval, fire real blasts, unload. One gun per browser (src/lib/gun.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from './discovery';
import { Gun, TOKEN_FEE } from './gun';
import { walletTokens, type Token } from './tokens';
import { loadTokens } from './tokenLoad';
import { connect, fund, type Wallet } from './wallet';

export function useBlaster() {
  const gun = useRef<Gun | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
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

  useEffect(() => {
    const g = new Gun();
    gun.current = g;
    void Promise.resolve().then(() => setGunAddress(g.address)); // client-only key
    g.balance()
      .then((b) => setAmmo((cur) => Math.max(cur, b)))
      .catch(() => setAmmo(g.sats));
  }, []);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

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

  const load = useCallback(
    async (sats: number, label: string) => {
      const g = gun.current;
      if (!wallet || !g) return;
      setError(null);
      setBusy('loading');
      try {
        await g.load(await fund(wallet, g.address, sats, label));
        setAmmo(g.sats);
      } catch (e) {
        fail(e);
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

  /** Many real blasts in one ARC request (the arena's hold-to-fire). */
  const fireBatch = useCallback(
    async (startN: number, extras: string[][]) => {
      const g = gun.current;
      if (!g) throw new Error('No gun.');
      const txids = await g.fireBatch(token?.id ?? '', startN, extras);
      setAmmo(g.sats);
      return txids;
    },
    [token],
  );

  // Token ammo: poll the gun's token balance while in token mode.
  const refreshTokens = useCallback(async () => {
    const g = gun.current;
    if (!g || !token) return;
    try {
      const base = await g.tokenAmmo(token.id);
      setTokenAmmo(Number(base) / 10 ** token.dec);
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
    async (startN: number, extras: string[][]) => {
      const g = gun.current;
      if (!g || !token) throw new Error('Pick a token first.');
      const per = BigInt(10) ** BigInt(token.dec);
      const txids = await g.fireTokens(token.id, per, startN, extras);
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
        const fuel = Math.max(0, n * TOKEN_FEE + 200 - g.sats);
        const tx = await loadTokens(wallet.client, token.id, amt, g.address, token.sym, n.toLocaleString(), fuel);
        g.adoptTokenCoin(token.id, tx, 0, amt);
        if (fuel > 0) await g.load(tx);
        setAmmo(g.sats);
        setTokenAmmo((x) => x + n);
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

  const unload = useCallback(async () => {
    if (!wallet || !gun.current) return;
    setBusy('unloading');
    try {
      await gun.current.unload(wallet.address);
      setAmmo(0);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [wallet]);

  return { wallet, ammo, token, setToken, tokens, busy, chooser, setChooser, pick, connectWallet, load, fire, fireBatch, fireTokens, loadTokenAmmo, unload, mode, setMode, tokenAmmo, refreshTokens, gunAddress, error, setError };
}
