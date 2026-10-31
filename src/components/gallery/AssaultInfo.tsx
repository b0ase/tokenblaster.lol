'use client';
/**
 * /arcade/terrornode/leaderboard (owner, 25 Oct 2026): everything that used to sit below the game. The prize and
 * rules, the Top blasters board, Watch on bsv.lol and the info text. The game page is the game only.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRIZE, inEvent, type BoardRow } from '@/lib/gallery';
import { buildWeapons } from '@/lib/bsvgun/weapons';
import { useMyHandle } from '../PlayerBadge';
import { Icon } from '../coinop/ui';
import { tbxFontClass } from '../coinop/fonts';
import { PrizeBanner } from './PrizeBanner';
import { CREDIT } from '@/lib/gallery/story';

export const INFO_URL = '/arcade/terrornode/leaderboard';

export function AssaultInfo({ paid }: { paid: boolean }) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [win, setWin] = useState<'event' | '24h'>('event');
  const [clock, setClock] = useState(0);
  const me = useMyHandle();
  const names = useMemo(() => new Map(buildWeapons().map((w) => [w.id, w.name])), []);
  const load = useCallback(() => {
    fetch(`/api/gallery/board?window=${win}`)
      .then((r) => r.json())
      .then((j: { rows?: BoardRow[] }) => setRows(j.rows ?? []))
      .catch(() => undefined);
  }, [win]);
  useEffect(() => {
    void Promise.resolve().then(() => (setClock(Date.now()), load()));
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, [load]);

  return (
    <div className={`${tbxFontClass} mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-3 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="tbx-display text-[clamp(28px,5vw,48px)]">Scores &amp; info</h1>
        <Link href="/arcade/terrornode" className="tbx-btn tbx-btn-red">
          <Icon name="crosshair" size={14} /> Back to the game
        </Link>
      </div>

      {paid && <PrizeBanner />}

      <section id="gallery-board" className="tbx-glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}><Icon name="trophy" size={14} className="text-[var(--tbx-amber)]" /> Top blasters</span>
          <div className="flex gap-1.5">
            {(['event', '24h'] as const).map((w) => (
              <button key={w} onClick={() => setWin(w)} className={`tbx-btn !min-h-[32px] !px-3 !text-[11px] ${win === w ? 'tbx-btn-on' : ''}`}>
                {w === 'event' ? '31 OCT EVENT' : '24H'}
              </button>
            ))}
          </div>
        </div>
        <GalleryBoard rows={rows} me={me} names={names} />
        <p className="mt-3 text-xs text-[var(--tbx-mute)]">
          Accepted LIVE shots carrying your handle, checked on chain by the tokenblaster.lol &quot;gallery&quot; tag.{' '}
          {clock && inEvent(clock) ? 'The event is on now.' : `Event: ${new Date(PRIZE.start).toUTCString().slice(0, 16)} (UTC).`}
          {!paid && ' Demo rounds are not scored.'}
        </p>
      </section>

      <section className="tbx-glass p-4">
        <p className="tbx-eyebrow mb-2 flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}><Icon name="chain" size={14} /> See them land</p>
        <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
          Watch on bsv.lol <Icon name="external" size={12} />
        </a>
      </section>

      <section className="tbx-glass p-4 text-sm text-[var(--tbx-dim)]" data-info>
        <p>
          Neo-Tokyo, 2048. The Ninja Punk Girls blast into the centre of the nSLAVE corporation to free Dr Kweg S Wong, held hostage by the evil Erobotz.
          Act 1, STORM THE NODE: the street, the HQ floors and the core, where he is freed. Act 2, ESCAPE FROM TERRORNODE: get him out over the roof, past the Liquid Unit. He keeps running the wrong way: protect him.
        </p>
        <p className="mt-2">
          {paid
            ? 'In paid play every round is a real tagged BSV transaction ("tokenblaster.lol" … "gallery"), signed in your browser from a gun your wallet funds, so you can watch them land on bsv.lol.'
            : 'Demo: simulated rounds. Nothing is paid, signed or sent on chain. Insert $b to play.'}
        </p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-[var(--tbx-mute)]" data-credit>{CREDIT}</p>
      </section>
    </div>
  );
}

export function GalleryBoard({
  rows,
  me,
  mine = 0,
  myWeapon,
  myAmmo,
  names,
}: {
  rows: BoardRow[];
  me?: string | null;
  mine?: number;
  myWeapon?: string;
  myAmmo?: string;
  names?: Map<string, string>;
}) {
  // This session's live count, merged in so the player sees themselves climb before the next report lands.
  const list = [...rows];
  if (me && mine) {
    const i = list.findIndex((r) => r.handle === me);
    if (i >= 0) list[i] = { ...list[i], shots: Math.max(list[i].shots, mine) };
    else list.push({ handle: me, shots: mine, sessions: 1, weapon: myWeapon, ammo: myAmmo });
    list.sort((a, b) => b.shots - a.shots);
  }
  if (!list.length) return <p className="text-sm text-[var(--tbx-dim)]">No ranked shots yet. Be the first name on the board.</p>;
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {list.slice(0, 10).map((r, i) => (
        <li key={r.handle} className={`tbx-rise flex flex-wrap items-center justify-between gap-x-3 rounded-lg px-3 py-2 ${r.handle === me ? 'border border-[var(--tbx-teal)]/50 bg-[var(--tbx-teal)]/10' : 'bg-white/[0.035]'}`} style={{ ['--d' as string]: `${i * 0.04}s` }}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="tbx-display w-7 text-xl" style={{ color: i === 0 ? 'var(--tbx-amber)' : 'var(--tbx-mute)' }}>{String(i + 1).padStart(2, '0')}</span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">@{r.handle}</span>
            {r.weapon && <span className="text-xs text-[var(--tbx-dim)]">{names?.get(r.weapon) ?? r.weapon}</span>}
            {r.ammo && <span className="text-xs text-[var(--tbx-amber)]">{r.ammo}</span>}
          </span>
          <span className="tbx-num font-bold">{r.shots.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
