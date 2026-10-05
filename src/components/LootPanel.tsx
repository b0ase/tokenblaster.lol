'use client';

/** Token loot views shared by the arcade games: a compact HUD strip and the run / all-time panel. */
import { ranked, type Haul } from '@/lib/loot';

function Icon({ src, sym, size = 16 }: { src: string | null; sym: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="inline-block rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex items-center justify-center rounded-full bg-[#2a1a04] text-[8px] font-bold text-[#ffd36a]" style={{ width: size, height: size }}>
      {sym.slice(0, 2)}
    </span>
  );
}

/** A few icons + counts for the in-game HUD. */
export function LootHud({ haul, max = 4 }: { haul: Haul; max?: number }) {
  const list = ranked(haul);
  if (!list.length) return null;
  return (
    <span className="flex items-center gap-1.5">
      {list.slice(0, max).map((t) => (
        <span key={t.id} className="flex items-center gap-0.5" title={t.sym}>
          <Icon src={t.icon} sym={t.sym} size={12} />
          <span className="text-[#ffd36a]">{t.n}</span>
        </span>
      ))}
      {list.length > max && <span className="text-dim">+{list.length - max}</span>}
    </span>
  );
}

function List({ haul, empty }: { haul: Haul; empty: string }) {
  const list = ranked(haul);
  if (!list.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ol className="flex flex-col gap-1">
      {list.slice(0, 12).map((t, i) => (
        <li key={t.id} className="flex items-center gap-2 text-sm">
          <span className="w-5 text-right text-xs text-muted">{i + 1}.</span>
          <Icon src={t.icon} sym={t.sym} />
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={t.id}>
            {t.sym}
          </span>
          <span className="text-[#ffd36a]">×{t.n.toLocaleString()}</span>
        </li>
      ))}
      {list.length > 12 && <li className="text-xs text-muted">+{list.length - 12} more tokens</li>}
    </ol>
  );
}

/** "Tokens collected": this run and all time, ranked. */
export function LootPanel({ run, allTime }: { run: Haul; allTime: Haul }) {
  const n = (h: Haul) => Object.values(h).reduce((s, t) => s + t.n, 0);
  return (
    <div className="inset mt-2 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-hot">Tokens collected</span>
        <span className="text-xs text-muted">live BSV-21 transfers you grabbed · tallied in this browser · payouts come later</span>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-dim">This run · {n(run).toLocaleString()}</p>
          <List haul={run} empty="Nothing yet: grab the glowing token coins." />
        </div>
        <div>
          <p className="mb-1 text-xs text-dim">All time · {n(allTime).toLocaleString()}</p>
          <List haul={allTime} empty="Your all-time haul shows here." />
        </div>
      </div>
    </div>
  );
}

/** One-line run summary for game-over screens. */
export function LootLine({ haul }: { haul: Haul }) {
  const list = ranked(haul);
  if (!list.length) return <p className="text-xs text-dim">No tokens collected this run.</p>;
  return (
    <div className="flex max-w-[90%] flex-wrap items-center justify-center gap-2 text-xs">
      <span className="text-dim">Tokens collected:</span>
      {list.slice(0, 6).map((t) => (
        <span key={t.id} className="flex items-center gap-1">
          <Icon src={t.icon} sym={t.sym} size={14} />
          <span className="text-fg">{t.sym}</span>
          <span className="text-[#ffd36a]">×{t.n}</span>
        </span>
      ))}
      {list.length > 6 && <span className="text-dim">+{list.length - 6}</span>}
    </div>
  );
}
