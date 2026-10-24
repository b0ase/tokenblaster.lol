'use client';

import Image from 'next/image';
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-4">
      {games.map((g, i) => (
        <div key={g.title} className="group/card relative flex" data-reveal style={{ ['--i' as string]: i % 5 }} {...previewHandlers(g.href)}>
          <Link href={g.href} className="hp-card group">
            <div className="hp-card-art">
              {/* 1200x630 sources, served resized (AVIF/WebP) for the card's real width: 1 column on phones, ~290-420px above */}
              <Image src={g.img} alt={`${g.title}`} width={1200} height={630} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 420px" />
              <span className="hp-card-n">{pad(i + 1)}</span>
              <span className="hp-card-kind">{g.kind}</span>
            </div>
            <div className="flex flex-1 flex-col p-3.5 pt-2">
              <span className="dr-code">
                TB-{pad(i + 1)} / {g.version}
              </span>
              <span className="dr-display mt-1.5 text-[28px] text-hot transition-colors group-hover:text-[var(--accent)]">{g.title}</span>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{g.blurb}</p>
              <span className="hp-card-go" aria-hidden>
                Play &raquo;
              </span>
            </div>
          </Link>
          <PreviewButton href={g.href} title={g.title} className="absolute right-2 top-2 z-10 [@media(hover:hover)]:group-hover/card:opacity-100" />
        </div>
      ))}
    </div>
  );
}
