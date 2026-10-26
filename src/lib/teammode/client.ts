/**
 * Browser side of TERRORNODE TEAM MODE: one websocket to the game server (server/terrornode-team), reconnect with
 * back-off and the resume token (kept per match code in sessionStorage, so a reload keeps your slot).
 */
import type { PublicState, Snapshot, Team } from './match';
import type { LevelId } from '../terrornode/levels';

export const TEAM_WS = (process.env.NEXT_PUBLIC_TERRORNODE_TEAM_WS || 'ws://localhost:8787/ws').replace(/\/$/, '');

export type TeamStatus = 'connecting' | 'live' | 'retrying' | 'closed';
type Handlers = {
  onState: (s: PublicState) => void;
  onSnap: (s: Snapshot) => void;
  onWelcome: (you: string) => void;
  onError: (e: string) => void;
  onStatus: (s: TeamStatus) => void;
};

const KEY = (code: string) => `tn-team-resume:${code}`;
const read = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export class TeamClient {
  private ws: WebSocket | null = null;
  private tries = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  you: string | null = null;

  constructor(
    readonly code: string,
    private me: { name: string; identityKey?: string | null; side?: Team | null },
    private h: Handlers,
    /** Spectator: joins read-only ({t:'watch'}), no slot, no wallet, nothing sent but pings. */
    readonly watch = false,
  ) {
    this.open();
  }

  private open() {
    if (this.closed) return;
    this.h.onStatus(this.tries ? 'retrying' : 'connecting');
    const ws = new WebSocket(TEAM_WS);
    this.ws = ws;
    ws.onopen = () => {
      if (this.watch) return ws.send(JSON.stringify({ t: 'watch', match: this.code }));
      ws.send(JSON.stringify({ t: 'join', match: this.code, name: this.me.name, identityKey: this.me.identityKey ?? null, side: this.me.side ?? null, resume: read(KEY(this.code)) }));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.t === 'snap') return this.h.onSnap(m);
      if (m.t === 'state') return this.h.onState(m.state);
      if (m.t === 'watching') {
        this.tries = 0;
        this.h.onStatus('live');
        return this.h.onState(m.state);
      }
      if (m.t === 'welcome') {
        this.tries = 0;
        this.you = m.you;
        write(KEY(this.code), m.resume);
        this.h.onStatus('live');
        this.h.onWelcome(m.you);
        return this.h.onState(m.state);
      }
      if (m.t === 'err') this.h.onError(m.error);
    };
    ws.onclose = () => {
      if (this.closed) return this.h.onStatus('closed');
      this.tries++;
      this.h.onStatus('retrying');
      this.timer = setTimeout(() => this.open(), Math.min(8000, 400 * 2 ** Math.min(this.tries, 5)));
    };
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  move(x: number, z: number, yaw: number) {
    this.send({ t: 'in', x, z, yaw });
  }
  shot(yaw: number) {
    this.send({ t: 'shot', yaw });
  }
  confirmTx(n: number) {
    if (n > 0) this.send({ t: 'tx', n });
  }
  side(side: Team) {
    this.me.side = side;
    this.send({ t: 'side', side });
  }
  start() {
    this.send({ t: 'start' });
  }
  /** The bChatX stream slot (the LiveKit handle GO LIVE returned), or null when the stream stops. */
  live(slot: string | null) {
    this.send({ t: 'live', slot });
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Create a match through the site (same origin; proxied to the game server). */
export async function createTeamMatch(mode: 'coop' | 'pvp', tournamentId?: string | null, level?: LevelId): Promise<{ code: string; id: string; inviteUrl: string | null }> {
  const r = await fetch('/api/terrornode/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, level: level ?? 'assault', tournamentId: tournamentId ?? null }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The team server did not answer.');
  return j;
}
