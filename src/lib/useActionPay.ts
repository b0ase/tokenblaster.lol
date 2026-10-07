'use client';

/**
 * LIVE token-blasting for an arcade game: once the player arms it and loads ammo, every in-game action
 * (`pay.current([...])`) is one tiny real transaction from the gun, in sats or in a token (the game's
 * house coin first). Practice runs and unarmed coin-op runs send nothing. Same path as Chain Frogger:
 * useBlaster's fireBatch / fireTokens behind a queue + background drain (src/lib/actionPay.ts).
 *
 * Use: const ap = useActionPay('kweg', "Kweg's Expedition"); call ap.setRun(run.paid) when a run starts,
 * ap.setRun(false) when it ends, and gate each action with `if (!ap.pay.current(['ping'])) return;`.
 * Render <ActionAmmo ap={ap} actions="sonar ping, dash" /> on the title screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlaster } from './useBlaster';
import { HOUSE } from './usePaidPlay';
import { actionsLoaded, createActionQueue, PER_ACTION, type ActionQueue, type Fire } from './actionPay';
import { GAME_COINS, type GameCoin, type GameKey } from './gameCoins';

/** Dev-only seam for headless checks: localStorage tb:stubpay=1 fakes a loaded gun and never broadcasts. */
const stubbed = () => {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('tb:stubpay') === '1';
  } catch {
    return false;
  }
};

export function useActionPay(game: string, title: string, houseKey?: GameKey) {
  const b = useBlaster();
  const house: GameCoin | undefined = houseKey ? GAME_COINS[houseKey] : undefined;
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [payWith, setPayWith] = useState<'sats' | 'token'>('sats');
  const [sent, setSent] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [needAmmo, setNeedAmmo] = useState(false);
  const [stub, setStub] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setStub(stubbed()));
  }, []);

  const token = b.mode === 'tokens' ? b.token : null;
  const payToken = payWith === 'token' && Boolean(token);
  const sym = token?.sym ?? house?.sym ?? 'TOKEN';

  const live = armed && running && Boolean(HOUSE);
  const { fireTokens, fireBatch, ammo, tokenAmmo } = b;
  const qRef = useRef<ActionQueue | null>(null);
  const symRef = useRef(sym);
  const tokRef = useRef(false);
  useEffect(() => {
    const fire: Fire = stub
      ? async (_t, n, batch) => batch.map((_, i) => `stub${String(n + i).padStart(60, '0')}`)
      : (tokens, n, batch) => (tokens ? fireTokens(n, batch, HOUSE) : fireBatch(n, batch, { address: HOUSE, sats: PER_ACTION }));
    symRef.current = sym;
    tokRef.current = payToken;
    qRef.current ??= createActionQueue(
      game,
      fire,
      {
        onSent: (n, last) => {
          setSent(n);
          if (last) setLastTx(last);
          setPayErr(null);
        },
        onError: (m) => setPayErr(m),
        onNeed: (n) => setNeedAmmo(n),
      },
      () => `Out of ${tokRef.current ? `$${symRef.current}` : 'sats'}: load more.`,
    );
    const q = qRef.current;
    q.setFire(fire);
    q.st.live = live;
    q.st.tokens = payToken;
    q.st.sats = stub ? 1e9 : ammo;
    q.st.tokenAmmo = stub ? 1e9 : tokenAmmo;
  }, [game, sym, live, payToken, stub, ammo, tokenAmmo, fireTokens, fireBatch]);

  // Dev stub only: let a headless check force a paid run (no coin) and read the queue.
  useEffect(() => {
    if (!stub) return;
    const w = window as unknown as { __tbAP?: Record<string, unknown> };
    w.__tbAP = { ...w.__tbAP, [game]: { setRun: setRunning, pending: () => qRef.current?.pending() ?? 0 } };
  }, [stub, game]);

  /** Stable: gate each action with `if (!ap.pay.current(['jump'])) return;`. Practice (no queue yet / not live) = always true. */
  const pay = useRef((action: string[]) => qRef.current?.ask(action) ?? true);

  const setRun = useCallback((on: boolean) => setRunning(on), []);
  const chooseSats = useCallback(() => {
    b.setMode('sats');
    setPayWith('sats');
  }, [b]);
  const chooseToken = useCallback(
    (t: (typeof b.tokens)[number]) => {
      b.setToken(t);
      b.setMode('tokens');
      setPayWith('token');
    },
    [b],
  );
  const resume = useCallback(() => {
    qRef.current?.resume();
    setPayErr(null);
    setNeedAmmo(false);
    b.setError(null);
  }, [b]);

  const loaded = stub ? 9999 : actionsLoaded({ tokens: payToken, sats: b.ammo, tokenAmmo: b.tokenAmmo });
  return { b, game, title, house, armed, setArmed, live, running, setRun, payToken, sym, token, chooseSats, chooseToken, sent, lastTx, payErr, needAmmo, resume, pay, loaded, stub };
}

export type ActionPay = ReturnType<typeof useActionPay>;
