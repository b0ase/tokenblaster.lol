'use client';
/**
 * The in-game HUD: rounds fired, CREDIT, tx/s, score, wave and the boss health bar (owner, 24 Oct 2026: modern
 * AAA shooter HUD). Glass panels, ticking counters, no per-frame React work (the numbers tween on the frame).
 * Pointer events are off, so the gun always gets the trigger.
 */
import { fmtCredit } from '@/lib/coinop/credit';
import type { Stats } from '@/lib/galleryGame/engine';
import { Icon, Ticker } from '../coinop/ui';

export function Hud(p: {
  dry: boolean;
  fired: number;
  sent: number;
  weaponName: string;
  ammo: string;
  creditUsd: number;
  tps: number;
  spent: string;
  stats: Stats | null;
  handle: string | null;
  packLeft: number;
  bossName: string;
  bossNote: string;
}) {
  const s = p.stats;
  const hp = s ? Math.max(0, s.bossHp) : 1;
  const max = s ? Math.max(1, s.bossMax) : 1;
  const k = Math.min(1, hp / max);
  const php = s ? s.hp : 100;
  const pmax = s ? s.hpMax : 100;
  const pk = Math.max(0, Math.min(1, php / pmax));
  const low = pk < 0.3;
  const push = s?.bossPush ?? 0;
  return (
    <>
      {/* PLAYER HEALTH: bottom left, above the hint */}
      <div className="pointer-events-none absolute bottom-[54px] left-1.5 z-10 w-[min(290px,52vw)] sm:bottom-[60px] sm:left-3" data-health>
        <div className="tbx-glass px-3 py-1.5" style={low ? { borderColor: 'var(--tbx-red)', boxShadow: '0 0 24px rgba(255,40,30,.45)' } : undefined}>
          <div className="flex items-baseline justify-between text-[10px] font-bold tracking-[0.24em]">
            <span style={{ color: low ? 'var(--tbx-red)' : 'var(--tbx-text)' }}>HEALTH</span>
            <span className="tbx-display text-xl leading-none" style={{ color: low ? 'var(--tbx-red)' : 'var(--tbx-text)' }}>{php}</span>
          </div>
          <div className="relative mt-1 h-[12px] overflow-hidden rounded-[3px] border border-white/20 bg-black/65">
            <i className="absolute inset-0 origin-left bg-white/70" style={{ transform: `scaleX(${pk})`, transition: 'transform 0.7s cubic-bezier(.2,.7,.2,1) 0.2s' }} />
            <i className="absolute inset-0 origin-left" style={{ transform: `scaleX(${pk})`, transition: 'transform 0.1s linear', background: low ? 'linear-gradient(90deg,#8f0f08,#ff3b30)' : 'linear-gradient(90deg,#1fa86b,#7cf5a8 60%,#d6ff8a)', boxShadow: low ? '0 0 14px rgba(255,40,30,.8)' : '0 0 10px rgba(110,255,170,.45)', animation: low ? 'tbx-breathe 0.6s ease-in-out infinite' : undefined }} />
            <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,.5) calc(10% - 1px) 10%)' }} />
          </div>
        </div>
      </div>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[auto_1fr_auto] items-start gap-x-2 gap-y-2 p-1.5 sm:gap-x-4 sm:p-3" data-hud>
      {/* Rounds */}
      <div className="tbx-in-l tbx-glass min-w-[132px] px-3 py-2 sm:min-w-[188px] sm:px-4">
        <p className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.28em] text-[var(--tbx-dim)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.dry ? 'var(--tbx-amber)' : 'var(--tbx-red)', boxShadow: `0 0 8px ${p.dry ? 'var(--tbx-amber)' : 'var(--tbx-red)'}`, animation: 'tbx-breathe 1.2s ease-in-out infinite' }} />
          {p.dry ? 'FREE PLAY · PRACTICE · NOTHING ON CHAIN' : 'LIVE · ON CHAIN'}
        </p>
        <Ticker value={p.fired} ease={0.3} className="tbx-display block text-[clamp(32px,5.4vw,56px)] leading-none" style={{ color: 'var(--tbx-text)' }} />
        <p className="text-[10px] text-[var(--tbx-dim)]">
          rounds fired · <span className="tbx-num">{p.sent.toLocaleString('en-US')}</span> {p.dry ? 'practice rounds' : 'on the record'}
        </p>
        <p className="mt-1 hidden text-[10px] sm:block">
          <span className="font-bold tracking-wider text-[var(--tbx-teal)]">{p.weaponName.toUpperCase()}</span>
          <span className="text-[var(--tbx-mute)]"> · ammo </span>
          <span className="text-[var(--tbx-amber)]">{p.ammo}</span>
        </p>
      </div>

      {/* Boss bar: second row on a phone, centre on a desktop */}
      <div className="tbx-in-d tbx-glass order-last col-span-3 px-3 py-2 sm:order-none sm:col-span-1 sm:mx-auto sm:w-full sm:max-w-[520px]" data-boss-bar>
        <div className="flex items-center justify-between gap-3 text-[10px] font-bold tracking-[0.22em]">
          <span className="flex items-center gap-1.5 text-[var(--tbx-red)]">
            <Icon name="skull" size={13} /> {p.bossName}
          </span>
          <span className="flex items-center gap-1.5 text-[var(--tbx-text)]">
            <Icon name="wave" size={12} className="text-[var(--tbx-teal)]" /> WAVE <span className="tbx-num">{s?.wave ?? 1}</span>
          </span>
        </div>
        <div className="relative mt-1.5 h-[10px] overflow-hidden rounded-[3px] border border-white/15 bg-black/60">
          {/* trailing damage, then the live health on top */}
          <i className="absolute inset-0 origin-left bg-[var(--tbx-red)]/80" style={{ transform: `scaleX(${k})`, transition: 'transform 0.9s cubic-bezier(.2,.7,.2,1) 0.15s' }} />
          <i className="absolute inset-0 origin-left" style={{ transform: `scaleX(${k})`, transition: 'transform 0.12s linear', background: 'linear-gradient(90deg,#7f8da1,#f4f8ff 50%,#9fb0c6)', boxShadow: '0 0 12px rgba(190,220,255,.5)' }} />
          <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,.45) calc(10% - 1px) 10%)' }} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--tbx-dim)]">
          <span className="truncate">{push > 0.45 ? 'PUSHED BACK. Keep firing!' : p.bossNote}</span>
          <span className="tbx-num shrink-0">{s ? `${hp.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}` : ''}</span>
        </div>
      </div>

      {/* Credit and numbers */}
      <div className="tbx-in-r tbx-glass min-w-[118px] px-3 py-2 text-right sm:min-w-[170px] sm:px-4">
        <p className="flex items-center justify-end gap-1.5 text-[9px] font-bold tracking-[0.28em] text-[var(--tbx-dim)]">
          <Icon name="coin" size={11} className="text-[var(--tbx-amber)]" /> CREDIT
        </p>
        <p className="tbx-display text-[clamp(26px,4vw,40px)] leading-none tbx-num" style={{ color: 'var(--tbx-amber)', textShadow: '0 0 16px rgba(255,182,46,.35)' }} data-hud-credit>
          {fmtCredit(p.creditUsd)}
        </p>
        <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 text-[11px] leading-tight">
          <dt className="text-[var(--tbx-dim)]">tx/s</dt>
          <dd className="m-0"><Ticker value={p.tps} ease={0.3} style={{ color: 'var(--tbx-teal)' }} /></dd>
          <dt className="text-[var(--tbx-dim)]">score</dt>
          <dd className="m-0"><Ticker value={s?.score ?? 0} /></dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">spent</dt>
          <dd className="m-0 hidden tbx-num sm:block">{p.spent}</dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">glass · racks</dt>
          <dd className="m-0 hidden tbx-num sm:block">
            {s ? `${s.windows - s.windowsLeft}/${s.windows}` : '0'} · {s ? 8 - s.racksLeft : 0}/8
          </dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">rounds left</dt>
          <dd className="m-0 hidden tbx-num sm:block">{p.packLeft.toLocaleString('en-US')}</dd>
        </dl>
        {p.handle && <p className="mt-1 text-[11px] font-semibold text-[var(--tbx-teal)]">@{p.handle}</p>}
      </div>
    </div>
    </>
  );
}

