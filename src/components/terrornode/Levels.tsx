'use client';
/**
 * TERRORNODE level select and LEVEL CLEAR card. Presentational: the solo page and team mode own the state.
 * Levels you have reached are stored in this browser (src/lib/terrornode/levels.ts `loadProgress`).
 */
import { LEVELS, isArenaLevel, isReached, levelOf, nextLevel, soloArenaHref, type LevelId, type Progress } from '@/lib/terrornode/levels';
import { Brand } from '@/components/Brand';

const fmt = (n: number) => n.toLocaleString('en-US');

export function LevelSelect({ progress, active, onPick, compact = false, all = false }: { progress: Progress; active: LevelId; onPick: (id: LevelId) => void; compact?: boolean; all?: boolean }) {
  return (
    <section className="tbx-glass tbx-in-d p-3 sm:p-4" aria-label="Levels" data-level-select>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="tbx-eyebrow" style={{ color: 'var(--tbx-teal)' }}>Levels</p>
        <p className="text-[11px] text-[var(--tbx-mute)]">Clear a level to open the next. Saved in this browser.</p>
      </div>
      <ol className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-1 sm:grid-cols-3 xl:grid-cols-6'}`}>
        {LEVELS.map((l) => {
          const arena = isArenaLevel(l.id);
          const open = all || arena || isReached(progress, l.id);
          const best = progress.best[l.id];
          const on = l.id === active;
          // the solo page: an arena level (MELEE) is team mode's, played there as a one-player co-op match
          const toTeam = arena && !all;
          return (
            <li key={l.id}>
              <button
                type="button"
                disabled={!open}
                onClick={() => (toTeam ? location.assign(soloArenaHref(l.id)) : onPick(l.id))}
                data-arena={arena ? '1' : undefined}
                aria-pressed={on}
                data-level={l.id}
                data-locked={open ? undefined : '1'}
                className="group relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor: on ? l.palette.key : 'var(--tbx-line)',
                  background: `linear-gradient(160deg, ${l.palette.bg} 0%, rgba(0,0,0,.55) 70%), radial-gradient(circle at 85% 0%, ${l.palette.key}44, transparent 60%)`,
                  boxShadow: on ? `0 0 0 1px ${l.palette.key}, 0 0 24px ${l.palette.key}55` : undefined,
                }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: l.palette.key }}>
                  {l.n === 0 ? 'The block' : arena ? 'Arena · 64 players' : `Level ${l.n}`}
                  {l.boss ? ' · Boss' : ''}
                </span>
                <span className="tbx-display text-lg leading-tight text-white"><Brand>{l.name}</Brand></span>
                {!compact && <span className="text-[12px] leading-snug text-white/70">{open ? l.blurb : 'Locked: clear the level before it.'}</span>}
                <span className="mt-auto pt-1 text-[11px] tabular-nums text-white/60" data-level-best>
                  {toTeam ? 'Play solo on the plaza →' : best ? `Best ${fmt(best.score)} · ${fmt(best.rounds)} rounds · ${best.clears}× clear` : open ? 'Not cleared yet' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function LevelClear({ id, score, rounds, best, onNext, onLevels }: { id: LevelId; score: number; rounds: number; best: number; onNext: ((next: LevelId) => void) | null; onLevels: () => void }) {
  const l = levelOf(id);
  const nx = nextLevel(id);
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]" data-level-clear={id}>
      <div className="tbx-glass tbx-in-d w-full max-w-md p-5 text-center" style={{ boxShadow: `0 0 0 1px ${l.palette.key}, 0 0 60px ${l.palette.key}44` }}>
        <p className="tbx-eyebrow" style={{ color: l.palette.key }}>Level clear</p>
        <h2 className="tbx-display mt-1 text-4xl"><Brand>{l.name}</Brand></h2>
        <p className="mt-2 text-sm italic text-white/75">&ldquo;{l.kweg}&rdquo; — Dr Kweg Wong</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-left">
          {[
            ['Score', fmt(score)],
            ['Rounds', fmt(rounds)],
            ['Best', fmt(best)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md border border-[var(--tbx-line)] bg-black/30 px-2 py-1.5">
              <dt className="text-[10px] uppercase tracking-[0.2em] text-[var(--tbx-mute)]">{k}</dt>
              <dd className="tbx-display text-xl tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onNext && nx && (
            <button type="button" className="tbx-btn tbx-btn-on" onClick={() => onNext(nx)} data-next-level={nx}>
              Next: <Brand>{levelOf(nx).name}</Brand>
            </button>
          )}
          <button type="button" className="tbx-btn" onClick={onLevels}>
            Levels
          </button>
        </div>
      </div>
    </div>
  );
}
