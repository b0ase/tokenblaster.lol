'use client';
/**
 * Game over / results: rounds fired, score, the on-chain proof link, and share (owner, 24 Oct 2026). Copy from
 * src/lib/gallery/story.ts (rank by rounds fired, Dr Kweg Wong's verdict). Numbers count up on open.
 * Nothing here is free: PLAY AGAIN goes back to the cabinet to put a coin in.
 */
import { useState } from 'react';
import { GAME_OVER, GAME_TITLE, KWEG, rankFor, shareText } from '@/lib/gallery/story';
import { Icon, Ticker } from '../coinop/ui';

export type RunSummary = { fired: number; sent: number; score: number; wave: number; kills: number; secs: number; spent: string; last: string | null; handle: string | null; simulated: boolean };

const SITE = 'https://www.tokenblaster.lol/arcade/gallery';
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Results({ r, onAgain, onBoard }: { r: RunSummary; onAgain: () => void; onBoard: () => void }) {
  const rank = rankFor(r.fired);
  const [copied, setCopied] = useState(false);
  const text = shareText({ rounds: r.fired, score: r.score, waves: r.wave, name: r.handle });
  const share = async () => {
    try {
      if (navigator.share) return await navigator.share({ text, url: SITE });
    } catch {
      return; // the share sheet was closed
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE)}`, '_blank', 'noopener,noreferrer');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${SITE}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };
  const stats: { label: string; value: number; icon: 'bullet' | 'target' | 'wave' | 'skull' | 'chain' | 'flame'; fmt?: (n: number) => string }[] = [
    { label: 'Rounds fired', value: r.fired, icon: 'bullet' },
    { label: r.simulated ? 'Practice rounds' : 'On the record', value: r.sent, icon: 'chain' },
    { label: 'Score', value: r.score, icon: 'flame' },
    { label: 'Wave reached', value: r.wave, icon: 'wave' },
    { label: 'Kills', value: r.kills, icon: 'skull' },
    { label: 'Time', value: r.secs, icon: 'target', fmt: fmtTime },
  ];
  return (
    <div className="tbx-screen absolute inset-0 z-30 overflow-y-auto bg-[radial-gradient(ellipse_at_50%_0%,rgba(14,48,60,.88),rgba(3,7,12,.95)_70%)]" data-results>
      <div className="mx-auto flex min-h-full max-w-[920px] flex-col justify-center gap-5 px-4 py-8 sm:py-10">
        <header className="tbx-rise text-center">
          <p className="tbx-eyebrow" style={{ color: 'var(--tbx-teal)' }}>{GAME_TITLE}</p>
          <h2 className="tbx-display mt-2 text-[clamp(48px,10vw,120px)] text-[var(--tbx-red)]" style={{ textShadow: '0 0 60px rgba(255,59,59,.5)' }}>
            {GAME_OVER.title}
          </h2>
          <p className="mx-auto mt-3 max-w-[560px] text-[clamp(14px,1.5vw,18px)] text-white/80">{GAME_OVER.line}</p>
        </header>

        <section className="tbx-glass tbx-pop flex flex-col items-center gap-1 px-5 py-4 text-center" style={{ ['--d' as string]: '0.15s' }}>
          <p className="tbx-eyebrow flex items-center gap-2"><Icon name="trophy" size={14} className="text-[var(--tbx-amber)]" /> Your rank</p>
          <p className="tbx-display text-[clamp(34px,6vw,64px)]" style={{ color: 'var(--tbx-amber)', textShadow: '0 0 30px rgba(255,182,46,.35)' }}>{rank.title}</p>
          <p className="text-sm text-[var(--tbx-dim)]">{rank.line}</p>
        </section>

        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="Your run">
          {stats.map((s, k) => (
            <div key={s.label} className="tbx-glass tbx-rise px-4 py-3" style={{ ['--d' as string]: `${0.25 + k * 0.06}s` }}>
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--tbx-dim)]">
                <Icon name={s.icon} size={12} /> {s.label}
              </p>
              <Ticker from={0} value={s.value} format={s.fmt} ease={0.08} className="tbx-display block text-[clamp(30px,4.4vw,48px)]" />
            </div>
          ))}
        </section>

        <p className="tbx-fade text-center text-sm italic text-white/70" style={{ ['--d' as string]: '0.7s' }}>
          “{KWEG.over}” <span className="not-italic text-white/45">· {KWEG.name}</span>
        </p>

        <section className="tbx-glass tbx-rise flex flex-col gap-3 px-4 py-4" style={{ ['--d' as string]: '0.8s' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="tbx-eyebrow flex items-center gap-2"><Icon name="shield" size={13} /> Proof on the record</p>
              {r.simulated ? (
                <p className="mt-1 text-sm text-[var(--tbx-dim)]">Practice run: nothing was sent, so there is nothing on the record.</p>
              ) : r.last ? (
                <a href={`https://whatsonchain.com/tx/${r.last}`} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1.5 break-all font-mono text-xs text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2" data-proof>
                  {r.last.slice(0, 20)}…{r.last.slice(-6)} <Icon name="external" size={12} className="shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-sm text-[var(--tbx-dim)]">No rounds reached the record this run.</p>
              )}
            </div>
            <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="tbx-btn">
              Watch on bsv.lol <Icon name="external" size={13} />
            </a>
          </div>
          <p className="text-xs text-[var(--tbx-mute)]">{r.simulated ? '' : `Spent ${r.spent}. `}Anyone can check the last round on the record. Unused credit stays in your gun.</p>
        </section>

        <div className="tbx-rise flex flex-col items-stretch gap-2.5 sm:flex-row sm:justify-center" style={{ ['--d' as string]: '0.9s' }}>
          <button type="button" data-fs-skip onClick={onAgain} className="tbx-btn tbx-btn-red !min-h-[52px] !px-7 !text-base">
            <Icon name="coin" size={18} /> Play again
          </button>
          <button type="button" data-fs-skip onClick={() => void share()} className="tbx-btn !min-h-[52px] !px-6">
            <Icon name="share" size={16} /> Share
          </button>
          <button type="button" data-fs-skip onClick={() => void copy()} className="tbx-btn !min-h-[52px] !px-6" aria-live="polite">
            <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" data-fs-skip onClick={onBoard} className="tbx-btn !min-h-[52px] !px-6">
            <Icon name="trophy" size={16} /> Top blasters
          </button>
        </div>
        <p className="text-center text-xs text-[var(--tbx-mute)]">{GAME_OVER.next} {KWEG.signoff}</p>
      </div>
    </div>
  );
}
