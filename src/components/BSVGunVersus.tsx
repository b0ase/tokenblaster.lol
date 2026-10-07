'use client';

/**
 * BSVGun VERSUS UI: the lobby (quick match / private room / invite link, roster with X avatars and verified ticks, ready),
 * the live scoreboard HUD and the round results. Room, roster, ready and countdown come from the racemp session
 * (src/lib/racemp, via useRaceRoom in BSVGunRange); the rules and sync are in src/lib/bsvgun/versus.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Display, HazardBar, Sticker, gridBg } from './dr';
import { DR } from '@/lib/dr/tokens';
import type { RoomUi } from '@/lib/racemp/useRaceRoom';
import { MAX_PLAYERS } from '@/lib/racemp/session';
import { Avatar, IdentityPicker, InviteButton, PlayerBadge } from './PlayerBadge';
import type { VsRow } from '@/lib/bsvgun/vsLayer';
import { SHOOTER_COLOURS } from '@/lib/bsvgun/versus';

const short = (n: string) => (n.length > 14 ? `${n.slice(0, 6)}…${n.slice(-4)}` : n);
const label = (r: { x?: string; name: string }) => (r.x ? `@${r.x}` : short(r.name));

export type VsLobbyProps = {
  available: boolean;
  info: { code: string; quick: boolean; id: string } | null;
  ui: RoomUi;
  verified: Record<string, boolean>;
  weaponName: (id: string) => string;
  ready: boolean;
  /** LIVE needs a wallet with sats: why the player can't ready up yet (null = fine). */
  blocked: string | null;
  /** PRACTICE / LIVE switch and wallet loading, shared with the solo menu. */
  liveBar: ReactNode;
  weaponBar: ReactNode;
  onQuick(): void;
  onPrivate(code?: string): void;
  onLeave(): void;
  onReady(r: boolean): void;
  onStart(): void;
  onClose(): void;
};

