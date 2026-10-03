'use client';

/**
 * Wallet + gun state shared by the gun app and the arena: pick a wallet (chooser), load the gun
 * with one approval, fire real blasts, unload. One gun per browser (src/lib/gun.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from './discovery';
import { Gun } from './gun';
import { BLASTER_ID, tokenById, tokensHeld, type Token } from './tokens';
import { connect, fund, type Wallet } from './wallet';

export function useBlaster() {
  const gun = useRef<Gun | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ammo, setAmmo] = useState(0);
  const [token, setToken] = useState<Token | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState<null | 'connecting' | 'loading' | 'unloading'>(null);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const g = new Gun();
    gun.current = g;
    g.balance()
      .then((b) => setAmmo((cur) => Math.max(cur, b)))
      .catch(() => setAmmo(g.sats));
    tokenById(BLASTER_ID)
      .then((t) => setToken((cur) => cur ?? t))
      .catch(() => undefined);
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
      tokensHeld(w.address)
        .then((held) => {
          setTokens(held);
          if (held[0]) setToken(held[0]);
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
        g.load(await fund(wallet, g.address, Math.max(1, sats - g.sats), label));
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
      if (!g || !token) throw new Error('Pick a token first.');
      const txid = await g.fire(token.id, n, extra);
      setAmmo(g.sats);
      return txid;
    },
    [token],
  );

  /** Many real blasts in one ARC request (the arena's hold-to-fire). */
  const fireBatch = useCallback(
    async (startN: number, extras: string[][]) => {
      const g = gun.current;
      if (!g || !token) throw new Error('Pick a token first.');
      const txids = await g.fireBatch(token.id, startN, extras);
      setAmmo(g.sats);
      return txids;
    },
    [token],
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

  return { wallet, ammo, token, setToken, tokens, busy, chooser, setChooser, pick, connectWallet, load, fire, fireBatch, unload, error, setError };
}