export function HudControls(p: { hint: string; locked: boolean; canLock: boolean; onLoadout: () => void; onLock: () => void; onStop: () => void; onEnd: () => void; canEnd: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-1.5 sm:p-3">
      <div className="tbx-glass tbx-rise max-w-[56%] px-3 py-2 text-[11px] text-[var(--tbx-dim)] sm:text-xs" role="status">
        {p.hint}
      </div>
      <div className="pointer-events-auto mb-11 flex flex-wrap justify-end gap-1.5 sm:mb-12 sm:gap-2">
        <button type="button" onClick={p.onLoadout} aria-label="Loadout" className="tbx-btn !min-h-[40px] !min-w-[40px] !px-2.5 !text-[11px] sm:!px-3">
          <Icon name="loadout" size={15} /> <span className="hidden sm:inline">Loadout</span>
        </button>
        {p.canEnd && (
          <button type="button" onClick={p.onEnd} aria-label="Results" className="tbx-btn !min-h-[40px] !min-w-[40px] !px-2.5 !text-[11px] sm:!px-3" title="Stop and see your results">
            <Icon name="trophy" size={15} /> <span className="hidden sm:inline">Results</span>
          </button>
        )}
        {p.canLock && (
          <button type="button" onClick={p.onLock} aria-label="Lock trigger" className={`tbx-btn !min-h-[40px] !min-w-[40px] !px-2.5 !text-[11px] sm:!px-3 ${p.locked ? 'tbx-btn-on' : ''}`} title="Keep the trigger down without holding">
            <Icon name={p.locked ? 'lock' : 'unlock'} size={15} /> <span className="hidden sm:inline">{p.locked ? 'Locked' : 'Lock trigger'}</span>
          </button>
        )}
        {p.locked && (
          <button type="button" onClick={p.onStop} aria-label="Stop" className="tbx-btn tbx-btn-red !min-h-[40px] !min-w-[40px] !px-2.5 !text-[11px] sm:!px-3">
            <Icon name="close" size={15} /> <span className="hidden sm:inline">Stop</span>
          </button>
        )}
      </div>
    </div>
  );
}
