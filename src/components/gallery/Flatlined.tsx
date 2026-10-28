'use client';
/**
 * "FLATLINED": the player's health hit zero (owner, 24 Oct 2026). A classic arcade CONTINUE? countdown with big
 * numbers and a tick each second that gets more urgent. To continue, put coins in right here (the same coin
 * buttons and the same single wallet approval as the cabinet); the count resets on every coin and holds while the
 * wallet approval is pending. Paid: health resets and the new rounds add to whatever is still loaded. At 0: GAME OVER.
 * The loaded rounds that are left stay in the gun as credit.
 */
import { useEffect, useRef, useState } from 'react';
import { sfx } from '@/lib/sfx';
import { COINS_USD, fmtCredit } from '@/lib/coinop/credit';
import { TUNING } from '@/lib/galleryGame/tuning';
import { FLATLINED, KWEG } from '@/lib/gallery/story';
import { CoinFace } from '../coinop/hardware';
import { Icon, Ticker } from '../coinop/ui';

export type FlatStats = { fired: number; score: number; wave: number; kills: number; secs: number };
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const coinFace = (c: number) => (c < 1 ? `${Math.round(c * 100)}¢` : `$${c}`);

export function Flatlined(p: {
  stats: FlatStats;
  /** Coins put in so far (USD) and the shots they buy. */
  pendingUsd: number;
  buys: (usd: number) => number | null;
  rounds: number;
  /** True while a wallet approval or the load is in progress: the count holds. */
  hold: boolean;
  onCoin: (usd: number) => void;
  onClear: () => void;
  onContinue: () => void;
  onGameOver: () => void;
  walletName?: string | null;
  /** Free play: no coins; CONTINUE is free. */
  freePlay?: boolean;
}) {
  const [count, setCount] = useState<number>(TUNING.player.continueSecs);
  const tick = useRef(0);
  const holdRef = useRef(p.hold);
  useEffect(() => {
    holdRef.current = p.hold;
  }, [p.hold]);
  const over = useRef(p.onGameOver);
  useEffect(() => {
    over.current = p.onGameOver;
  });
  // the countdown: one tick a second; coins reset it; the wallet approval holds it
  useEffect(() => {
    const i = setInterval(() => {
      if (holdRef.current) return;
      setCount((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    if (count <= 0) {
      const t = setTimeout(() => over.current(), 500);
      return () => clearTimeout(t);
    }
    if (count === tick.current) return;
    tick.current = count;
    sfx(count <= 3 ? 'hurt' : 'click', count <= 3 ? 0.9 : 0.5 + (TUNING.player.continueSecs - count) * 0.05);
  }, [count]);
  const coin = (c: number) => {
    sfx('coin');
    p.onCoin(c);
    setCount(TUNING.player.continueSecs);
  };
  const urgent = count <= 3;
  const stats: { label: string; value: number; fmt?: (n: number) => string }[] = [
    { label: 'Rounds fired', value: p.stats.fired },
    { label: 'Score', value: p.stats.score },
    { label: 'Stage', value: p.stats.wave },
    { label: 'Kills', value: p.stats.kills },
    { label: 'Time', value: p.stats.secs, fmt: fmtTime },
  ];
  return (
    <div className="tbx-screen absolute inset-0 z-30 overflow-y-auto bg-[radial-gradient(ellipse_at_50%_20%,rgba(120,0,0,.55),rgba(8,0,0,.94)_72%)]" data-flatlined role="alertdialog" aria-label={FLATLINED.title}>
      <div className="mx-auto flex min-h-full max-w-[860px] flex-col items-center justify-center gap-3 px-3 py-5 text-center sm:gap-4 sm:py-8">
        <div>
          <h2 className="tbx-display text-[clamp(50px,13vw,150px)] leading-[0.9] text-[var(--tbx-red)]" style={{ textShadow: '0 0 70px rgba(255,30,20,.75), 0 6px 40px #000' }}>
            {FLATLINED.title}
          </h2>
          <p className="mx-auto mt-1 max-w-[560px] text-[clamp(12px,1.4vw,16px)] italic text-white/70">
            “{KWEG.flatlined}” <span className="not-italic text-white/45">· {KWEG.name}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-white/55">{s.label}</p>
              <Ticker from={0} value={s.value} format={s.fmt} ease={0.1} className="tbx-display block text-[clamp(20px,3.2vw,34px)]" />
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center">
          <p className="tbx-eyebrow" style={{ color: 'var(--tbx-amber)' }}>{FLATLINED.prompt}</p>
          <p
            key={count}
            className="tbx-display tbx-pop text-[clamp(90px,24vw,220px)] leading-[0.85]"
            style={{ color: urgent ? 'var(--tbx-red)' : 'var(--tbx-amber)', textShadow: urgent ? '0 0 80px rgba(255,30,20,.9)' : '0 0 60px rgba(255,182,46,.5)' }}
            aria-live="assertive"
            data-count={count}
          >
            {count}
          </p>
          {p.hold && <p className="text-xs font-semibold text-[var(--tbx-teal)]">Waiting for your wallet. The count is held.</p>}
        </div>

        {p.freePlay && (
          <section aria-label="Continue" className="flex w-full max-w-[560px] flex-col items-center gap-2">
            <button type="button" data-fs-skip onClick={p.onContinue} className="tbx-btn tbx-btn-red !min-h-[52px] !px-7 !text-base" data-free-continue>
              Continue (demo)
            </button>
            <p className="text-[11px] text-white/55">Demo: nothing is paid, no score.</p>
          </section>
        )}
        {!p.freePlay && <section aria-label="Insert coin to continue" className="flex w-full max-w-[560px] flex-col items-center gap-2">
          <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}>
            <Icon name="coin" size={14} /> {FLATLINED.coin}
          </p>
          <div className="grid w-full grid-cols-5 gap-1.5 sm:gap-3">
            {COINS_USD.map((c) => (
              <div key={c} className="flex flex-col items-center gap-1">
                <button type="button" data-fs-skip data-coin disabled={p.hold} onClick={() => coin(c)} className="tbx-coin aspect-square w-full max-w-[72px] disabled:opacity-40" aria-label={`Add ${fmtCredit(c)}`}>
                  <CoinFace usd={c} label={coinFace(c)} />
                </button>
                <span className="tbx-num text-center text-[10px] leading-tight text-white/60">{(p.buys(c) ?? 0).toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <button type="button" data-fs-skip onClick={p.onContinue} disabled={p.hold || p.pendingUsd <= 0} className="tbx-btn tbx-btn-red !min-h-[52px] !px-7 !text-base disabled:opacity-40">
              <Icon name="coin" size={18} /> {p.pendingUsd > 0 ? `Pay ${fmtCredit(p.pendingUsd)} and continue` : 'Insert a coin to continue'}
            </button>
            {p.pendingUsd > 0 && !p.hold && (
              <button type="button" data-fs-skip onClick={p.onClear} className="tbx-btn !min-h-[52px] !px-5">
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-white/55">
            {p.pendingUsd > 0 ? `${p.rounds.toLocaleString('en-US')} more rounds, on top of what is loaded. ` : ''}
            {FLATLINED.keep}
            {p.walletName ? ` One approval in ${p.walletName}.` : ''}
          </p>
        </section>}
      </div>
    </div>
  );
}
