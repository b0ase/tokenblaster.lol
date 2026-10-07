/**
 * racemp: game-agnostic real-time race multiplayer (bRacer first, Token Rally next).
 * Transport = src/lib/realtime.ts (Supabase Realtime broadcast + presence, same as the Arena). No server, no DB.
 *
 * ── API in brief ─────────────────────────────────────────────────────────────────────────────────────────────
 *  session.ts   RaceSession<C>     rooms, lobby (presence), ready, countdown, go, finish order, disconnects.
 *               RaceLink           what your engine sees: link.race (grid while racing), link.send(ev, payload),
 *                                  link.on = (ev, payload) => ... (set by the engine), link.finish(t|null),
 *                                  link.green(minTimeSeconds) when the lights go green.
 *  buffer.ts    SnapshotBuffer     per-remote-ship interpolation: push(raw, now) then sample(now) -> state.
 *               Generic state: { prog (monotone distance/progress), v (speed), lap, fl (bit flags),
 *               a: number[] (any channels, lerped; use quat:[i] to nlerp a quaternion at a[i..i+3]), x?: extra }.
 *               Sanity: speed cap on progress, no backwards jumps, clamped channels; `suspect` count freezes cheaters.
 *  useRaceRoom.ts  React hook around a session: join/leave quick or private (?room=CODE), profile sync, cfg
 *               sync (host picks, others follow), ready, go. Returns { info, ui, link, join..., go }.
 *  components/racemp/RaceLobby.tsx  <RaceLobby game accent renderSlot ... /> and <RaceStandings />.
 *
 *  Rooms are namespaced per game: topic `tokenblaster-<game>-pub-<quickKey>` (public, one per circuit) or
 *  `tokenblaster-<game>-r-<CODE>` (private), so bRacer and Rally never mix. Max 8 pilots; the oldest lobby pilot
 *  is the leader (starts the race, publishes the final order).
 *
 *  To adopt: create a RaceLink-aware engine: on go, `link.race.ids` is the grid; send your state ~10-15 Hz with
 *  `link.send('s', { i: link.id, ts: performance.now(), ...state })`, feed received 's' payloads into one
 *  SnapshotBuffer per remote, sample each frame; call link.green(minT) at green and link.finish(t|null) at the
 *  flag. Other event names (weapons...) are yours: list them in `events` and handle them in link.on.
 *  Nothing here moves money; each game keeps its own coin-op/payment code.
 */
import { Room, realtimeConfigured } from '@/lib/realtime';

export const MAX_PLAYERS = 8;

export type RaceProfile = { name: string; vehicle: string; team: string };
export type RacePlayer = RaceProfile & { id: string; ready: boolean; paid: boolean; st: 'lobby' | 'racing'; t: number };
export type RaceInfo<C> = { rid: string; ids: string[]; players: Record<string, RaceProfile>; cfg: C };
export type RaceStanding = { id: string; name: string; team: string; t: number | null; dnf: boolean; me: boolean; racing: boolean };
export type RoomStatus = 'connecting' | 'live' | 'off';

export type RaceLink<C> = {
  id: string;
  /** Set while a race is running: who is on the grid. */
  race: RaceInfo<C> | null;
  /** The engine registers here to receive gameplay messages (filtered to the current race). */
  on: ((ev: string, p: unknown) => void) | null;
  send(ev: string, p: unknown): void;
  /** Human pilots on the grid (for choosing a send rate). */
  humans(): number;
  /** My finish time in seconds since green, or null for DNF. */
  finish(t: number | null): void;
  /** Lights are green now; minT = fastest plausible race time (finish claims below it are ignored). */
  green(minT: number): void;
};

export type SessionCb<C> = {
  onRoster(players: RacePlayer[], leader: string | null): void;
  onStatus(s: RoomStatus): void;
  onCfg(c: C): void;
  onGo(r: RaceInfo<C>): void;
  onCount(secs: number | null): void;
  onStandings(s: RaceStanding[], final: boolean): void;
  onRoom(info: { full: boolean }): void;
};

export type SessionOpts<C> = {
  game: string;
  code: string;
  quick: boolean;
  /** Public rooms are one per key (e.g. the circuit). */
  quickKey: string;
  profile: RaceProfile;
  cfg: C;
  validateCfg(c: unknown): C | null;
  /** Gameplay event names routed to link.on. */
  events: string[];
};

