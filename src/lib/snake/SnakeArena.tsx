'use client';

/**
 * Token Snake ARENA shell: lobby (quick match / private room / solo vs bots), HUD, leaderboard with X avatars, kill
 * feed, death + respawn. The game is arenaEngine.ts, the room is arenaNet.ts; TokenSnake.tsx mounts this over its grid
 * game. Nothing here sends money: LIVE per-bite transactions are the parent's `pay` queue, and a LIVE death to another
 * player is handed to the parent's `payKiller` (the Arena's PvP rule, src/lib/pvpPay.ts: the killer's gun from presence).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletInterface } from '@bsv/sdk';
import { Avatar, IdentityPicker, InviteButton, PlayerBadge, useMyHandle } from '@/components/PlayerBadge';
import { Display, Sticker } from '@/components/dr';
import { DR } from '@/lib/dr/tokens';
import { proveHandle, verifyWire } from '@/lib/identity';
import type { Loot } from '@/lib/loot';
import type { HitMsg } from '@/lib/pvpPay';
import { ArenaEngine, type ArenaHud, type BoardEntry, type FeedEntry, type Quality, type Toast } from './arenaEngine';
import { ArenaSession, arenaAvailable, cleanCode, newCode, type ArenaPlayer, type RoomStatus } from './arenaNet';
import { MAX_SNAKES } from './arenaSim';
import type { FoodKind, FoodSpec } from './sim';

const hudFont = { fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase' } as const;
const MAX_PUB = 8;

export type SnakeArenaProps = {
  quality: Quality;
  touch: boolean;
  wallet: WalletInterface | null;
  takeTx(kind: FoodKind): FoodSpec | null;
  /** LIVE mode is offered (a house address is configured). */
  liveOffer: boolean;
  /** The live ammo panel is open and loaded: START can go live. */
  liveReady: boolean;
  onLiveOpen(): void;
  /** A run begins / ends: the parent resets or stops its pay queue. */
  onRunStart(live: boolean): void;
  onRunEnd(): void;
  pay(a: string[]): void;
  canPay(): boolean;
  onPickup(l: Loot): void;
  onNeedAmmo(): void;
  /** My gun address (the recipient when someone pays me for a kill), shared in presence like the Arena. */
  gun?: string;
  /** LIVE PvP (the Arena rule, src/lib/pvpPay.ts): I was cut off by `killerId`; pay their gun once per `did`. */
  payKiller?(did: string, killerId: string, killerGun: string | undefined): void;
  /** The parent calls this once a kill payment is on chain, so the killer sees it (sent as an 'h' message). */
  onHitLink?(send: ((m: HitMsg) => void) | null): void;
  onExit(): void;
  /** ?room=CODE from the URL: join that private room straight away. */
  autoRoom: string | null;
  enterFullscreen?(): void;
};

type Conn = { kind: 'quick' | 'private' | 'solo'; code: string; pub: number };
type Fed = FeedEntry & { id: number };

