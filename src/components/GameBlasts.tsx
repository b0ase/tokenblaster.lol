'use client';

import { useEffect, useState } from 'react';

/** All-time blasts per game, fetched once per page and shared by every card. */
let all: Promise<Record<string, number>> | null = null;
const load = () =>
  (all ??= fetch('/api/games?period=all')
    .then((r) => (r.ok ? r.json() : { games: [] }))
    .then((d: { games?: { game: string; blasts: number }[] }) => Object.fromEntries((d.games ?? []).map((g) => [g.game, g.blasts])))
    .catch(() => ({}) as Record<string, number>));

/** "12,345 blasts on chain" for one game's tag (the game name in its OP_RETURN), or nothing yet. */
export function GameBlasts({ tag }: { tag: string }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((m) => alive && setN(m[tag] ?? 0));
    return () => {
      alive = false;
    };
  }, [tag]);
  if (!n) return null;
  return (
    <span className="text-xs text-accent">
      <span className="text-hot">{n.toLocaleString()}</span> on chain
    </span>
  );
}
