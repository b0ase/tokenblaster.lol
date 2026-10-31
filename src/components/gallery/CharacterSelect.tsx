'use client';

/**
 * "Choose your girl": pick an NPG girl. One compact banner card over the TERRORNODE key art. Weapon pickers and stat
 * lines are not shown (owner, 31 Oct 2026; they return with a weapons system); the pick's modifiers still apply in
 * the engine via src/lib/npgLoadout.ts.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { isMobileLite } from '@/lib/mobileLite';
import { DEFAULT_ROSTER, girlImg, normalizePick, type Pick } from '@/lib/npgLoadout';
import type { NpgOwned } from '@/lib/npgLoadout';

// Live 3D girls in the full card (not the phone strip, not the mobile-lite tier): three.js loads only when used.
import { engineReady } from '@/lib/galleryGame/engineReady';
const Girls3D = dynamic(() => import('./Girls3D').then((m) => m.Girls3D), { ssr: false });
const noSub = () => () => {};
const want3d = () => !isMobileLite() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function CharacterSelect({
  pick,
  setPick,
  owned,
  cards,
  compact = false,
}: {
  compact?: boolean;
  pick: Pick;
  setPick: (p: Pick) => void;
  owned: NpgOwned;
  cards: { checking: boolean; checked: boolean; check: () => void; error: string | null } | null;
}) {
  const girl = DEFAULT_ROSTER.find((g) => g.id === pick.girl) ?? DEFAULT_ROSTER[0];
  const [sheet, setSheet] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const [ready3d, setReady3d] = useState(false);
  const ids = useMemo(() => DEFAULT_ROSTER.map((g) => g.id), []);
  const can3d = useSyncExternalStore(noSub, want3d, () => false);
  const playable = useSyncExternalStore(engineReady.subscribe, engineReady.get, () => false);
  const three = !compact && can3d && playable; // after the game is ready (engineReady.ts): 2D art until then
  if (compact) {
    // Phone on its side, before START: a thin strip of portraits so START stays on the first screen; the full
    // chooser (girls only) opens in a sheet.
    return (
      <div className="flex items-center gap-1.5" data-character-strip>
        <div className="flex gap-1" role="radiogroup" aria-label="Choose your girl">
          {DEFAULT_ROSTER.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.id === girl.id}
              aria-label={g.name}
              onClick={() => setPick(normalizePick({ girl: g.id, right: g.right, left: g.left }, owned.elements))}
              className={`relative h-[50px] w-[30px] overflow-hidden rounded border bg-black/50 ${g.id === girl.id ? 'border-2 border-[var(--tbx-red)] shadow-[0_0_12px_rgba(255,59,59,.7)]' : 'border-white/20 opacity-70'}`}
              data-npg-girl={g.id}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={girlImg(g.id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain object-top" />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSheet(true)} className="rounded bg-black/70 px-2 py-1 text-left text-[9px] font-bold leading-tight tracking-[0.14em] text-white" data-npg-sheet-open>
          <span className="block text-[var(--tbx-amber)]">{girl.name.toUpperCase()}</span>
          <span className="text-white/70">CHOOSE ▸</span>
        </button>
        {sheet && (
          <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/75 p-3" onClick={() => setSheet(false)} data-npg-sheet>
            <div className="w-full max-w-[640px]" onClick={(e) => e.stopPropagation()}>
              <CharacterSelect pick={pick} setPick={setPick} owned={owned} cards={cards} />
              <button type="button" onClick={() => setSheet(false)} className="btn btn-on mt-2 w-full py-2 text-xs font-bold tracking-widest" data-npg-sheet-close>
                DONE
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <section className="relative isolate overflow-hidden rounded-xl border border-white/10 p-2 sm:p-3" data-character-select>
      {/* Banner: ONE continuous TERRORNODE key art behind the whole panel (no per-portrait boxes cutting it up), with a
          gentle gradient: clear in the middle, darker at the top (title) and the bottom (names). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: 'linear-gradient(180deg,rgba(4,9,14,.55) 0%,rgba(4,9,14,.12) 30%,rgba(4,9,14,.18) 70%,rgba(4,9,14,.7) 100%), url(/arcade/gallery.jpg)' }}
        data-character-banner
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-[0.24em] text-[var(--tbx-amber)]">CHOOSE YOUR GIRL</p>
        {cards && (
          <button type="button" onClick={cards.check} disabled={cards.checking} className="text-[10px] font-bold tracking-[0.16em] text-[var(--tbx-teal)] underline underline-offset-4 disabled:opacity-50" data-npg-check>
            {cards.checking ? 'CHECKING…' : cards.checked ? `NPG CARDS: ${owned.elements.size} PARTS` : 'CHECK MY WALLET FOR NPG CARDS'}
          </button>
        )}
      </div>
      <div className="mt-2">
        <div ref={row} className="relative mx-auto flex w-max max-w-full gap-2 overflow-x-auto p-1 [scrollbar-width:none] lg:gap-4" role="radiogroup" aria-label="Girl">
          {DEFAULT_ROSTER.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-label={g.name}
              aria-checked={g.id === girl.id}
              onClick={() => setPick(normalizePick({ girl: g.id, right: g.right, left: g.left }, owned.elements))}
              className={`relative h-[210px] w-[118px] shrink-0 rounded-lg transition sm:h-[260px] sm:w-[128px] lg:h-[300px] lg:w-[160px] [@media(max-height:500px)]:h-[150px] [@media(max-height:500px)]:w-[86px] ${g.id === girl.id ? 'bg-[radial-gradient(ellipse_at_50%_70%,rgba(255,59,59,.35),transparent_70%)] ring-2 ring-[var(--tbx-red)] shadow-[0_0_24px_rgba(255,59,59,.55)]' : `hover:ring-1 hover:ring-white/40 ${ready3d ? '' : 'opacity-90'}`}`}
              data-npg-girl={g.id}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={girlImg(g.id)} alt="" loading="lazy" className={`absolute inset-0 h-full w-full object-contain object-bottom pb-4 drop-shadow-[0_6px_10px_rgba(0,0,0,.7)] transition-opacity ${ready3d ? 'opacity-0' : ''}`} />
            </button>
          ))}
          {three && <Girls3D container={row} ids={ids} selected={girl.id} onReady={setReady3d} />}
          {/* names sit ABOVE the shared 3D canvas (z-[4]), in their own layer, so no model or stacking context clips them */}
          <div aria-hidden className="pointer-events-none absolute inset-y-1 left-1 z-[4] flex gap-2 lg:gap-4">
            {DEFAULT_ROSTER.map((g) => (
              <span key={g.id} className="relative h-full w-[118px] shrink-0 sm:w-[128px] lg:w-[160px] [@media(max-height:500px)]:w-[86px]">
                <span className={`absolute inset-x-0 bottom-1 whitespace-nowrap text-center text-[11px] font-bold leading-[14px] tracking-[0.18em] [text-shadow:0_1px_4px_#000,0_0_8px_#000] sm:text-xs ${g.id === girl.id ? 'text-[var(--tbx-amber)]' : 'text-white'}`} data-npg-name={g.id}>
                  {g.name.toUpperCase()}
                  {owned.girls.has(g.id) ? ' ✓' : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {cards?.error && <p className="mt-1 text-[10px] text-[#ff9a92]">{cards.error}</p>}
    </section>
  );
}
