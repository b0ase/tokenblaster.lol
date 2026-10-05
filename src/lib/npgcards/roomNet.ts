import { Room, realtimeConfigured } from '@/lib/realtime';
import type { NetFactory, NetStatus } from './net';

/** NPG Card Battle online play over the site's Supabase Realtime room (broadcast + presence). */
export const roomNet: NetFactory | null = realtimeConfigured()
  ? (topic, myId, h) => {
      // Room reports 'live' on every ok reply (each broadcast gets one); pass on only the changes,
      // or every hello would trigger another hello.
      let last: NetStatus | null = null;
      const r = new Room(topic, myId, {
        onBroadcast: (event, payload) => h.onMsg(event, payload),
        onPresence: (state) => h.onPeers(Object.keys(state)),
        onStatus: (s) => {
          if (s === last) return;
          last = s;
          h.onStatus(s);
        },
      });
      r.track({ id: myId });
      return { send: (ev, data) => r.broadcast(ev, data), close: () => r.close() };
    }
  : null;
