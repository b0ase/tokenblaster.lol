'use client';
/**
 * TERRORNODE SPECTATOR (/arcade/terrornode/watch?room=CODE): a read-only view of a team match for the livestream.
 * Joins the room as a spectator ({t:'watch'}: no slot, no wallet, nothing sent), draws the match from the server's
 * snapshots with a slow broadcast camera, and lays a clean overlay over it: every player (up to 16) with kills,
 * deaths, transactions and LIVE badges, the round counter (co-op wave / PvP frags and clock) and the live tx/s.
 *
 * Made to be captured: full-screen over the site chrome, no buttons in the overlay. `&hud=only` drops the 3D view
 * and renders the overlay on a transparent page (an OBS browser source over another scene); `&q=low` for a light
 * machine. If the websocket can't reach the game server the overlay keeps updating from the HTTP state endpoint.
 */
import { useEffect, useRef, useState } from 'react';
import { TeamClient, type TeamStatus } from '@/lib/teammode/client';
import { TEAM_NAME, type PublicState, type Snapshot, type Team } from '@/lib/teammode/match';
import type { TeamScene } from '@/lib/teammode/scene';
import { levelOf } from '@/lib/terrornode/levels';
import { txRate, type TxSample } from '@/lib/terrornode/spectate';

const COLOUR: Record<Team, string> = { npg: '#2ec8e0', erobotz: '#ff2a46' };
const fmt = (n: number) => n.toLocaleString('en-US');
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Spectator({ room, hudOnly = false }: { room: string; hudOnly?: boolean }) {
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ wave: number; frags: Record<Team, number>; endsAt: number | null; alive: Set<string> } | null>(null);
  const [rate, setRate] = useState({ tx: 0, shots: 0 });
  const [now, setNow] = useState(() => Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<TeamScene | null>(null);
  const names = useRef(new Map<string, string>());
  const samples = useRef<TxSample[]>([]);
  const lastSnapAt = useRef(0);
  const levelRef = useRef<PublicState['level'] | null>(null);

  const onState = (s: PublicState) => {
    setState(s);
    names.current = new Map(s.players.map((p) => [p.id, p.name]));
    const t = Date.now();
    samples.current = [...samples.current.filter((x) => t - x.at < 10_000), { at: t, tx: s.txShots ?? s.players.reduce((a, p) => a + p.txShots, 0), shots: s.shots ?? s.players.reduce((a, p) => a + p.shots, 0) }];
    setRate(txRate(samples.current));
    levelRef.current = s.level ?? null;
    if (s.level && scene.current) void scene.current.setLevel(s.level);
  };

  // the room, read-only
  useEffect(() => {
    const c = new TeamClient(
      room,
      { name: 'spectator' },
      {
        onState,
        onSnap: (s: Snapshot) => {
          lastSnapAt.current = Date.now();
          scene.current?.apply(s, names.current);
          setSnap({ wave: s.wave, frags: s.frags, endsAt: s.endsAt, alive: new Set(s.p.filter((p) => p[5]).map((p) => p[0])) });
        },
        onWelcome: () => undefined,
        onError: setErr,
        onStatus: setStatus,
      },
      true,
    );
    return () => c.close();
  }, [room]);

  // HTTP fallback: keep the overlay current even when the websocket is down (or the server predates spectators)
  useEffect(() => {
    const i = setInterval(async () => {
      if (Date.now() - lastSnapAt.current < 3000) return;
      const r = await fetch(`/api/terrornode/team/${room}`, { cache: 'no-store' }).catch(() => null);
      if (!r?.ok) return;
      onState((await r.json()) as PublicState);
    }, 2500);
    return () => clearInterval(i);
  }, [room]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);

  // the broadcast camera (lazy: three.js only loads here)
  useEffect(() => {
    if (hudOnly || !canvas.current) return;
    let live = true;
    void import('@/lib/teammode/scene').then(async ({ TeamScene }) => {
      if (!live || !canvas.current) return;
      const high = new URLSearchParams(location.search).get('q') !== 'low';
      const s = new TeamScene(canvas.current, { high, spectate: true });
      scene.current = s;
      await s.init(() => undefined);
      if (!live) return s.dispose();
      if (levelRef.current) void s.setLevel(levelRef.current);
    });
    return () => {
      live = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [hudOnly]);

  const L = levelOf(state?.level);
  const pvp = state?.mode === 'pvp';
  const players = state?.players ?? [];
  const sides: Team[] = pvp ? ['npg', 'erobotz'] : ['npg'];
  const wave = snap?.wave ?? state?.wave ?? 0;
  const endsAt = snap?.endsAt ?? state?.endsAt ?? null;
  const frags = snap?.frags ?? { npg: state?.teams[0]?.frags ?? 0, erobotz: state?.teams[1]?.frags ?? 0 };
  const left = endsAt ? endsAt - now : null;

  return (
    <div className={`fixed inset-0 z-[100] overflow-hidden text-white ${hudOnly ? 'bg-transparent' : 'bg-[#05060f]'}`} data-spectator={room} data-status={status ?? ''}>
      {!hudOnly && <canvas ref={canvas} className="absolute inset-0 h-full w-full" />}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-[clamp(12px,2vw,32px)]">
        {/* top bar: title, level, round counter, tx/s */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-xl border border-white/10 bg-black/55 px-4 py-2.5 backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase tracking-[0.32em]" style={{ color: L.palette.key }}>
              Assault on Terrornode · {pvp ? 'NPG vs Erobotz' : 'Co-op'} · {L.name}
            </p>
            <p className="mt-0.5 font-mono text-sm text-white/70">
              Room <span className="font-bold text-white">{room}</span>
              {state?.phase ? ` · ${state.phase === 'live' ? 'LIVE' : state.phase === 'lobby' ? 'LOBBY' : 'FINAL'}` : status === 'retrying' ? ' · reconnecting' : ' · connecting'}
            </p>
          </div>
          <div className="flex gap-2">
            <Stat label={pvp ? 'Round' : 'Wave'} value={pvp ? (left != null ? clock(left) : '—') : `${wave}/${state?.waves ?? 10}`} accent={L.palette.key} data="round" />
            {pvp && <Stat label="Frags" value={`${frags.npg}–${frags.erobotz}`} accent="#fff" data="frags" />}
            {!pvp && <Stat label="Erobots" value={fmt(state?.enemiesLive ?? 0)} accent={COLOUR.erobotz} data="enemies" />}
            <Stat label="TX / sec" value={fmt(Math.round(rate.tx))} accent="#ffd21a" data="tps" sub={`${fmt(Math.round(rate.shots))} shots/s · ${fmt(state?.txShots ?? 0)} tx`} />
          </div>
        </header>

        {err && !state && <p className="mx-auto rounded-lg bg-black/70 px-4 py-2 text-sm text-[#ff6b7d]">{err}</p>}
        {state?.phase === 'over' && (
          <p className="mx-auto rounded-2xl border border-white/15 bg-black/70 px-8 py-4 text-center text-4xl font-black uppercase tracking-tight backdrop-blur-md" data-final>
            {state.winner === 'squad' ? 'TERRORNODE taken' : state.winner === 'horde' ? 'The horde holds' : state.winner === 'draw' ? 'Draw' : `${TEAM_NAME[state.winner as Team] ?? ''} win`}
          </p>
        )}

        {/* the roster: all players */}
        <footer className={`grid gap-3 ${pvp ? 'grid-cols-2' : 'grid-cols-1'}`} data-roster>
          {sides.map((t) => {
            const list = players.filter((p) => p.team === t).sort((a, b) => b.score - a.score);
            return (
              <section key={t} className="rounded-xl border bg-black/55 p-2.5 backdrop-blur-md" style={{ borderColor: `${COLOUR[t]}66` }}>
                <p className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: COLOUR[t] }}>
                  <span>{pvp ? TEAM_NAME[t] : 'NPG squads'}</span>
                  <span className="text-white/60">{list.length} players</span>
                </p>
                <ol className={`grid gap-1 ${pvp ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
                  {list.map((p) => {
                    const alive = snap ? snap.alive.has(p.id) : p.alive;
                    return (
                      <li key={p.id} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1 text-[13px]" data-player={p.id}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: !p.connected ? '#555' : alive ? COLOUR[t] : '#ff2a46' }} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                        {p.streamSlot && <span className="rounded bg-[#ff2a46] px-1 text-[9px] font-black">LIVE</span>}
                        <span className="tabular-nums text-white/75">{p.kills}/{p.deaths}</span>
                        <span className="w-14 text-right tabular-nums text-[#ffd21a]">{fmt(p.txShots)}</span>
                      </li>
                    );
                  })}
                  {!list.length && <li className="px-2 py-1 text-[13px] text-white/50">Waiting for players…</li>}
                </ol>
              </section>
            );
          })}
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, sub, data }: { label: string; value: string; accent: string; sub?: string; data: string }) {
  return (
    <div className="min-w-[110px] rounded-xl border border-white/10 bg-black/55 px-4 py-2 text-right backdrop-blur-md" data-stat={data}>
      <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60">{label}</p>
      <p className="text-3xl font-black tabular-nums leading-tight" style={{ color: accent }}>
        {value}
      </p>
      {sub && <p className="text-[10px] tabular-nums text-white/55">{sub}</p>}
    </div>
  );
}