export function VersusLobby(p: VsLobbyProps) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' && p.info ? `${window.location.origin}${window.location.pathname}?room=${p.info.code}` : '';
  const lobby = p.ui.players.filter((x) => x.st === 'lobby');
  const readyN = lobby.filter((x) => x.ready).length;
  const mine = p.info?.id ?? null;
  const amLeader = p.ui.leader === mine;
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => p.ui.players[i] ?? null);
  const racingElsewhere = p.ui.players.some((x) => x.st === 'racing') && !p.ready;
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: 'rgba(5,5,8,.92)', ...gridBg() }} data-bsvgun-lobby={p.info?.code ?? ''}>
      <HazardBar h={8} colour={DR.colour.cyan} />
      <div className="mx-auto flex max-w-[860px] flex-col gap-3 p-3 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Sticker bg={DR.colour.cyan} fg={DR.colour.ink} rot={-2} size={16}>
            VERSUS
          </Sticker>
          <Display size="clamp(26px,5vw,52px)">2 to 8 shooters, one sky</Display>
          <button onClick={p.onClose} className="ml-auto px-3 py-1 text-sm font-bold" style={{ border: `1px solid ${DR.colour.grey}`, color: DR.colour.grey }}>
            ‹ SOLO MENU
          </button>
        </div>
        <p className="text-[12px]" style={{ color: DR.colour.paper }}>
          Everyone in the room shoots the same clays, ducks, coins, whales and block flock at the same moments. First hit on a target scores it; your friends&apos; X avatars stand over their booths and you see their tracer fire. 75 seconds, highest score wins.
        </p>

        {!p.available && (
          <p className="text-sm" style={{ color: DR.colour.amber }}>
            Multiplayer is not configured on this deployment (no realtime URL).
          </p>
        )}

        {p.available && !p.info && (
          <div className="flex flex-col gap-2">
            <IdentityPicker />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={p.onQuick} className="px-6 py-2 text-xl font-black italic tracking-widest" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}` }} data-vs-quick>
                QUICK MATCH ▶
              </button>
              <button onClick={() => p.onPrivate()} className="px-4 py-2 text-sm font-bold" style={{ border: `2px solid ${DR.colour.cyan}`, color: DR.colour.cyan }} data-vs-private>
                PRIVATE ROOM (invite your group chat)
              </button>
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: DR.colour.grey }}>
                or code
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} className="w-24 border border-white/20 bg-black/60 px-1 py-0.5 text-fg outline-none" placeholder="ABCDE" aria-label="Room code" />
                <button onClick={() => code.length >= 3 && p.onPrivate(code)} className="px-2 py-0.5 font-bold" style={{ border: `1px solid ${DR.colour.amber}`, color: DR.colour.amber }}>
                  JOIN
                </button>
              </span>
            </div>
            <p className="text-[11px]" style={{ color: DR.colour.grey }}>
              Quick match is one public room: it starts a few seconds after a second shooter is ready (or after a short wait, solo).
            </p>
          </div>
        )}

        {p.info && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span style={{ color: DR.colour.grey }}>ROOM</span>
              <span className="px-1.5 text-base font-black italic leading-none" style={{ background: p.info.quick ? DR.colour.amber : DR.colour.cyan, color: DR.colour.ink, fontFamily: DR.font.display }}>
                {p.info.quick ? 'QUICK MATCH' : `PRIVATE · ${p.info.code}`}
              </span>
              <span style={{ color: p.ui.status === 'live' ? DR.colour.acid : DR.colour.amber }}>{p.ui.status === 'live' ? '● CONNECTED' : p.ui.status === 'connecting' ? 'CONNECTING…' : 'OFFLINE'}</span>
              <button onClick={p.onLeave} className="ml-auto px-2 py-0.5 font-bold" style={{ border: `1px solid ${DR.colour.grey}`, color: DR.colour.grey }}>
                LEAVE ROOM
              </button>
            </div>
            {!p.info.quick && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span style={{ color: DR.colour.grey }}>Invite:</span>
                <code className="max-w-full truncate" style={{ color: DR.colour.paper }}>
                  {link}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    });
                  }}
                  className="px-2 py-0.5 font-bold"
                  style={{ border: `1px solid ${DR.colour.amber}`, color: DR.colour.amber }}
                >
                  {copied ? 'COPIED' : 'COPY LINK'}
                </button>
                <InviteButton link={link} game="BSVGun" />
              </div>
            )}
            <IdentityPicker compact verified={Boolean(mine && p.verified[mine])} />
            <div className="grid gap-1" role="list" aria-label="Shooters in the room">
              {slots.map((x, i) => {
                if (!x)
                  return (
                    <div key={i} className="flex items-center gap-2 border border-dashed border-white/15 px-2 py-0.5 text-[11px]" style={{ color: DR.colour.grey }} role="listitem">
                      <span className="w-4">{i + 1}</span>
                      <span>EMPTY BOOTH</span>
                    </div>
                  );
                const col = SHOOTER_COLOURS[i % SHOOTER_COLOURS.length];
                const you = x.id === mine;
                return (
                  <div key={x.id} className="flex items-center gap-2 overflow-hidden px-2 py-0.5" style={{ background: you ? '#14141c' : '#0a0a0f', borderLeft: `6px solid ${col}`, outline: you ? '1px solid #f4efe2' : undefined }} role="listitem" data-player={x.name}>
                    <span className="w-4 text-[11px]" style={{ color: DR.colour.grey }}>
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate text-base leading-none text-white" style={{ fontFamily: DR.font.display }}>
                      <PlayerBadge handle={x.x} name={short(x.name)} verified={p.verified[x.id]} ring={col} size={22} />
                    </span>
                    {you && (
                      <span className="text-[9px] tracking-widest" style={{ color: DR.colour.signal }}>
                        YOU
                      </span>
                    )}
                    {x.id === p.ui.leader && x.st === 'lobby' && !p.info?.quick && (
                      <span className="text-[9px] tracking-widest" style={{ color: DR.colour.amber }}>
                        HOST
                      </span>
                    )}
                    <span className="hidden text-[10px] sm:inline" style={{ color: DR.colour.grey }}>
                      {x.vehicle ? p.weaponName(x.vehicle) : ''}
                    </span>
                    <span className="ml-auto shrink-0 px-1.5 text-[10px] font-bold tracking-widest" style={{ background: x.st === 'racing' ? DR.colour.signal : x.ready ? DR.colour.acid : '#222', color: x.st === 'racing' ? '#fff' : x.ready ? '#000' : '#aaa' }}>
                      {x.st === 'racing' ? 'SHOOTING' : x.ready ? (x.paid ? 'READY · LIVE' : 'READY · PRACTICE') : 'WAITING'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[12px]" style={{ color: p.ui.count !== null ? DR.colour.amber : DR.colour.paper }} aria-live="polite">
              {p.ui.full
                ? 'ROOM FULL (8 shooters). Try another room.'
                : p.ui.count !== null
                  ? `ROUND STARTS IN ${p.ui.count}…  ${readyN} shooter${readyN === 1 ? '' : 's'} on the line`
                  : racingElsewhere
                    ? 'A round is running in this room. You will be in the next one: get ready.'
                    : p.info.quick
                      ? readyN >= 2
                        ? 'Starting soon.'
                        : 'Press READY. The round starts a few seconds after a second shooter is ready, or after a short wait, solo.'
                      : amLeader
                        ? 'You are the host. The round starts when everyone is ready, or press START NOW.'
                        : 'The round starts when everyone is ready.'}
            </p>
            {p.weaponBar}
            <div className="flex flex-wrap items-center gap-2">{p.liveBar}</div>
            <div className="flex flex-wrap items-center gap-2">
              {!p.ui.full &&
                (p.ready ? (
                  <button onClick={() => p.onReady(false)} className="px-5 py-2 text-lg font-black italic" style={{ fontFamily: DR.font.display, border: `2px solid ${DR.colour.paper}`, color: DR.colour.paper }}>
                    NOT READY
                  </button>
                ) : (
                  <button onClick={() => p.onReady(true)} disabled={!!p.blocked} className="px-6 py-2 text-xl font-black italic tracking-widest disabled:opacity-40" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}` }} data-vs-ready>
                    READY ▶
                  </button>
                ))}
              {p.blocked && !p.ready && (
                <span className="text-[11px]" style={{ color: DR.colour.amber }}>
                  {p.blocked}
                </span>
              )}
              {!p.info.quick && amLeader && readyN >= 1 && (
                <button onClick={p.onStart} className="px-4 py-2 text-sm font-bold" style={{ background: DR.colour.amber, color: DR.colour.ink }}>
                  START NOW ({readyN})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The live scoreboard over the scene (4 Hz from the engine), registered like the HUD so the shell doesn't re-render. */
export function VsBoard({ register }: { register: (fn: (r: VsRow[]) => void) => void }) {
  const [rows, setRows] = useState<VsRow[]>([]);
  const reg = useRef(register);
  useEffect(() => {
    const r = reg.current;
    r(setRows);
    return () => r(() => undefined);
  }, []);
  if (!rows.length) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-[116px] w-[178px] sm:w-[220px]" data-vs-board>
      {rows.map((r) => (
        <div key={r.id} className="mb-0.5 flex items-center gap-1.5 px-1.5 py-[3px] text-[11px]" style={{ background: r.me ? 'rgba(244,239,226,.18)' : 'rgba(10,10,12,.7)', borderLeft: `4px solid ${r.color}` }} data-vs-row={r.x ?? r.name}>
          <span className="w-3 text-center" style={{ color: DR.colour.grey }}>
            {r.rank}
          </span>
          <Avatar handle={r.x} size={16} ring={r.color} />
          <span className="min-w-0 flex-1 truncate" style={{ color: r.me ? DR.colour.amber : DR.colour.paper }}>
            {label(r)}
            {r.verified && <span className="ml-1 text-[#1d9bf0]">✓</span>}
          </span>
          <span className="tabular-nums font-bold" style={{ color: DR.colour.paper }}>
            {r.score.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export function VersusResults({ rows, onAgain, onLobby, children }: { rows: VsRow[]; onAgain(): void; onLobby(): void; children?: ReactNode }) {
  const top = rows[0];
  const me = rows.find((r) => r.me);
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: 'rgba(5,5,8,.92)', ...gridBg() }} data-vs-results>
      <HazardBar h={10} colour={DR.colour.cyan} />
      <div className="mx-auto flex max-w-[980px] flex-col gap-3 p-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sticker bg={DR.colour.cyan} fg={DR.colour.ink} rot={-2} size={14}>
              VERSUS · ROUND OVER
            </Sticker>
          </div>
          {top && (
            <Display size="clamp(34px,6vw,76px)" colour={DR.colour.paper} style={{ textShadow: '0 0 30px rgba(232,38,29,.6)' }}>
              {top.me ? 'YOU WIN' : `${label(top)} WINS`}
            </Display>
          )}
          <div className="grid gap-1" role="list" aria-label="Final scoreboard">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1" style={{ background: r.me ? '#14141c' : '#0a0a0f', borderLeft: `6px solid ${r.color}`, outline: r.me ? '1px solid #f4efe2' : undefined }} role="listitem" data-vs-final={r.x ?? r.name}>
                <span className="w-5 text-sm" style={{ color: r.rank === 1 ? DR.colour.amber : DR.colour.grey }}>
                  {r.rank}
                </span>
                <PlayerBadge handle={r.x} name={short(r.name)} verified={r.verified} ring={r.color} size={26} className="text-white" />
                <span className="ml-auto text-[11px]" style={{ color: DR.colour.grey }}>
                  {r.kills} hit{r.kills === 1 ? '' : 's'}
                </span>
                <span className="w-24 text-right text-lg font-black tabular-nums" style={{ color: DR.colour.paper, fontFamily: DR.font.display }}>
                  {r.score.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          {me && (
            <p className="text-[11px]" style={{ color: DR.colour.grey }}>
              Every shooter&apos;s screen computed this same table from the same claims: earliest hit on a target wins it.
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <button onClick={onAgain} className="px-6 py-2 text-xl font-black italic" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: `2px solid ${DR.colour.paper}` }} data-vs-again>
              REMATCH ▶
            </button>
            <button onClick={onLobby} className="px-6 py-2 text-xl font-black italic" style={{ fontFamily: DR.font.display, border: `2px solid ${DR.colour.paper}`, color: DR.colour.paper }}>
              LEAVE
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1 sm:max-w-[420px]">{children}</div>
      </div>
    </div>
  );
}
