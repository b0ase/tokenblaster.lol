/**
 * A tiny Supabase Realtime (Phoenix channels) client: one channel, broadcast + presence, heartbeat,
 * reconnect. Enough for the arena's multiplayer without pulling in supabase-js.
 */
const URL_ = process.env.NEXT_PUBLIC_REALTIME_URL ?? '';
const KEY = process.env.NEXT_PUBLIC_REALTIME_KEY ?? '';

export const realtimeConfigured = () => Boolean(URL_ && KEY);

type Handlers = {
  onBroadcast: (event: string, payload: unknown) => void;
  onPresence?: (state: Record<string, unknown[]>) => void;
  onStatus?: (s: 'connecting' | 'live' | 'off') => void;
};

export class Room {
  private ws: WebSocket | null = null;
  private ref = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private presence: Record<string, unknown[]> = {};
  private me: Record<string, unknown> | null = null;
  private joinRef = '';

  constructor(
    private topic: string,
    private key: string,
    private h: Handlers,
  ) {
    this.open();
  }

  private send(event: string, payload: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ topic: `realtime:${this.topic}`, event, payload, ref: String(++this.ref) }));
  }

  private open() {
    if (this.closed || !realtimeConfigured()) return this.h.onStatus?.('off');
    this.h.onStatus?.('connecting');
    const ws = new WebSocket(`${URL_}?apikey=${encodeURIComponent(KEY)}&vsn=1.0.0`);
    this.ws = ws;
    ws.onopen = () => {
      this.send('phx_join', { config: { broadcast: { self: false }, presence: { key: this.key } }, access_token: KEY });
      this.joinRef = String(this.ref);
      this.beat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) })), 25_000);
    };
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data as string) as { event: string; ref?: string | null; payload: { event?: string; payload?: unknown; status?: string; joins?: Record<string, { metas: unknown[] }>; leaves?: Record<string, { metas: unknown[] }> } & Record<string, { metas: unknown[] }> };
      // Only the join's reply means (re)joined; every broadcast/track also gets an ok reply, and
      // re-tracking on those looped forever (track → ok → track …) and got the socket rate-limited.
      if (d.event === 'phx_reply' && d.payload.status === 'ok' && d.ref === this.joinRef) {
        this.h.onStatus?.('live');
        if (this.me) this.track(this.me);
      } else if (d.event === 'broadcast' && d.payload.event) this.h.onBroadcast(d.payload.event, d.payload.payload);
      else if (d.event === 'presence_state') {
        this.presence = Object.fromEntries(Object.entries(d.payload).map(([k, v]) => [k, (v as { metas: unknown[] }).metas]));
        this.h.onPresence?.(this.presence);
      } else if (d.event === 'presence_diff') {
        // Leaves first: re-tracking with new meta sends a leave (old) and a join (new) for the same key in one diff.
        for (const k of Object.keys(d.payload.leaves ?? {})) delete this.presence[k];
        for (const [k, v] of Object.entries(d.payload.joins ?? {})) this.presence[k] = v.metas;
        this.h.onPresence?.({ ...this.presence });
      }
    };
    ws.onclose = () => {
      if (this.beat) clearInterval(this.beat);
      if (!this.closed) setTimeout(() => this.open(), 2000);
      this.h.onStatus?.(this.closed ? 'off' : 'connecting');
    };
  }

  broadcast(event: string, payload: unknown) {
    this.send('broadcast', { type: 'broadcast', event, payload });
  }

  /** Who you are, for everyone's roster (re-sent after reconnects). */
  track(meta: Record<string, unknown>) {
    this.me = meta;
    this.send('presence', { type: 'presence', event: 'track', payload: meta });
  }

  close() {
    this.closed = true;
    if (this.beat) clearInterval(this.beat);
    this.ws?.close();
  }
}
