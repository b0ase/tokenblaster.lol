'use client';

/**
 * LIVE paid rounds: the last accepted tx (WhatsOnChain link) and how many ARC says are on the network NOW
 * (SEEN_ON_NETWORK / ACCEPTED_BY_NETWORK / MINED), so the player can check rounds land in real time
 * (owner test, 25 Oct 2026). "held" = accepted by ARC but stored / queued / orphan-pooled, relayed later.
 */
export function LiveTxBadge({ last, sent, seen }: { last: string | null; sent: number; seen: number }) {
  if (!last) return null;
  const held = Math.max(0, sent - seen);
  return (
    <div className="tbx-glass absolute bottom-[150px] left-1.5 z-10 flex flex-col gap-0.5 px-3 py-1.5 text-[10px] font-bold tracking-[0.15em] sm:bottom-[88px] sm:left-3" data-live-tx>
      <a href={`https://whatsonchain.com/tx/${last}`} target="_blank" rel="noopener noreferrer" className="text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
        LAST TX {last.slice(0, 10)}…
      </a>
      <span style={{ color: held > seen ? 'var(--tbx-amber)' : 'var(--tbx-text)' }}>
        SEEN ON NETWORK {seen.toLocaleString('en-US')}
        {held > 0 && <span className="opacity-70"> · HELD BY ARC {held.toLocaleString('en-US')}</span>}
      </span>
    </div>
  );
}
