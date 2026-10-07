/**
 * Token Snake ARENA networking: a drop-in / drop-out room on src/lib/realtime.ts (Supabase Realtime broadcast +
 * presence, no server of ours). Same lobby shapes as the race games: quick match (public rooms `pub-1`, `pub-2`, ...
 * up to MAX_SNAKES each), or a private room by code (?room=CODE, shareable). Identity (X handle + optional verified
 * proof) rides in presence, exactly like src/lib/racemp/session.ts. Nothing here moves money.
 *
 * Wire events (all broadcast):
 *   p  pose   {i, ts, x, z, a, m, b, s, l, k}  ~12 Hz from the owner of a living snake
 *   d  death  {i, did, l, by, cause, m, pts}   the victim's client says it died (and to whom); pts = corpse orbs
 *   f  claim  {s, g, i} | {c, i}               first eater of food slot s generation g (or corpse orb id c)
 *   g  gens   {g: number[]}                    my food generation table, every few seconds (late joiners converge)
 */
import { readWire, type IdWire } from '@/lib/identity';
import { Room, realtimeConfigured } from '@/lib/realtime';
import { MAX_SNAKES } from './arenaSim';

export type ArenaProfile = { name: string; x?: string; xk?: string; xs?: number[] };
export type ArenaPlayer = ArenaProfile & { id: string; t: number; st: 'play' | 'lobby' };
export type RoomStatus = 'connecting' | 'live' | 'off';

export type ArenaCb = {
  onRoster(players: ArenaPlayer[], full: boolean): void;
  onStatus(s: RoomStatus): void;
  onMsg(ev: string, p: Record<string, unknown>, from: string | null): void;
};

export const arenaAvailable = realtimeConfigured;
export const newCode = () => {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export class ArenaSession {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly topic: string;
  players: ArenaPlayer[] = [];
  status: RoomStatus = 'connecting';
  full = false;
  private room: Room;
  private me: ArenaPlayer;
  private left = false;
  private settled = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private last: Record<string, unknown[]> = {};

  constructor(
    readonly o: { quick: boolean; code: string; pub: number; profile: ArenaProfile },
    private cb: ArenaCb,
  ) {
    this.me = { id: this.id, ...o.profile, st: 'lobby', t: Date.now() };
    this.topic = o.quick ? `tokenblaster-snake-pub-${o.pub}` : `tokenblaster-snake-r-${o.code}`;
    this.room = new Room(this.topic, this.id, {
      onBroadcast: (ev, p) => {
        if (ev !== 'p' && ev !== 'd' && ev !== 'f' && ev !== 'g') return;
        const d = (p ?? {}) as Record<string, unknown>;
        this.cb.onMsg(ev, d, typeof d.i === 'string' ? d.i : null);
      },
      onPresence: (state) => this.onPresence(state),
      onStatus: (s) => {
        this.status = s;
        cb.onStatus(s);
        if (s === 'live') this.push();
      },
    });
    // The first presence_state may never come in an empty room: settle after a beat.
    this.settleTimer = setTimeout(() => {
      this.settled = true;
      if (!this.left) this.onPresence(this.last);
    }, 1500);
  }

  get settledNow() {
    return this.settled;
  }
  private push() {
    this.room.track({ ...this.me, v: 1 });
  }
  setProfile(p: Partial<ArenaProfile>) {
    const m = this.me;
    const sameId = ('x' in p ? p.x === m.x : true) && ('xs' in p ? String(p.xs) === String(m.xs) && p.xk === m.xk : true);
    if ((p.name === undefined || p.name === m.name) && sameId) return;
    if ('x' in p && p.x !== m.x && !('xs' in p)) {
      delete m.xk;
      delete m.xs;
    }
    Object.assign(m, p);
    this.push();
  }
  setState(st: 'play' | 'lobby') {
    if (this.me.st === st) return;
    this.me.st = st;
    this.push();
  }
  send(ev: 'p' | 'd' | 'f' | 'g', payload: Record<string, unknown>) {
    this.room.broadcast(ev, payload);
  }

  private onPresence(state: Record<string, unknown[]>) {
    if (this.left) return;
    this.last = state;
    const list: ArenaPlayer[] = [];
    for (const metas of Object.values(state)) {
      const m = metas[metas.length - 1] as Partial<ArenaPlayer> | undefined;
      if (!m || typeof m.id !== 'string' || m.id === this.id) continue;
      const w: IdWire = readWire(m);
      list.push({ id: m.id, name: String(m.name ?? 'snake').slice(0, 16), ...w, st: m.st === 'play' ? 'play' : 'lobby', t: Number(m.t) || 0 });
    }
    list.push({ ...this.me });
    list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    this.players = list.slice(0, 64);
    this.full = this.settled && list.findIndex((p) => p.id === this.id) >= MAX_SNAKES;
    this.cb.onRoster(this.players, this.full);
  }

  leave() {
    if (this.left) return;
    this.left = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.room.close();
  }
}
