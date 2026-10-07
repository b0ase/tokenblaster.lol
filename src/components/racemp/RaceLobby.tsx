'use client';

/**
 * Generic race lobby + standings (API notes: src/lib/racemp/session.ts). The game supplies its name, colours and how a
 * pilot row looks (team colour, detail text); the look is flat team colours with hard borders, matching the DR kit.
 *
 *   <RaceLobby game="bRacer" accent="#27e6ff" accent2="#ffb800" ok="#18ff7a" warn="#e8261d" ... />
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { RacePlayer, RaceStanding, RoomStatus } from '@/lib/racemp/session';
import { MAX_PLAYERS } from '@/lib/racemp/session';

const short = (n: string) => (n.length > 14 ? `${n.slice(0, 6)}…${n.slice(-4)}` : n);

export type LobbyColours = { quick: string; priv: string; ok: string; warn: string; amber: string; text?: string };

export type RaceLobbyProps = {
  game: string;
  /** What an AI slot is called ("AI RIVAL: a live chain transaction fills this slot"). */
  aiLabel: string;
  circuit: string;
  mine: string | null;
  code: string;
  quick: boolean;
  status: RoomStatus;
  players: RacePlayer[];
  leader: string | null;
  count: number | null;
  full: boolean;
  racingElsewhere: boolean;
  colours: LobbyColours;
  titleStyle?: CSSProperties;
  /** Team colour for a pilot's stripe. */
  teamColour(p: { team: string }): string;
  /** Second line (hull/car, team). */
  detail(p: RacePlayer): string;
  controls: ReactNode;
  /** Ready-badge wording for a paying / free pilot (default: credit / practice). */
  readyLabels?: { paid: string; free: string };
  /** Optional decoration between the title and the list (e.g. a chevron bar). */
  bar?: ReactNode;
  onLeave(): void;
  onStart(): void;
};

