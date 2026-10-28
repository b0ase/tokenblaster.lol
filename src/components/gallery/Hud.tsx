'use client';
/**
 * The in-game HUD: rounds fired, CREDIT, tx/s, score, wave and the boss health bar (owner, 24 Oct 2026: modern
 * AAA shooter HUD). Glass panels, ticking counters, no per-frame React work (the numbers tween on the frame).
 * Pointer events are off, so the gun always gets the trigger.
 */
import { fmtCredit } from '@/lib/coinop/credit';
import type { Stats } from '@/lib/galleryGame/engine';
import { Icon, Ticker } from '../coinop/ui';

/**
 * STEADY COUNTERS (owner, 25 Oct): ticking numbers must never shift left and right. Tabular figures, a fixed
 * width box, right-aligned, and figure-space padding so a change in digit count (e.g. $10.000000 to $9.999999)
 * never reflows.
 */
const FIG = '\u2007';
const TAB: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1', display: 'inline-block', textAlign: 'right', whiteSpace: 'pre' };
const pad = (t: string, n: number) => t.padStart(n, FIG);
const fixedInt = (n: number) => (v: number) => pad(Math.round(v).toLocaleString('en-US'), n);

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
  stageNote: string;
  freePlay?: boolean;
  /** While live: the credit counting down as rounds fire (micro-dollars), and whether it is practice credit. */
  live?: { usd: number; practice: boolean } | null;
  /** $TERRORNODE receipts earned this session and the current receipt price (sats). */
  receipts?: { earned: number; priceSats: number } | null;
}) {
  const s = p.stats;
  const goal = s?.goal;
  const bossBar = !s || s.bossOn;
  const hp = bossBar ? (s ? Math.max(0, s.bossHp) : 1) : (goal?.now ?? 0);
  const max = bossBar ? (s ? Math.max(1, s.bossMax) : 1) : Math.max(1, goal?.max ?? 1);
  const k = Math.min(1, hp / max);
  const php = s ? s.hp : 100;
  const pmax = s ? s.hpMax : 100;
  const pk = Math.max(0, Math.min(1, php / pmax));
  const low = pk < 0.3;
  const push = s?.bossPush ?? 0;
  // THE BLOCK CLOCK: ten minutes, one block; counts down to the finale
  const left = s ? Math.max(0, Math.ceil(s.runMax - s.runSecs)) : 600;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
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
          {p.dry ? 'DEMO · NO SCORE · NOTHING ON CHAIN' : 'LIVE · ON CHAIN'}
        </p>
        <Ticker value={p.fired} ease={0.3} format={fixedInt(9)} className="tbx-display block text-[clamp(32px,5.4vw,56px)] leading-none" style={{ ...TAB, display: 'block', textAlign: 'left', color: 'var(--tbx-text)' }} />
        <p className="text-[10px] text-[var(--tbx-dim)]" data-hud-sub>
          {p.dry ? 'demo rounds fired' : <>rounds fired · <span className="tbx-num">{p.sent.toLocaleString('en-US')}</span> on the record</>}
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
            <Icon name="skull" size={13} /> {bossBar ? p.bossName : (goal?.label ?? '')}
          </span>
          <span className="flex items-center gap-1.5 text-[var(--tbx-text)]">
            <Icon name="wave" size={12} className="text-[var(--tbx-teal)]" /> STAGE <span className="tbx-num">{s?.stage ?? 1}</span>/4
            <span className="tbx-num text-[var(--tbx-amber)]" data-block-clock>
              · BLOCK {clock}
            </span>
          </span>
        </div>
        <div className="relative mt-1.5 h-[10px] overflow-hidden rounded-[3px] border border-white/15 bg-black/60">
          {/* trailing damage, then the live health on top */}
          <i className="absolute inset-0 origin-left bg-[var(--tbx-red)]/80" style={{ transform: `scaleX(${k})`, transition: 'transform 0.9s cubic-bezier(.2,.7,.2,1) 0.15s' }} />
          <i className="absolute inset-0 origin-left" style={{ transform: `scaleX(${k})`, transition: 'transform 0.12s linear', background: bossBar ? 'linear-gradient(90deg,#7f8da1,#f4f8ff 50%,#9fb0c6)' : 'linear-gradient(90deg,#0a8ea0,#27e6ff 60%,#c8fbff)', boxShadow: '0 0 12px rgba(190,220,255,.5)' }} />
          <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,.45) calc(10% - 1px) 10%)' }} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--tbx-dim)]" data-hud-sub>
          <span className="truncate">{bossBar ? (push > 0.45 ? 'PUSHED BACK. Keep firing!' : p.bossNote) : p.stageNote}</span>
          <span className="tbx-num shrink-0">{s ? (goal?.kind === 'block' ? clock : `${hp.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`) : ''}</span>
        </div>
      </div>

      {/* Credit and numbers */}
      <div className="tbx-in-r tbx-glass min-w-[118px] px-3 py-2 text-right sm:min-w-[170px] sm:px-4">
        <p className="flex items-center justify-end gap-1.5 text-[9px] font-bold tracking-[0.28em] text-[var(--tbx-dim)]">
          <Icon name="coin" size={11} className="text-[var(--tbx-amber)]" /> {p.live?.practice || p.freePlay ? 'DEMO CREDIT' : 'CREDIT'}
        </p>
        <p className="tbx-display text-[clamp(26px,4vw,40px)] leading-none tbx-num" style={{ color: 'var(--tbx-amber)', textShadow: '0 0 16px rgba(255,182,46,.35)' }} data-hud-credit>
          <span style={{ ...TAB, minWidth: '10ch' }}>{p.live ? pad(`$${p.live.usd.toFixed(6)}`, 10) : p.freePlay ? 'DEMO' : fmtCredit(p.creditUsd)}</span>
        </p>
        {p.live?.practice && <p data-hud-sub className="text-[9px] tracking-[0.18em] text-[var(--tbx-dim)]">DEMO · NOTHING ON CHAIN</p>}
        <dl data-hud-sub className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 text-[11px] leading-tight">
          <dt className="text-[var(--tbx-dim)]">{p.dry ? 'demo rounds/s' : 'tx/s accepted'}</dt>
          <dd className="m-0"><Ticker value={p.tps} ease={0.3} format={fixedInt(6)} style={{ ...TAB, color: 'var(--tbx-teal)' }} /></dd>
          {p.receipts && (
            <>
              <dt className="text-[var(--tbx-dim)]">$TERRORNODE</dt>
              <dd className="m-0 tbx-num" data-hud-receipts>{p.receipts.earned.toLocaleString('en-US')}</dd>
              <dt className="text-[var(--tbx-dim)]">receipt price</dt>
              <dd className="m-0 tbx-num">{p.receipts.priceSats.toLocaleString('en-US')} sats</dd>
            </>
          )}
          <dt className="text-[var(--tbx-dim)]">score</dt>
          <dd className="m-0"><Ticker value={s?.score ?? 0} format={fixedInt(11)} style={TAB} /></dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">spent</dt>
          <dd className="m-0 hidden tbx-num sm:block">{p.spent}</dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">{s && s.windows > 1 ? 'glass · racks' : 'racks'}</dt>
          <dd className="m-0 hidden tbx-num sm:block">
            {s && s.windows > 1 ? `${s.windows - s.windowsLeft}/${s.windows} · ` : ''}
            {s ? s.racks - s.racksLeft : 0}/{s?.racks ?? 8}
          </dd>
          <dt className="hidden text-[var(--tbx-dim)] sm:block">rounds left</dt>
          <dd className="m-0 hidden tbx-num sm:block" style={TAB}>{pad(p.packLeft.toLocaleString('en-US'), 9)}</dd>
        </dl>
        {p.handle && <p className="mt-1 text-[11px] font-semibold text-[var(--tbx-teal)]">@{p.handle}</p>}
      </div>
    </div>
    </>
  );
}

export function HudControls(p: { hint: string; locked: boolean; canLock: boolean; onLoadout: () => void; onLock: () => void; onStop: () => void; onEnd: () => void; canEnd: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-1.5 sm:p-3" data-hud-controls>
      <div className="tbx-glass tbx-rise max-w-[56%] px-3 py-2 text-[11px] text-[var(--tbx-dim)] sm:text-xs" role="status" data-hud-hint>
        {p.hint}
      </div>
      <div data-hud-buttons className="pointer-events-auto mb-11 flex flex-wrap justify-end gap-1.5 sm:mb-12 sm:gap-2">
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