const rid4 = () => Math.random().toString(36).slice(2, 6);
export const newRoomCode = () => {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
export const cleanRoomCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const raceMpAvailable = realtimeConfigured;

export class RaceSession<C> {
  readonly link: RaceLink<C>;
  readonly id = Math.random().toString(36).slice(2, 10);
  players: RacePlayer[] = [];
  leader: string | null = null;
  status: RoomStatus = 'connecting';
  cfg: C;
  readonly quick: boolean;
  readonly quickKey: string;
  readonly code: string;
  private room: Room;
  private me: RacePlayer;
  private engineEv: Set<string>;
  private tick: ReturnType<typeof setInterval>;
  private readySince = 0;
  private lastCount = -2;
  private fin = new Map<string, { t: number | null }>();
  private raceStart = 0;
  private finalSent = false;
  private firstFinAt = 0;
  private greenAt = 0;
  private minT = 0;
  private officialRes: { id: string; t: number | null }[] | null = null;
  private lastRid = '';
  private left = false;

  constructor(private o: SessionOpts<C>, private cb: SessionCb<C>) {
    this.cfg = o.cfg;
    this.quick = o.quick;
    this.quickKey = o.quickKey;
    this.code = o.code;
    this.engineEv = new Set(o.events);
    this.me = { id: this.id, ...o.profile, ready: false, paid: false, st: 'lobby', t: Date.now() };
    this.link = {
      id: this.id,
      race: null,
      on: null,
      send: (ev, p) => this.room.broadcast(ev, p),
      humans: () => this.link.race?.ids.length ?? 1,
      finish: (t) => this.myFinish(t),
      green: (minT) => {
        this.greenAt = performance.now();
        this.minT = minT;
      },
    };
    const topic = o.quick ? `tokenblaster-${o.game}-pub-${o.quickKey}` : `tokenblaster-${o.game}-r-${o.code}`;
    this.room = new Room(topic, this.id, {
      onBroadcast: (ev, p) => this.onMsg(ev, p),
      onPresence: (state) => this.onPresence(state),
      onStatus: (s) => {
        this.status = s;
        cb.onStatus(s);
        if (s === 'live') this.pushMe();
      },
    });
    this.pushMe();
    this.tick = setInterval(() => this.step(), 500);
  }

  // ── Lobby ──

  private pushMe() {
    this.room.track({ ...this.me, v: 1 });
  }
  setProfile(p: Partial<RaceProfile>) {
    const m = this.me;
    if ((p.name === undefined || p.name === m.name) && (p.vehicle === undefined || p.vehicle === m.vehicle) && (p.team === undefined || p.team === m.team)) return;
    Object.assign(m, p);
    this.pushMe();
  }
  setReady(ready: boolean, paid = false) {
    this.me.ready = ready;
    this.me.paid = ready && paid;
    this.pushMe();
  }
  /** Private room host: publish the game's room config (circuit, difficulty...). */
  setCfg(c: C) {
    this.cfg = c;
    if (!this.quick && this.isLeader()) this.room.broadcast('cfg', c);
  }
  isLeader() {
    return this.leader === this.id;
  }
  private onPresence(state: Record<string, unknown[]>) {
    const list: RacePlayer[] = [];
    for (const metas of Object.values(state)) {
      const m = metas[metas.length - 1] as Partial<RacePlayer> | undefined;
      if (!m || typeof m.id !== 'string' || m.id === this.id) continue;
      list.push({ id: m.id, name: String(m.name ?? 'pilot').slice(0, 16), vehicle: String(m.vehicle ?? ''), team: String(m.team ?? ''), ready: Boolean(m.ready), paid: Boolean(m.paid), st: m.st === 'racing' ? 'racing' : 'lobby', t: Number(m.t) || 0 });
    }
    // I always know myself (presence echoes can lag).
    list.push({ ...this.me });
    list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const grew = list.length > this.players.length;
    this.players = list.slice(0, 64);
    const lead = list.find((p) => p.st === 'lobby')?.id ?? null;
    if (lead !== this.leader) {
      const was = this.leader === this.id;
      this.leader = lead;
      // A new private-room host re-publishes the config so the others follow.
      if (!was && lead === this.id && !this.quick) this.room.broadcast('cfg', this.cfg);
    }
    if (grew && this.isLeader() && !this.quick) this.room.broadcast('cfg', this.cfg);
    const idx = list.findIndex((p) => p.id === this.id);
    this.cb.onRoom({ full: idx >= MAX_PLAYERS });
    this.cb.onRoster(this.players, this.leader);
    if (this.link.race) this.checkDone();
  }

  /** Leader loop: decide when to start. */
  private step() {
    if (this.link.race) {
      this.checkDone();
      return;
    }
    // Keep my own row fresh even before the first presence echo.
    if (!this.players.length) this.onPresence({});
    const lobby = this.players.filter((p) => p.st === 'lobby');
    const ready = lobby.filter((p) => p.ready).slice(0, MAX_PLAYERS);
    const now = Date.now();
    if (!ready.length) this.readySince = 0;
    else if (!this.readySince) this.readySince = now;
    if (!this.isLeader() || this.status !== 'live') return;
    let left: number | null = null;
    if (ready.length) {
      const all = ready.length === lobby.length;
      const waited = (now - this.readySince) / 1000;
      if (this.quick) {
        // Public: 2+ ready -> 8 s (3 s when everyone is ready); a lone pilot waits 20 s for company, then goes with AI.
        const need = ready.length >= 2 ? (all ? 3 : 8) : 20;
        left = Math.max(0, need - waited);
      } else if (all) left = Math.max(0, 3 - waited);
    }
    if (left === null) {
      if (this.lastCount !== -1) this.room.broadcast('lc', { left: null });
      this.lastCount = -1;
      this.cb.onCount(null);
      return;
    }
    const s = Math.ceil(left);
    if (s !== this.lastCount) {
      this.lastCount = s;
      this.room.broadcast('lc', { left: s });
      this.cb.onCount(s);
    }
    if (left <= 0) this.go();
  }

  /** Leader only (timer, or the host's START button). */
  go() {
    if (!this.isLeader() || this.link.race) return;
    const ready = this.players.filter((p) => p.st === 'lobby' && p.ready).slice(0, MAX_PLAYERS);
    if (!ready.length) return;
    const race: RaceInfo<C> = {
      rid: `${rid4()}${rid4()}`,
      ids: ready.map((p) => p.id),
      players: Object.fromEntries(ready.map((p) => [p.id, { name: p.name, vehicle: p.vehicle, team: p.team }])),
      cfg: this.cfg,
    };
    this.room.broadcast('go', race);
    this.lastCount = -2;
    this.readySince = 0;
    this.begin(race);
  }

  private begin(race: RaceInfo<C>) {
    if (this.link.race || race.rid === this.lastRid) return;
    if (!race.ids.includes(this.id)) return; // not on this grid: stay in the lobby
    this.lastRid = race.rid;
    this.link.race = race;
    this.fin.clear();
    this.officialRes = null;
    this.finalSent = false;
    this.firstFinAt = 0;
    this.raceStart = Date.now();
    this.greenAt = 0;
    this.minT = 0;
    this.me.st = 'racing';
    this.me.ready = false;
    this.pushMe();
    this.cb.onCount(null);
    this.cb.onGo(race);
    this.emitStandings(false);
  }

  /** The race is over for me (results closed / left): back to the lobby. */
  endRace() {
    if (this.link.race && !this.fin.has(this.id)) this.myFinish(null);
    this.link.race = null;
    this.me.st = 'lobby';
    this.me.ready = false;
    this.me.paid = false;
    this.pushMe();
  }

  // ── Messages ──

  private onMsg(ev: string, p: unknown) {
    if (this.engineEv.has(ev)) {
      if (this.link.race) this.link.on?.(ev, p);
      return;
    }
    const d = p as Record<string, unknown>;
    if (ev === 'go') {
      const r = d as unknown as RaceInfo<C>;
      if (r && Array.isArray(r.ids) && r.ids.length <= MAX_PLAYERS && typeof r.rid === 'string' && r.players && this.o.validateCfg(r.cfg)) this.begin(r);
    } else if (ev === 'cfg') {
      const c = this.o.validateCfg(d);
      if (!this.quick && c) {
        this.cfg = c;
        this.cb.onCfg(c);
      }
    } else if (ev === 'lc') {
      const l = (d as { left: number | null }).left;
      if (!this.link.race) this.cb.onCount(typeof l === 'number' ? l : null);
    } else if (ev === 'fin') {
      const f = d as { rid: string; id: string; t: number | null };
      if (!this.link.race || f.rid !== this.link.race.rid || !this.link.race.ids.includes(f.id) || f.id === this.id) return;
      if (this.fin.has(f.id)) return;
      if (f.t !== null && !this.saneFinish(f.t)) return;
      this.fin.set(f.id, { t: f.t });
      if (!this.firstFinAt) this.firstFinAt = Date.now();
      this.checkDone();
      this.emitStandings(false);
    } else if (ev === 'res') {
      const r = d as { rid: string; order: { id: string; t: number | null }[] };
      if (!this.link.race || r.rid !== this.link.race.rid || !Array.isArray(r.order)) return;
      this.officialRes = r.order.slice(0, MAX_PLAYERS);
      this.emitStandings(true);
    }
  }

  /** A finish claim must not be impossibly fast, nor from the future on my clock. */
  private saneFinish(t: number) {
    if (!(t > 0)) return false;
    if (this.minT && t < this.minT) return false;
    if (this.greenAt && t > (performance.now() - this.greenAt) / 1000 + 2) return false;
    return true;
  }

  private myFinish(t: number | null) {
    const race = this.link.race;
    if (!race || this.fin.has(this.id)) return;
    this.fin.set(this.id, { t });
    if (!this.firstFinAt) this.firstFinAt = Date.now();
    const msg = { rid: race.rid, id: this.id, t };
    this.room.broadcast('fin', msg);
    // Broadcast is best-effort: say it again.
    setTimeout(() => this.link.race?.rid === race.rid && this.room.broadcast('fin', msg), 900);
    setTimeout(() => this.link.race?.rid === race.rid && this.room.broadcast('fin', msg), 2400);
    this.checkDone();
    this.emitStandings(false);
  }

  /** Still on the grid: finished, or present in the room and racing. */
  private alive(id: string) {
    return this.fin.has(id) || this.players.some((p) => p.id === id && p.st === 'racing');
  }

  private checkDone() {
    const race = this.link.race;
    if (!race || this.finalSent) return;
    if (Date.now() - this.raceStart < 6000) return; // presence of the others may still be catching up
    const open = race.ids.filter((id) => !this.fin.has(id) && this.alive(id));
    const timedOut = this.firstFinAt > 0 && Date.now() - this.firstFinAt > 35_000;
    if (open.length && !timedOut) {
      this.emitStandings(false);
      return;
    }
    // The first still-present pilot in grid order publishes the official order; the rest adopt it.
    const publisher = race.ids.find((id) => this.alive(id)) ?? this.id;
    if (publisher !== this.id) {
      if (!this.officialRes && Date.now() - (this.firstFinAt || this.raceStart) > 42_000) this.emitStandings(true);
      return;
    }
    this.finalSent = true;
    const order = this.order().map((s) => ({ id: s.id, t: s.t }));
    this.officialRes = order;
    this.room.broadcast('res', { rid: race.rid, order });
    setTimeout(() => this.link.race?.rid === race.rid && this.room.broadcast('res', { rid: race.rid, order }), 1200);
    this.emitStandings(true);
  }

  private order() {
    const race = this.link.race;
    if (!race) return [] as RaceStanding[];
    const rows: RaceStanding[] = race.ids.map((id) => {
      const f = this.fin.get(id);
      return { id, name: race.players[id]?.name ?? 'pilot', team: race.players[id]?.team ?? '', t: f?.t ?? null, dnf: f ? f.t === null : false, me: id === this.id, racing: !f && this.alive(id) };
    });
    rows.sort((a, b) => {
      const ka = a.t !== null ? 0 : a.racing ? 1 : 2;
      const kb = b.t !== null ? 0 : b.racing ? 1 : 2;
      return ka - kb || (a.t ?? 0) - (b.t ?? 0) || (a.id < b.id ? -1 : 1);
    });
    return rows;
  }

  private emitStandings(final: boolean) {
    if (!this.link.race) return;
    let rows = this.order();
    if (this.officialRes) {
      const pos = new Map(this.officialRes.map((o, i) => [o.id, i]));
      const off = new Map(this.officialRes.map((o) => [o.id, o.t]));
      rows = rows
        .map((r) => (off.has(r.id) ? { ...r, t: off.get(r.id) ?? null, dnf: off.get(r.id) === null, racing: false } : r))
        .sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99));
    }
    this.cb.onStandings(rows, final || this.officialRes !== null);
  }

  leave() {
    if (this.left) return;
    this.left = true;
    clearInterval(this.tick);
    this.room.close();
  }
}
