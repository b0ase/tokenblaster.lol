'use client';

/**
 * Player identity UI: <PlayerBadge> (avatar + @handle + tick), <IdentityPicker> (enter your X handle once),
 * <InviteButton> (copy a room link + open an X post for the group chat), and useMyHandle().
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { avatarUrl, cleanHandle, identiconUrl, inviteIntent, myHandle, onMyHandle, saveMyHandle } from '@/lib/identity';
import { cachedProof, hasProofWallet, onCachedProof, verifyHandle } from '@/lib/xproof';

export function useMyHandle(): string | null {
  return useSyncExternalStore(onMyHandle, myHandle, () => null);
}

export function Avatar({ handle, size = 20, ring }: { handle: string | null | undefined; size?: number; ring?: string }) {
  const [bad, setBad] = useState(false);
  const src = handle ? (bad ? identiconUrl(handle) : avatarUrl(handle)) : null;
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}, 0 0 0 3px #000` : undefined };
  if (!src) return <span className="inline-block shrink-0 rounded-full bg-white/10" style={style} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- tiny same-origin avatar; next/image adds nothing here
  return <img src={src} alt="" width={size} height={size} onError={() => setBad(true)} className="inline-block shrink-0 rounded-full bg-black object-cover" style={style} />;
}

export function PlayerBadge({ handle, name, verified, ring, size = 18, className = '' }: { handle?: string | null; name: string; verified?: boolean; ring?: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`} data-player-badge={handle ?? name}>
      <Avatar handle={handle} size={size} ring={ring} />
      <span className="truncate">{handle ? `@${handle}` : name}</span>
      {verified && (
        <span title="Verified X handle (bWalletX)" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0] text-[9px] leading-none text-white" aria-label="verified">
          ✓
        </span>
      )}
    </span>
  );
}

/** Has this browser a cached ✓ VERIFY proof for `handle`? (Never prompts.) */
export function useHandleVerified(handle: string | null | undefined): boolean {
  return useSyncExternalStore(onCachedProof, () => cachedProof(handle) !== null, () => false);
}

/** ✓ VERIFY: the only place the wallet is asked to sign for the X handle. Signs once, cached; score submits reuse it. */
export function VerifyButton({ handle }: { handle: string }) {
  const done = useHandleVerified(handle);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (done) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        className="btn px-2 py-0.5 text-[11px] disabled:opacity-40"
        title="Sign once with bWalletX to earn the ✓ on your scores"
        data-verify-handle={handle}
        onClick={async () => {
          if (!hasProofWallet()) return setErr('CONNECT WALLET FIRST');
          setBusy(true);
          setErr(null);
          const p = await verifyHandle(handle).catch(() => null);
          setBusy(false);
          if (!p) setErr('NOT LINKED TO THIS X HANDLE');
        }}
      >
        {busy ? 'SIGNING…' : '✓ VERIFY'}
      </button>
      {err && <span className="text-[10px] text-hot">{err}</span>}
    </span>
  );
}

/** "Your X handle" field. Unverified: anyone can type any name; a bWalletX-linked wallet earns the tick in-game. */
export function IdentityPicker({ compact = false, verified = false }: { compact?: boolean; verified?: boolean }) {
  const mine = useMyHandle();
  const cached = useHandleVerified(mine);
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  const ok = cleanHandle(v);
  if (mine && !edit)
    return (
      <span className="inline-flex items-center gap-2 text-xs" data-identity={mine}>
        <span className="text-dim">{compact ? 'YOU' : 'Playing as'}</span>
        <PlayerBadge handle={mine} name={mine} verified={verified || cached} size={22} className="text-fg" />
        {!verified && <VerifyButton handle={mine} />}
        <button
          className="text-[10px] text-dim underline hover:text-hot"
          onClick={() => {
            setV(mine);
            setEdit(true);
          }}
        >
          change
        </button>
      </span>
    );
  return (
    <form
      className="inline-flex flex-wrap items-center gap-1 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        saveMyHandle(ok);
        setEdit(false);
      }}
    >
      <label className="text-dim" htmlFor="tb-xhandle">
        Your X handle
      </label>
      <span className="inline-flex items-center border border-white/20 bg-black/60 px-1">
        <span className="text-dim">@</span>
        <input id="tb-xhandle" value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder="handle" className="w-28 bg-transparent px-0.5 py-0.5 text-fg outline-none" autoComplete="off" spellCheck={false} />
      </span>
      {ok && <Avatar handle={ok} size={20} />}
      <button type="submit" disabled={!ok} className="btn px-2 py-0.5 text-[11px] disabled:opacity-40">
        SET
      </button>
      {mine && (
        <button type="button" className="text-[10px] text-dim underline" onClick={() => (saveMyHandle(null), setEdit(false))}>
          clear
        </button>
      )}
      {!compact && <span className="w-full text-[10px] text-dim">Shown over your head to other players. Unverified unless your bWalletX has your X account linked.</span>}
    </form>
  );
}

/** Copy the room link and open an X post with it, for the group chat. */
export function InviteButton({ link, game, className = '' }: { link: string; game: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);
  const { text, url } = inviteIntent(link, game);
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        className="btn px-2 py-0.5 text-[11px]"
        data-invite={link}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
        }}
      >
        {done ? 'COPIED: PASTE IN YOUR GROUP CHAT' : 'INVITE YOUR GROUP CHAT'}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn px-2 py-0.5 text-[11px]">
        POST ON X
      </a>
    </span>
  );
}
