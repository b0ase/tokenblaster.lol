'use client';

/**
 * React hook around a RaceSession (API notes: src/lib/racemp/session.ts).
 *
 *   const room = useRaceRoom<MyCfg>({ game: 'bracer', enabled, profile, cfg, quickKey: (c) => c.track, sameCfg, validateCfg,
 *                                      events: ['s', ...], onRemoteCfg: (c) => ..., onGo: (race) => ... });
 *   room.joinQuick() / room.joinPrivate(code?) / room.leave() / room.setReady(true, paid) / room.go() / room.endRace()
 *   room.info   -> { code, quick, id } | null     room.ui -> players, leader, status, count, full, standings, final
 *   room.getLink() -> the RaceLink for your engine (call in handlers/effects, null outside a room)
 * ?room=CODE in the URL joins a private room automatically (once `enabled`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanRoomCode, newRoomCode, raceMpAvailable, RaceSession, type RaceInfo, type RacePlayer, type RaceProfile, type RaceStanding, type RoomStatus } from './session';

export type RoomUi = { players: RacePlayer[]; leader: string | null; status: RoomStatus; count: number | null; full: boolean; standings: RaceStanding[]; final: boolean };
const UI0: RoomUi = { players: [], leader: null, status: 'connecting', count: null, full: false, standings: [], final: false };

export type RaceRoomOpts<C> = {
  game: string;
  /** Join ?room=CODE once true (e.g. after prefs are loaded). */
  enabled: boolean;
  profile: RaceProfile;
  /** My current local config (host's choice is published; non-hosts follow via onRemoteCfg). */
  cfg: C;
  quickKey(c: C): string;
  /** Config used in a public room (e.g. force NORMAL difficulty). */
  quickCfg?(c: C): C;
  sameCfg(a: C, b: C): boolean;
  validateCfg(c: unknown): C | null;
  events: string[];
  onRemoteCfg(c: C): void;
  onGo(race: RaceInfo<C>): void;
};

export function useRaceRoom<C>(o: RaceRoomOpts<C>) {
  const sref = useRef<RaceSession<C> | null>(null);
  const [info, setInfo] = useState<{ code: string; quick: boolean; id: string } | null>(null);
  const [ui, setUi] = useState<RoomUi>(UI0);
  const oref = useRef(o);
  useEffect(() => {
    oref.current = o;
  });

  const leave = useCallback(() => {
    sref.current?.leave();
    sref.current = null;
    setInfo(null);
    setUi(UI0);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('room');
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* no history */
    }
  }, []);

  const join = useCallback((code: string, quick: boolean) => {
    sref.current?.leave();
    const cur = oref.current;
    const cfg = quick && cur.quickCfg ? cur.quickCfg(cur.cfg) : cur.cfg;
    const s = new RaceSession<C>(
      { game: cur.game, code, quick, quickKey: cur.quickKey(cfg), profile: cur.profile, cfg, validateCfg: cur.validateCfg, events: cur.events },
      {
        onRoster: (players, leader) => setUi((u) => ({ ...u, players, leader })),
        onStatus: (status) => setUi((u) => ({ ...u, status })),
        onCfg: (c) => oref.current.onRemoteCfg(c),
        onGo: (race) => oref.current.onGo(race),
        onCount: (count) => setUi((u) => (u.count === count ? u : { ...u, count })),
        onStandings: (standings, final) => setUi((u) => ({ ...u, standings, final })),
        onRoom: ({ full }) => setUi((u) => (u.full === full ? u : { ...u, full })),
      },
    );
    sref.current = s;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __room?: RaceSession<C> }).__room = s;
    setUi(UI0);
    setInfo({ code, quick, id: s.id });
    try {
      const u = new URL(window.location.href);
      if (quick) u.searchParams.delete('room');
      else u.searchParams.set('room', code);
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* no history */
    }
  }, []);

  // ?room=CODE
  const joined = useRef(false);
  useEffect(() => {
    if (!o.enabled || joined.current || !raceMpAvailable()) return;
    joined.current = true;
    const code = cleanRoomCode(new URLSearchParams(window.location.search).get('room') ?? '');
    if (code.length >= 3) void Promise.resolve().then(() => join(code, false));
  }, [o.enabled, join]);

  // Keep my row, and the room config, in sync.
  useEffect(() => {
    sref.current?.setProfile(o.profile);
    const s = sref.current;
    if (!s || !info) return;
    if (info.quick) {
      // A different circuit is a different public room.
      const want = o.quickKey(o.quickCfg ? o.quickCfg(o.cfg) : o.cfg);
      if (s.quickKey !== want) join(info.code, true);
    } else if (ui.leader === s.id && !o.sameCfg(s.cfg, o.cfg)) s.setCfg(o.cfg);
  });
  useEffect(
    () => () => {
      sref.current?.leave();
      sref.current = null;
    },
    [],
  );

  return {
    info,
    ui,
    available: raceMpAvailable(),
    joinQuick: () => join('quick', true),
    joinPrivate: (code?: string) => join(code ? cleanRoomCode(code) : newRoomCode(), false),
    leave,
    setReady: (ready: boolean, paid = false) => sref.current?.setReady(ready, paid),
    go: () => sref.current?.go(),
    endRace: () => {
      sref.current?.endRace();
      setUi((u) => ({ ...u, standings: [], final: false }));
    },
    /** The live session's link (read in event handlers, not during render). */
    getLink: () => sref.current?.link ?? null,
  };
}