export function SnakeArena(p: SnakeArenaProps) {
  const mount = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ArenaEngine | null>(null);
  const session = useRef<ArenaSession | null>(null);
  const handle = useMyHandle();
  const [conn, setConn] = useState<Conn | null>(() => (p.autoRoom ? { kind: 'private', code: cleanCode(p.autoRoom), pub: 1 } : null));
  const [ready, setReady] = useState<{ topic: string; id: string } | null>(() => (p.autoRoom && !arenaAvailable() ? { topic: 'solo:auto', id: 'solo-auto' } : null));
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [players, setPlayers] = useState<ArenaPlayer[]>([]);
  const [roomFull, setRoomFull] = useState(false);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [codeIn, setCodeIn] = useState('');
  const [wantLive, setWantLive] = useState(false);
  const [hud, setHud] = useState<ArenaHud | null>(null);
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [feed, setFeed] = useState<Fed[]>([]);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [dead, setDead] = useState<{ by: string | null; byX?: string; cause: string; mass: number; kills: number; score: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fps, setFps] = useState(60);
  const [liveNow, setLiveNow] = useState(false);
  const [ammoHold, setAmmoHold] = useState(false);
  const playersRef = useRef<ArenaPlayer[]>([]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  const idc = useRef(0);
  const pref = useRef(p);
  useEffect(() => {
    pref.current = p;
  });
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  const wantLiveRef = useRef(false);
  useEffect(() => {
    wantLiveRef.current = wantLive && p.liveReady;
  }, [wantLive, p.liveReady]);

  const toast = useCallback((t: Toast) => {
    const id = ++idc.current;
    setToasts((a) => [...a.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 1900);
  }, []);

  const leave = useCallback(() => {
    pref.current.onRunEnd();
    setConn(null);
    setReady(null);
    setDead(null);
    setHud(null);
    setBoard([]);
    setFeed([]);
    setPlayers([]);
    setRoomFull(false);
    setLiveNow(false);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('room');
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* no history */
    }
  }, []);

  /** Open a room: solo (or no realtime server) is ready at once; otherwise the effect below connects and settles. */
  const join = useCallback((c: Conn) => {
    setRoomFull(false);
    setStatus('connecting');
    if (c.kind === 'solo' || !arenaAvailable()) {
      const id = `solo-${Math.random().toString(36).slice(2, 8)}`;
      setStatus('off');
      setReady({ topic: `solo:${id}`, id });
    } else setReady(null);
    setConn(c);
  }, []);

  // ── Room: connect, wait for the roster to settle, hop public rooms when full ──
  useEffect(() => {
    if (!conn || conn.kind === 'solo' || !arenaAvailable()) return;
    const mine: { s: ArenaSession | null } = { s: null }; // callbacks can fire inside the constructor
    const s = new ArenaSession(
      { quick: conn.kind === 'quick', code: conn.code, pub: conn.pub, profile: { name: handleRef.current ? `@${handleRef.current}` : 'snake', x: handleRef.current ?? undefined, gun: pref.current.gun || undefined } },
      {
        onRoster: (list, full) => {
          if (session.current !== mine.s) return;
          setPlayers(list);
          if (!mine.s?.settledNow) return;
          if (full) {
            if (conn.kind === 'quick' && conn.pub < MAX_PUB) setConn({ ...conn, pub: conn.pub + 1 });
            else setRoomFull(true);
            return;
          }
          setReady((r) => r ?? (mine.s ? { topic: mine.s.topic, id: mine.s.id } : null));
        },
        onStatus: (st) => session.current === mine.s && setStatus(st),
        onMsg: (ev, m, from) => {
          if (session.current !== mine.s) return;
          if (ev === 'h') {
            // Someone I cut off paid me by the Arena rule: their token is in my gun now.
            if (m.to === mine.s?.id && typeof m.n === 'number' && m.n > 0) toast({ text: m.tokens ? `+${Math.min(99, m.n)} $${String(m.sym ?? '').slice(0, 12)} IN YOUR GUN from ${String(m.from ?? 'snake').slice(0, 16)}` : `${String(m.from ?? 'snake').slice(0, 16)} PAID OUT`, tone: 'gold' });
            return;
          }
          engine.current?.onMessage(ev, m, from);
        },
      },
    );
    session.current = s;
    mine.s = s;
    if (conn.kind === 'private') {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('room', conn.code);
        window.history.replaceState(null, '', u.toString());
      } catch {
        /* no history */
      }
    }
    return () => {
      s.leave();
      if (session.current === s) session.current = null;
    };
  }, [conn, toast]);

  // ── Engine ──
  useEffect(() => {
    const el = mount.current;
    if (!el || !ready) return;
    let dead_ = false;
    const s = session.current;
    const startLive = wantLiveRef.current;
    const nm = handleRef.current ? `@${handleRef.current}` : `snake-${ready.id.slice(0, 4)}`;
    const eng = new ArenaEngine(el, {
      quality: pref.current.quality,
      touchDevice: pref.current.touch,
      seedKey: ready.topic,
      me: { id: ready.id, name: nm, x: handleRef.current ?? undefined },
      send: (ev, m) => s?.send(ev, m),
      solo: !s,
      takeTx: (k) => pref.current.takeTx(k),
      pay: (a) => pref.current.pay(a),
      canPay: () => pref.current.canPay(),
      live: startLive,
      mini: mini.current,
      cb: {
        onHud: setHud,
        onBoard: setBoard,
        onFeed: (e) => {
          const id = ++idc.current;
          setFeed((a) => [...a.slice(-4), { ...e, id }]);
          setTimeout(() => setFeed((a) => a.filter((x) => x.id !== id)), 6000);
        },
        onToast: (t) => !dead_ && toast(t),
        onDeath: (d) => setDead({ by: d.by?.name ?? null, byX: d.by?.x, cause: d.cause, mass: d.mass, kills: d.kills, score: d.score }),
        onRespawn: () => setDead(null),
        onPickup: (l) => pref.current.onPickup(l),
        onNeedAmmo: () => {
          // LIVE never drops to practice by itself: the snake holds (shielded) until ammo is loaded or practice is chosen.
          setAmmoHold(true);
          pref.current.onNeedAmmo();
        },
        onKilled: (did, by) => {
          const k = playersRef.current.find((q) => q.id === by);
          pref.current.payKiller?.(did, by, k?.gun);
        },
        onPerf: (i) => setFps(i.fps),
      },
    });
    engine.current = eng;
    setErr(null);
    setLiveNow(startLive);
    setAmmoHold(false);
    pref.current.onRunStart(startLive);
    eng
      .init()
      .then(() => {
        if (dead_) return;
        eng.start();
        pref.current.enterFullscreen?.();
      })
      .catch((e: unknown) => !dead_ && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      dead_ = true;
      engine.current = null;
      eng.dispose();
      pref.current.onRunEnd();
    };
  }, [ready, toast]);

  // ── Identity: my handle in presence, proof with a connected wallet, check everyone else's ──
  useEffect(() => {
    const nm = handle ? `@${handle}` : session.current ? `snake-${session.current.id.slice(0, 4)}` : 'snake';
    session.current?.setProfile({ name: nm, x: handle ?? undefined });
    engine.current?.setIdentity({ name: nm, x: handle ?? undefined }, false);
  }, [handle, ready]);
  // My gun in presence: where a LIVE killer's payment lands when I cut someone off (the Arena does the same).
  useEffect(() => {
    session.current?.setProfile({ gun: p.gun || undefined });
  }, [p.gun, ready]);
  // Once my kill payment is on chain, tell the killer (they toast "+n $SYM in your gun").
  useEffect(() => {
    pref.current.onHitLink?.((m) => {
      const s = session.current;
      if (s) s.send('h', { ...m, from: handleRef.current ? `@${handleRef.current}` : `snake-${s.id.slice(0, 4)}`, i: s.id });
    });
    return () => pref.current.onHitLink?.(null);
  }, []);
  const proved = useRef('');
  useEffect(() => {
    const s = session.current;
    if (!s || !ready || !p.wallet || !handle) return;
    const k = `${s.id}|${handle}`;
    if (proved.current === k) return;
    proved.current = k;
    void proveHandle(p.wallet, handle, s.id).then((w) => {
      if (!w || session.current !== s) return;
      s.setProfile({ x: w.x, xk: w.xk, xs: w.xs });
      engine.current?.setIdentity({ name: `@${handle}`, x: w.x, xk: w.xk, xs: w.xs }, true);
      setVerified((v) => ({ ...v, [s.id]: true }));
    });
  }, [ready, p.wallet, handle]);
  useEffect(() => {
    let live = true;
    for (const pl of players) {
      if (!pl.xs || !pl.x) continue;
      void verifyWire(pl, pl.id).then((ok) => {
        if (live && ok) setVerified((v) => (v[pl.id] ? v : { ...v, [pl.id]: true }));
      });
    }
    return () => {
      live = false;
    };
  }, [players]);
  useEffect(() => {
    engine.current?.setRoster(players, verified);
    const s = session.current;
    if (s) {
      // my own tick shows on my own tag too
      engine.current?.setIdentity({ name: handle ? `@${handle}` : 'snake', x: handle ?? undefined }, Boolean(verified[s.id]));
    }
  }, [players, verified, handle, ready]);

  // Enter / space respawns.
  useEffect(() => {
    if (!dead) return;
    const t = setInterval(() => {
      /* HUD refresh drives the respawn countdown */
    }, 500);
    const k = (e: KeyboardEvent) => {
      if ((e.code === 'Enter' || e.code === 'Space') && engine.current?.respawnReady) {
        e.preventDefault();
        engine.current.respawn();
      }
    };
    window.addEventListener('keydown', k);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', k);
    };
  }, [dead]);

  const playing = Boolean(ready && !err);
  const inRoom = conn?.kind !== 'solo' && Boolean(conn) && arenaAvailable();
  const link = typeof window !== 'undefined' && conn?.kind === 'private' ? `${window.location.origin}${window.location.pathname}?room=${conn.code}` : '';
  const others = players.filter((x) => x.id !== ready?.id);

  return (
    <div className="absolute inset-0 z-30 select-none overflow-hidden bg-black" style={{ touchAction: 'none', fontFamily: DR.font.mono }} data-snake-arena={conn ? conn.kind : 'lobby'}>
      <div ref={mount} className="absolute inset-0 touch-none" />

      {/* ── HUD ── */}
      {playing && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-2 top-2 flex flex-col gap-1 sm:left-3 sm:top-3">
            <div className="flex items-stretch">
              <div className="px-3 py-1" style={{ background: DR.colour.signal, ...hudFont }}>
                <div className="text-[9px] leading-none tracking-widest text-white/80" style={{ fontFamily: DR.font.mono, fontStyle: 'normal' }}>
                  LENGTH
                </div>
                <div className="text-3xl tabular-nums leading-none text-white sm:text-5xl" data-arena-len>
                  {Math.round(hud?.mass ?? 0)}
                </div>
              </div>
              <div className="flex flex-col justify-center bg-black/70 px-2 text-[11px] text-white" style={hudFont}>
                <span>
                  KILLS <span data-arena-kills>{hud?.kills ?? 0}</span>
                </span>
                <span style={{ color: DR.colour.amber }}>SCORE {(hud?.score ?? 0).toLocaleString('en-GB')}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 bg-black/70 px-2 py-0.5 text-[10px] tracking-widest text-white">
              {inRoom ? (
                <>
                  <span style={{ color: status === 'live' ? DR.colour.acid : DR.colour.amber }}>{status === 'live' ? '● ' : '○ '}{conn?.kind === 'private' ? `ROOM ${conn.code}` : `PUBLIC ${conn?.pub}`}</span>
                  <span className="text-dim">
                    {others.length + 1}/{MAX_SNAKES} snakes
                  </span>
                </>
              ) : (
                <span className="text-dim">SOLO · bots</span>
              )}
              {liveNow ? <span style={{ color: DR.colour.acid }}>· LIVE: every bite is a tx</span> : <span className="text-dim">· practice: nothing on chain</span>}
            </div>
            {hud && hud.alive && hud.shield > 0 && (
              <div className="w-fit bg-black/70 px-1.5 py-0.5 text-[10px]" style={{ ...hudFont, color: DR.colour.cyan }}>
                SHIELD UP
              </div>
            )}
          </div>
          <div className="absolute right-2 top-2 w-44 sm:right-3 sm:top-3 sm:w-56">
            <div className="bg-black/70 px-2 py-1">
              <div className="mb-0.5 flex items-center justify-between text-[10px] tracking-widest text-dim">
                <span>LEADERBOARD · LENGTH</span>
                {hud && hud.rank > 0 && <span className="text-white">#{hud.rank}</span>}
              </div>
              <ol className="flex flex-col gap-0.5" data-arena-board>
                {board.slice(0, 8).map((r, i) => (
                  <li key={r.id} className="flex items-center gap-1 text-[11px]" style={{ color: r.me ? '#fff' : '#cfcfd8', fontWeight: r.me ? 700 : 400 }} data-board-row={r.x ?? r.name}>
                    <span className="w-3 text-dim">{i + 1}</span>
                    <PlayerBadge handle={r.x} name={r.name} verified={r.verified} ring={r.col} size={16} className="flex-1" />
                    <span className="tabular-nums">{Math.round(r.mass)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3">
            <canvas ref={mini} width={132} height={132} className="h-[84px] w-[84px] border border-white/20 sm:h-[132px] sm:w-[132px]" />
          </div>
          <div className="absolute bottom-2 right-2 flex w-60 flex-col items-end gap-0.5 sm:bottom-3 sm:right-3 sm:w-72" data-arena-feed>
            {feed.map((f) => (
              <div key={f.id} className="max-w-full bg-black/70 px-1.5 py-0.5 text-[11px] text-white" style={{ borderLeft: `3px solid ${f.mine === 'killer' ? DR.colour.acid : f.mine === 'victim' ? DR.colour.signal : '#444'}` }} data-kill-feed={`${f.killer?.x ?? f.killer?.name ?? ''}>${f.victim.x ?? f.victim.name}`}>
                {f.killer ? (
                  <>
                    <b style={{ color: f.killer.col }}>{f.killer.x ? `@${f.killer.x}` : f.killer.name}</b> cut off <b style={{ color: f.victim.col }}>{f.victim.x ? `@${f.victim.x}` : f.victim.name}</b>
                  </>
                ) : (
                  <>
                    <b style={{ color: f.victim.col }}>{f.victim.x ? `@${f.victim.x}` : f.victim.name}</b> {f.cause === 'wall' ? 'hit the wall' : 'crashed'}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-14 flex flex-col items-center gap-1 sm:bottom-3">
            {toasts.map((t) => (
              <Sticker key={t.id} bg={t.tone === 'gold' ? DR.colour.amber : t.tone === 'good' ? DR.colour.acid : t.tone === 'bad' ? DR.colour.signal : DR.colour.paper} fg={t.tone === 'bad' ? '#fff' : '#111'} size={t.tone === 'gold' ? 20 : 15} rot={-2}>
                {t.text}
              </Sticker>
            ))}
          </div>
          {fps < 28 && <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-1 text-[10px] text-dim">{fps} fps</span>}
        </div>
      )}

      {/* ── Controls ── */}
      {playing && (
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 sm:top-3">
          <button onClick={leave} className="btn px-2 py-1 text-xs">
            ✕ LEAVE
          </button>
          {link && <InviteButton link={link} game="Token Snake Arena" />}
          {p.touch && (
            <button
              className="btn btn-on px-3 py-1 text-xs"
              onPointerDown={() => engine.current?.setBoost(true)}
              onPointerUp={() => engine.current?.setBoost(false)}
              onPointerLeave={() => engine.current?.setBoost(false)}
              onPointerCancel={() => engine.current?.setBoost(false)}
            >
              BOOST
            </button>
          )}
        </div>
      )}
      {playing && !dead && !p.touch && <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/40 text-center text-[10px] tracking-widest text-dim">MOUSE aims · HOLD CLICK / SPACE to boost (drops a trail of food) · A/D or ←/→ steer · head into a snake body and you burst into food</p>}

      {/* ── LIVE out of ammo: held, shielded, until more is loaded (or practice is chosen) ── */}
      {playing && ammoHold && !dead && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-3 text-center" data-arena-ammo-hold>
          <Display size="clamp(32px,6vw,64px)" colour={DR.colour.amber}>
            OUT OF AMMO
          </Display>
          <p className="max-w-sm text-sm text-white">Load more to keep playing LIVE. Your snake is held and shielded until you do.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => {
                if (!p.canPay()) return;
                engine.current?.resumeAmmo(false);
                setAmmoHold(false);
              }}
              disabled={!p.canPay()}
              className="btn btn-on px-4 py-2 disabled:opacity-40"
            >
              ▶ RESUME LIVE
            </button>
            <button onClick={() => p.onLiveOpen()} className="btn px-3 py-2 text-xs">
              LOAD MORE
            </button>
            <button
              onClick={() => {
                engine.current?.resumeAmmo(true);
                setAmmoHold(false);
                setLiveNow(false);
                p.onRunStart(false);
              }}
              className="btn px-3 py-2 text-xs"
            >
              PRACTICE INSTEAD
            </button>
          </div>
        </div>
      )}

      {/* ── Dead ── */}
      {playing && dead && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 p-3 text-center">
          <Display size="clamp(36px,7vw,72px)" colour={DR.colour.signal}>
            {dead.cause === 'wall' ? 'HIT THE WALL' : 'CUT OFF'}
          </Display>
          {dead.by && (
            <p className="text-sm text-white">
              by <b>{dead.byX ? `@${dead.byX}` : dead.by}</b>
            </p>
          )}
          <p className="text-xs text-dim">
            reached length {Math.round(dead.mass)} · {dead.kills} kills · score {dead.score.toLocaleString('en-GB')}. Your body burst into food: anyone can eat it.
          </p>
          <div className="flex gap-2">
            <button onClick={() => engine.current?.respawn()} disabled={(hud?.respawnIn ?? 0) > 0.05} className="btn btn-on px-4 py-2 disabled:opacity-40" data-arena-respawn>
              ▶ RESPAWN {hud && hud.respawnIn > 0.05 ? `(${Math.ceil(hud.respawnIn)})` : '(ENTER)'}
            </button>
            <button onClick={leave} className="btn px-3 py-2 text-xs">
              LEAVE
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center">
          <p className="text-2xl font-bold text-hot">Could not start the 3D scene</p>
          <p className="max-w-md text-sm text-dim">{err}</p>
          <button onClick={leave} className="btn btn-on">
            BACK
          </button>
        </div>
      )}

      {/* ── Connecting ── */}
      {conn && !ready && !err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 text-center">
          <Display size="clamp(34px,7vw,72px)">
            SNAKE <span style={{ color: DR.colour.acid }}>ARENA</span>
          </Display>
          {roomFull ? (
            <>
              <p className="text-sm text-hot">That room is full ({MAX_SNAKES} snakes). Try another code or quick match.</p>
              <button onClick={leave} className="btn btn-on">
                BACK
              </button>
            </>
          ) : (
            <>
              <p className="text-xs tracking-widest text-dim">{conn.kind === 'quick' ? `FINDING A ROOM… (public ${conn.pub})` : `JOINING ROOM ${conn.code}…`}</p>
              <button onClick={leave} className="btn text-xs">
                cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Lobby ── */}
      {!conn && (
        <div className="absolute inset-0 overflow-y-auto p-3 sm:p-5" style={{ background: 'linear-gradient(90deg, rgba(5,5,8,0.95) 0%, rgba(5,5,8,0.82) 55%, rgba(5,5,8,0.5) 100%)' }}>
          <div className="flex max-w-[36rem] flex-col gap-2.5">
            <div className="leading-none">
              <Display size="clamp(40px,7vw,84px)">
                SNAKE <span style={{ color: DR.colour.acid }}>ARENA</span>
              </Display>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Sticker bg={DR.colour.amber} size={15} rot={-2}>
                UP TO {MAX_SNAKES} SNAKES
              </Sticker>
              <Sticker bg={DR.colour.paper} size={12} rot={2}>
                EAT THE CHAIN · CUT THEM OFF
              </Sticker>
            </div>
            <p className="max-w-md text-xs text-fg">
              One neon arena, up to {MAX_SNAKES} snakes. Steer with the mouse, hold click or space to boost (the length you burn drops behind you as food anyone can eat). Run your head into another snake&apos;s body and you die and burst into glowing food that anyone can eat; cut off others to grow. The food is the same for everyone in the room and still comes from live mainnet transactions. LIVE with a token: if another player cuts you off, one of your tokens lands in their gun (the Arena rule).
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <IdentityPicker verified={Boolean(ready && verified[ready.id])} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => join({ kind: 'quick', code: '', pub: 1 })}
                disabled={!arenaAvailable()}
                className="btn btn-on px-4 py-2 text-base font-bold tracking-widest disabled:opacity-40"
                data-arena-quick
              >
                ⚡ QUICK MATCH
              </button>
              <button onClick={() => join({ kind: 'private', code: newCode(), pub: 1 })} disabled={!arenaAvailable()} className="btn px-3 py-2 text-sm font-bold tracking-widest disabled:opacity-40" data-arena-private>
                NEW PRIVATE ROOM
              </button>
              <button onClick={() => join({ kind: 'solo', code: '', pub: 1 })} className="btn px-3 py-2 text-sm tracking-widest" data-arena-solo>
                SOLO vs BOTS
              </button>
            </div>
            <form
              className="flex items-center gap-1 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                const c = cleanCode(codeIn);
                if (c.length >= 3) join({ kind: 'private', code: c, pub: 1 });
              }}
            >
              <label htmlFor="snake-room" className="text-dim">
                Room code
              </label>
              <input id="snake-room" value={codeIn} onChange={(e) => setCodeIn(e.target.value)} maxLength={8} placeholder="ABCDE" className="w-24 border border-white/20 bg-black/60 px-1 py-0.5 uppercase text-fg outline-none" autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={cleanCode(codeIn).length < 3 || !arenaAvailable()} className="btn px-2 py-0.5 text-[11px] disabled:opacity-40">
                JOIN
              </button>
            </form>
            {!arenaAvailable() && <p className="text-[11px] text-hot">Multiplayer needs the realtime server (not configured here): solo vs bots only.</p>}
            {p.liveOffer && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-xs" style={{ color: DR.colour.acid }}>
                  <input
                    type="checkbox"
                    checked={wantLive}
                    onChange={(e) => {
                      setWantLive(e.target.checked);
                      if (e.target.checked) p.onLiveOpen();
                    }}
                  />
                  LIVE: a tiny real transaction per bite (paid from the ammo panel below the arena)
                </label>
                {wantLive && !p.liveReady && <span className="text-[10px] text-dim">Load ammo in the panel below the arena first; until then you will play practice.</span>}
              </div>
            )}
            <p className="text-[10px] text-dim">
              Practice sends nothing. In LIVE only your own bites are paid, exactly like the grid game. Kills in the arena are bragging and food only: no tokens change hands between players.
            </p>
            <button onClick={p.onExit} className="w-fit text-xs text-dim hover:text-fg">
              ← back to Token Snake
            </button>
          </div>
        </div>
      )}
      {/* tiny roster of who is in the room, with avatars, shown in the lobby of a private room before the engine is up */}
      {conn && !ready && others.length > 0 && (
        <div className="absolute bottom-3 left-3 flex gap-1 bg-black/70 p-1">
          {others.map((o) => (
            <Avatar key={o.id} handle={o.x} size={22} />
          ))}
        </div>
      )}
    </div>
  );
}
