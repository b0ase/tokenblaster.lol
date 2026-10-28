'use client';
/**
 * The coin-op gate GameShell puts over every arcade game (owner, 24 Oct 2026: no free play anywhere).
 * Coins add to a total → PAY (one approval, funds the player's own gun) → LOADING AMMO → NAME → START.
 * START pays this game's play price (src/lib/coinop/credit.ts PLAY_PRICE_USD) from the gun to the HOUSE in one
 * transaction tagged "tokenblaster.lol" … "coinop" <game> <name>, records it as one prepaid play and opens the
 * game. The game's own PLAY button uses that play; PLAY AGAIN pays another from the same credit (store.payer).
 * "Try a demo" opens the game unpaid under the INSERT $b banner instead (DemoOverlay; no free practice).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlaster } from '@/lib/useBlaster';
import { loadMark } from '@/lib/gun';
import { startPlay } from '@/lib/coinop/startPlay';
import { HOUSE } from '@/lib/usePaidPlay';
import { cleanName, fmtCredit, hasCredit, playPriceUsd, playPushes, usdToSats } from '@/lib/coinop/credit';
import { SiteWalletChooser } from '@/components/SiteWalletChooser';
import { CoinCabinet } from './CoinCabinet';
import { DemoOverlay } from './DemoOverlay';
import { tbxFontClass } from './fonts';
import { coinStore } from './store';
import { useCabinet } from './useCabinet';
import { usePlayerName } from './usePlayerName';

/**
 * CAPTURE BUILDS ONLY (owner 27 Oct: gameplay captures for bGamesX cards / bAds). A local build made with
 * NEXT_PUBLIC_TB_CAPTURE=1 opens the game with no gate, for headless recording. It is inlined at build time;
 * never set it on Vercel, or the public gets free play.
 */
const CAPTURE_BUILD = process.env.NEXT_PUBLIC_TB_CAPTURE === '1';

export function CoinOpGate(props: { game: string; title: string; children: ReactNode }) {
  if (CAPTURE_BUILD) return <>{props.children}</>;
  return <CoinOpGateInner {...props} />;
}

function CoinOpGateInner({ game, title, children }: { game: string; title: string; children: ReactNode }) {
  const b = useBlaster();
  const cab = useCabinet(b, title);
  const price = playPriceUsd(game);
  const { name, hasPaymail } = usePlayerName();
  useEffect(() => coinStore.setName(name), [name]);
  const [open, setOpen] = useState(false);
  /** Demo (taste) mode, owner 28 Oct 2026: the game opens unpaid under the INSERT $b banner (DemoOverlay). */
  const [demo, setDemo] = useState(false);
  const [demoRun, setDemoRun] = useState(0);
  useEffect(() => {
    coinStore.setDemo(demo);
    return () => coinStore.setDemo(false);
  }, [demo]);
  const startDemo = () => {
    loadMark('demo: started');
    setDemoRun((n) => n + 1);
    setDemo(true);
    setOpen(true);
  };
  // ?demo=1 opens straight into the demo (a shareable taste link; it is unpaid and unscored anyway).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
    void Promise.resolve().then(() => {
      setDemoRun(1);
      setDemo(true);
      setOpen(true);
    });
  }, []);
  // The banner's one tap: back to this cabinet, the existing credit / pay flow (the demo game unmounts).
  const insertFromDemo = () => {
    loadMark('demo: INSERT $b tapped');
    setDemo(false);
    setOpen(false);
  };
  const [starting, setStarting] = useState(false);
  const n = useRef(0);

  useEffect(() => coinStore.setCredit(cab.creditUsd), [cab.creditUsd]);

  const payPlay = useCallback(async (signal?: AbortSignal) => {
    const who = cleanName(coinStore.name()) ?? 'player';
    const sats = usdToSats(price, cab.bsvUsd);
    if (!sats) throw new Error('Checking the price. Try again in a moment.');
    if (!hasCredit(coinStore.credit(), price)) throw new Error(`Not enough credit: one play is ${fmtCredit(price)}. Put another coin in.`);
    const txids = await b.fireBatch(++n.current, [playPushes(game, who)], { address: HOUSE, sats }, 'coinop', signal).catch((e) => {
      loadMark(`play payment not sent: ${e instanceof Error ? e.message : String(e)}`);
      if (signal?.aborted) throw e; // START timed out and cancelled it: nothing was charged
      return [] as string[];
    });
    if (!txids[0]) throw new Error('That did not go through. Your credit is safe. Try again.');
    return txids[0];
  }, [b, cab.bsvUsd, game, price]);

  useEffect(() => {
    coinStore.setPayer(payPlay);
    return () => coinStore.setPayer(null);
  }, [payPlay]);

  const startNow = async () => {
    cab.setErr(null);
    setStarting(true);
    try {
      // A play that was paid after an earlier START timed out is the player's: open with it, never charge again.
      if (coinStore.prepaidCount() > 0) {
        loadMark('start: using a play already paid');
        setOpen(true);
        return;
      }
      await startPlay({
        pay: payPlay,
        open: (txid) => {
          coinStore.addPrepaid(txid);
          setOpen(true);
        },
        credit: (txid) => coinStore.addPrepaid(txid),
        mark: loadMark,
      });
    } catch (e) {
      cab.setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  // START = the bill: pay the pending coins (one approval), then pay this play and open the game by itself.
  const startRef = useRef(startNow);
  useEffect(() => {
    startRef.current = startNow;
  });
  const start = () => cab.payThen(() => void startRef.current());
  const buys = (usd: number) => (cab.bsvUsd ? Math.floor((usd + 1e-9) / price) : null);

  return (
    <>
      {open && demo ? (
        <div key={demoRun} className="relative" data-demo-run>
          {children}
          <DemoOverlay onInsert={insertFromDemo} />
        </div>
      ) : open ? (
        children
      ) : (
        <div className={`${tbxFontClass} coinop-gate relative flex min-h-full w-full items-start justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_50%_-10%,#12303a,#071018_55%,#04070b)] px-4 py-4 sm:items-center`}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--tbx-red)] to-transparent" />
          <div className="tbx-screen w-full max-w-[720px] pt-2">
            <CoinCabinet
              title={title}
              creditUsd={cab.creditUsd}
              creditReady={cab.creditReady}
              pendingUsd={cab.pending}
              bsvUsd={cab.bsvUsd}
              onCoin={cab.onCoin}
              onClear={cab.onClear}
              stage={cab.stage}
              stageText={cab.stageText}
              name={name}
              hasPaymail={hasPaymail}
              priceUsd={price}
              priceNote={`One play costs ${fmtCredit(price)} of credit, paid to the house on chain.`}
              startLabel="Start ▶"
              onStart={start}
              buys={price > 0 ? buys : undefined}
              unit="plays"
              starting={starting}
              error={cab.err}
              onDemo={startDemo}
            />
          </div>
        </div>
      )}
      <SiteWalletChooser />
    </>
  );
}
