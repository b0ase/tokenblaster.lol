'use client';

import Link from 'next/link';
import { PreviewButton, previewHandlers } from '@/components/PreviewButton';

import type { Game } from '@/lib/games';

type Tile = Game & { href: string };
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The home arcade grid, fed from the shared list in src/lib/games.ts. Hover or focus a card to hear that game's music
 * (when the hero sound is on). Columns fill the width: 1 on a phone, up to 6-7 on wide screens.
 */
export function ArcadeGrid({ games }: { games: Tile[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-4">
      {games.map((g, i) => (
        <div key={g.title} className="group/card relative flex" {...previewHandlers(g.href)}>
          <Link href={g.href} className="group relative flex flex-1 flex-col border-2 border-[var(--border)] bg-panel transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-[var(--hot)] hover:shadow-[5px_5px_0_var(--accent-fill)]">
            <div className="relative aspect-[1200/630] overflow-hidden border-b-2 border-[var(--border)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.img} alt={`${g.title}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
              <span className="dr-display absolute left-0 top-0 bg-[var(--accent-fill)] px-2 py-0.5 text-lg text-[var(--on-accent)]">{pad(i + 1)}</span>
              <span className="dr-sticker absolute bottom-2 right-2 text-[11px]">{g.kind}</span>
            </div>
            <div className="flex flex-1 flex-col p-3">
              <span className="dr-code">
                TB-{pad(i + 1)} / {g.version}
              </span>
              <span className="dr-display mt-1 text-[26px] text-hot group-hover:text-[var(--accent)]">{g.title}</span>
              <p className="mt-2 text-[13px] text-dim">{g.blurb}</p>
            </div>
          </Link>
          <PreviewButton href={g.href} title={g.title} className="absolute right-2 top-2 [@media(hover:hover)]:group-hover/card:opacity-100" />
        </div>
      ))}
    </div>
  );
}
