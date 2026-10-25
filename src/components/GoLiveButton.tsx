'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useSiteWallet } from '@/lib/useSiteWallet';
import { findGameCanvas, goLive, roomUrl, type LiveSession } from '@/lib/goLive';

/**
 * GO LIVE / STOP for a game: streams the game canvas (+ game sound) into the $TICKER room on bChatX
 * (src/lib/goLive.ts). Only shown once the wallet is connected — the stream is labelled with the player's
 * bChatX handle, proven by the wallet. bChatX caps a room at 16 live streams and says so.
 */
export function GoLiveButton({ ticker, root }: { ticker: string; root: RefObject<HTMLElement | null> }) {
  const { wallet } = useSiteWallet();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef<LiveSession | null>(null);

  useEffect(() => () => { void live.current?.stop(); }, []);
  // Wallet disconnected mid-stream: stop.
  useEffect(() => {
    if (!wallet && live.current) { void live.current.stop(); live.current = null; setSession(null); }
  }, [wallet]);

  const start = useCallback(async () => {
    if (!wallet || busy) return;
    const canvas = findGameCanvas(root.current ?? document);
    if (!canvas) { setNote('Start the game first, then GO LIVE.'); return; }
    setBusy(true);
    setNote(null);
    try {
      const s = await goLive(wallet, ticker, canvas, () => { live.current = null; setSession(null); setNote('Stream ended.'); });
      live.current = s;
      setSession(s);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : 'Could not go live.';
      setNote(code === 'full' ? `Room is full (16 live). ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  }, [wallet, busy, ticker, root]);

  const stop = useCallback(async () => {
    const s = live.current;
    live.current = null;
    setSession(null);
    await s?.stop();
  }, []);

  if (!wallet) return null;

  return (
    <span className="relative inline-flex items-center" data-fs-skip>
      {session ? (
        <button
          type="button"
          onClick={stop}
          data-fs-skip
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-red-500/60 bg-red-600 px-3 text-[11px] font-bold uppercase tracking-wider text-white"
          title={`Streaming to $${ticker} as ${session.handle}. Click to stop.`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          data-fs-skip
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-red-500/60 bg-red-500/10 px-3 text-[11px] font-bold uppercase tracking-wider text-red-300 hover:bg-red-500/20 disabled:opacity-60"
          title={`Stream this game into the $${ticker} room on bChatX`}
        >
          <span className="h-2 w-2 rounded-full bg-red-500" />
          {busy ? 'Going live…' : 'Go live'}
        </button>
      )}
      {(note || session) && (
        <span role="status" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-white/10 bg-black/90 p-2 text-[11px] text-zinc-200 shadow-lg">
          {session ? (
            <>LIVE in <a className="underline" href={roomUrl(ticker)} target="_blank" rel="noreferrer">${ticker}</a> as {session.handle}</>
          ) : (
            <>
              {note}{' '}
              <button type="button" className="ml-1 text-zinc-400 underline" onClick={() => setNote(null)}>OK</button>
            </>
          )}
        </span>
      )}
    </span>
  );
}
