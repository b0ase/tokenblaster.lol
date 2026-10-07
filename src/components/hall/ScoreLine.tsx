/**
 * Small server-safe pieces of the hall of fame: a player (X avatar + @handle, or just the name), a score line with its
 * proof link, and the "no scores yet" empty state. No hooks, so both the client page body and the server board page use them.
 */
import Link from 'next/link';
import { playerOf, fmtSecs, wocTx } from '@/lib/hallOfFame';
import { avatarUrl } from '@/lib/identity';
import type { ScoreRow } from '@/lib/scores';

export function PlayerTag({ row, size = 20 }: { row: Pick<ScoreRow, 'name' | 'meta'>; size?: number }) {
  const p = playerOf(row);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {p.handle ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl(p.handle)} alt="" width={size} height={size} loading="lazy" className="shrink-0 border border-[var(--border)] bg-[var(--input)] object-cover" style={{ width: size, height: size }} />
      ) : (
        <span aria-hidden className="dr-display grid shrink-0 place-items-center border border-[var(--border)] bg-[var(--input)] text-[var(--muted)]" style={{ width: size, height: size, fontSize: size * 0.6 }}>
          {p.name.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 truncate text-fg">{p.name}</span>
      {p.verified && (
        <span title="X handle verified with bWalletX (a wallet signature)" aria-label="X handle verified" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0] text-[9px] leading-none text-white">
          ✓
        </span>
      )}
    </span>
  );
}

/** The proof of a run: a green tick that opens the tx on WhatsOnChain when it is verified, a plain link when it is not. */
export function Proof({ row }: { row: Pick<ScoreRow, 'txid' | 'verified' | 'mode'> }) {
  if (!row.txid) return row.mode === 'live' ? <span className="text-[10px] text-dim">live</span> : null;
  return row.verified ? (
    <a href={wocTx(row.txid)} target="_blank" rel="noopener noreferrer" title="Verified on chain: open the transaction" aria-label="Verified on chain: open the transaction" className="shrink-0 text-[var(--ok)] hover:underline">
      ✓<span className="sr-only"> verified on chain</span>
    </a>
  ) : (
    <a href={wocTx(row.txid)} target="_blank" rel="noopener noreferrer" title="Transaction (not verified against the run)" className="shrink-0 text-[10px] text-dim hover:underline">
      tx
    </a>
  );
}

export function ScoreLine({ rank, row, unit, size = 20, big = false }: { rank: number; row: ScoreRow; unit?: string; size?: number; big?: boolean }) {
  return (
    <li className={`flex items-center gap-2 ${big ? 'py-1 text-base' : 'py-0.5 text-xs'}`}>
      <span className={`dr-display w-6 shrink-0 text-right ${rank === 1 ? 'text-[var(--accent)]' : 'text-dim'}`}>{rank}</span>
      <PlayerTag row={row} size={size} />
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden text-[10px] text-dim sm:inline">{row.secs > 0 ? fmtSecs(row.secs) : ''}</span>
        <Proof row={row} />
        <span className={`tabular-nums text-hot ${big ? 'text-lg' : ''}`}>
          {row.score.toLocaleString('en-US')}
          {unit && unit !== 'pts' ? <span className="ml-1 text-[10px] text-dim">{unit}</span> : null}
        </span>
      </span>
    </li>
  );
}

/** Empty board: invite the first score. */
export function Empty({ href, label = 'No scores yet. Be first.' }: { href?: string; label?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-dim">
      {label}
      {href && (
        <Link href={href} className="btn !px-2 !py-0.5 !text-[11px]">
          PLAY &raquo;
        </Link>
      )}
    </p>
  );
}