export function RaceLobby(p: RaceLobbyProps) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?room=${p.code}` : '';
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  const c = p.colours;
  const lobby = p.players.filter((x) => x.st === 'lobby');
  const readyN = lobby.filter((x) => x.ready).length;
  const amLeader = p.leader === p.mine;
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => p.players[i] ?? null);
  const aiN = Math.max(0, MAX_PLAYERS - Math.max(1, readyN));
  return (
    <div className="inset bg-black/70 p-2" data-race-lobby={p.code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] tracking-widest text-dim">ROOM</span>
        <span className="px-1.5 text-lg leading-none" style={{ ...p.titleStyle, background: p.quick ? c.quick : c.priv, color: '#000' }}>
          {p.quick ? `QUICK RACE · ${p.circuit}` : `PRIVATE · ${p.code}`}
        </span>
        <span className="text-[10px]" style={{ color: p.status === 'live' ? c.ok : c.amber }}>
          {p.status === 'live' ? '● CONNECTED' : p.status === 'connecting' ? 'CONNECTING…' : 'OFFLINE'}
        </span>
        <button onClick={p.onLeave} className="btn ml-auto px-2 py-0.5 text-[11px]">
          LEAVE ROOM
        </button>
      </div>
      {!p.quick && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-dim">Invite:</span>
          <code className="max-w-full truncate text-fg">{link}</code>
          <button onClick={copy} className="btn px-2 py-0.5 text-[11px]">
            {copied ? 'COPIED' : 'COPY LINK'}
          </button>
        </div>
      )}
      <div className="mt-1.5 grid gap-1" role="list" aria-label="Pilots in the room">
        {slots.map((x, i) => {
          if (!x) {
            return (
              <div key={i} className="flex items-center gap-2 border border-dashed border-white/15 px-2 py-0.5 text-[11px] text-dim" role="listitem">
                <span className="w-4">{i + 1}</span>
                <span>{p.aiLabel}</span>
              </div>
            );
          }
          const you = x.id === p.mine;
          return (
            <div key={x.id} className="flex items-center gap-2 overflow-hidden px-2 py-0.5" style={{ background: you ? '#14141c' : '#0a0a0f', borderLeft: `6px solid ${p.teamColour(x)}`, outline: you ? '1px solid #f4efe2' : undefined }} role="listitem" data-player={x.name}>
              <span className="w-4 text-[11px] text-dim">{i + 1}</span>
              <span className="min-w-0 truncate text-base leading-none text-white" style={p.titleStyle}>
                {short(x.name)}
              </span>
              {you && <span className="text-[9px] tracking-widest text-hot">YOU</span>}
              {x.id === p.leader && x.st === 'lobby' && !p.quick && (
                <span className="text-[9px] tracking-widest" style={{ color: c.amber }}>
                  HOST
                </span>
              )}
              <span className="hidden text-[10px] text-dim sm:inline">{p.detail(x)}</span>
              <span className="ml-auto shrink-0 px-1.5 text-[10px] font-bold tracking-widest" style={{ background: x.st === 'racing' ? c.warn : x.ready ? c.ok : '#222', color: x.st === 'racing' ? '#fff' : x.ready ? '#000' : '#aaa' }}>
                {x.st === 'racing' ? 'RACING' : x.ready ? (x.paid ? (p.readyLabels?.paid ?? 'READY · CREDIT') : (p.readyLabels?.free ?? 'READY · PRACTICE')) : 'WAITING'}
              </span>
            </div>
          );
        })}
      </div>
      {p.bar}
      <p className="mt-1 text-[11px]" style={{ color: p.count !== null ? c.amber : undefined }} aria-live="polite">
        {p.full
          ? 'ROOM FULL (8 pilots). Try another room.'
          : p.count !== null
            ? `RACE STARTS IN ${p.count}…  ${readyN} pilot${readyN === 1 ? '' : 's'} + ${aiN} AI`
            : p.racingElsewhere
              ? 'A race is running in this room. You will be in the next one: get ready.'
              : p.quick
                ? readyN >= 2
                  ? 'Starting soon.'
                  : 'Press READY. The race starts a few seconds after a second pilot is ready, or after a short wait with AI rivals.'
                : amLeader
                  ? 'You are the host: pick the circuit above. The race starts when everyone is ready, or press START.'
                  : 'The host picks the circuit. The race starts when everyone is ready.'}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {!p.full && p.controls}
        {!p.quick && amLeader && readyN >= 1 && (
          <button onClick={p.onStart} className="btn-fire px-3 py-1 text-sm">
            START NOW ({readyN})
          </button>
        )}
      </div>
    </div>
  );
}

export function RaceStandings({ rows, final, teamColour, fmt }: { rows: RaceStanding[]; final: boolean; teamColour(team: string): string; fmt(t: number): string }) {
  if (!rows.length) return null;
  const first = rows.find((r) => r.t !== null)?.t ?? null;
  return (
    <div className="inset w-full bg-black/70 p-2 text-left text-xs sm:max-w-sm" data-race-standings={final ? 'final' : 'live'}>
      <p className="mb-1 text-center font-bold tracking-widest text-dim">THE ROOM {final ? '(FINAL)' : '(LIVE)'}</p>
      {rows.map((r, i) => (
        <div key={r.id} className={`flex items-center gap-1 py-0.5 ${r.me ? 'font-bold text-white' : ''}`}>
          <span className="w-5 text-dim">{i + 1}</span>
          <span className="inline-block h-2 w-2 shrink-0" style={{ background: teamColour(r.team) }} />
          <span className={`truncate ${r.me ? 'text-hot' : 'text-fg'}`}>{short(r.name)}</span>
          <span className="ml-auto tabular-nums">{r.t !== null ? fmt(r.t) : r.dnf ? 'DNF' : 'RACING…'}</span>
          {r.t !== null && first !== null && r.t > first && <span className="w-14 text-right tabular-nums text-dim">+{(r.t - first).toFixed(2)}</span>}
        </div>
      ))}
      <p className="mt-1 text-[10px] text-dim">Pilots only; AI rivals are local to each screen.</p>
    </div>
  );
}
