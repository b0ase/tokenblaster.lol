'use client';

/** "Choose your girl": NPG girl + a weapon per hand, six stats → game modifiers (src/lib/npgLoadout.ts). One compact card. */
import { useMemo } from 'react';
import { DEFAULT_ROSTER, STATS, STAT_ABBR, allowedWeapons, girlImg, modsFor, normalizePick, statsFor, weaponById, weaponImg, type Mods, type Pick } from '@/lib/npgLoadout';
import type { NpgOwned } from '@/lib/npgLoadout';

const MOD_OF: Record<(typeof STATS)[number], { key: keyof Mods; label: string; invert?: boolean }> = {
  strength: { key: 'damage', label: 'dmg' },
  speed: { key: 'speed', label: 'move' },
  skill: { key: 'spread', label: 'aim', invert: true },
  stamina: { key: 'hp', label: 'hp' },
  stealth: { key: 'incoming', label: 'evade', invert: true },
  style: { key: 'score', label: 'score' },
};
const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`;

export function CharacterSelect({
  pick,
  setPick,
  owned,
  cards,
}: {
  pick: Pick;
  setPick: (p: Pick) => void;
  owned: NpgOwned;
  cards: { checking: boolean; checked: boolean; check: () => void; error: string | null } | null;
}) {
  const girl = DEFAULT_ROSTER.find((g) => g.id === pick.girl) ?? DEFAULT_ROSTER[0];
  const stats = useMemo(() => statsFor(pick), [pick]);
  const mods = modsFor(stats);
  const hand = (h: 'right' | 'left') => {
    const list = allowedWeapons(girl, h, owned.elements);
    const cur = weaponById(pick[h]);
    return (
      <label className="flex min-w-0 items-center gap-1.5 text-[10px] tracking-[0.14em] text-white/60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cur && <img src={weaponImg(cur.id)} alt="" loading="lazy" className="h-7 w-7 shrink-0 object-contain" />}
        <span className="shrink-0">{h === 'right' ? 'R' : 'L'}</span>
        <select
          value={pick[h] ?? ''}
          onChange={(e) => setPick(normalizePick({ ...pick, [h]: e.target.value }, owned.elements))}
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/60 px-1 py-1 text-[11px] text-white"
          data-npg-weapon={h}
        >
          {list.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.owner === girl.name ? ' ★' : ''}
              {owned.elements.has(w.id) ? ' (owned)' : ''} · {w.rarity}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <section className="tbx-glass rounded-xl p-2 sm:p-3" data-character-select>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-[0.24em] text-[var(--tbx-amber)]">CHOOSE YOUR GIRL</p>
        {cards && (
          <button type="button" onClick={cards.check} disabled={cards.checking} className="text-[10px] font-bold tracking-[0.16em] text-[var(--tbx-teal)] underline underline-offset-4 disabled:opacity-50" data-npg-check>
            {cards.checking ? 'CHECKING…' : cards.checked ? `NPG CARDS: ${owned.elements.size} PARTS` : 'CHECK MY WALLET FOR NPG CARDS'}
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3">
        <div className="flex shrink-0 gap-1" role="radiogroup" aria-label="Girl">
          {DEFAULT_ROSTER.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.id === girl.id}
              onClick={() => setPick(normalizePick({ girl: g.id, right: g.right, left: g.left }, owned.elements))}
              className={`relative h-[84px] w-[46px] overflow-hidden rounded border sm:h-[110px] sm:w-[62px] ${g.id === girl.id ? 'border-[var(--tbx-red)] bg-[var(--tbx-red)]/20' : 'border-white/15 bg-black/40 opacity-75'}`}
              data-npg-girl={g.id}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={girlImg(g.id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain object-top" />
              <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] font-bold tracking-[0.1em] text-white sm:text-[9px]">
                {g.name.toUpperCase()}
                {owned.girls.has(g.id) ? ' ✓' : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {hand('right')}
          {hand('left')}
          <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[9px] tracking-[0.08em] sm:grid-cols-6" data-npg-stats>
            {STATS.map((s) => {
              const m = MOD_OF[s];
              const d = (mods[m.key] - 1) * (m.invert ? -1 : 1);
              return (
                <span key={s} className="flex justify-between gap-1 whitespace-nowrap text-white/70" title={`${s} → ${m.label}`}>
                  <b className="text-white">{STAT_ABBR[s]} {stats[s]}</b>
                  <span className={d > 0.001 ? 'text-[var(--tbx-teal)]' : d < -0.001 ? 'text-[#ff9a92]' : ''}>
                    {m.label} {signed(m.invert ? -(mods[m.key] - 1) : mods[m.key] - 1)}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {cards?.error && <p className="mt-1 text-[10px] text-[#ff9a92]">{cards.error}</p>}
    </section>
  );
}
