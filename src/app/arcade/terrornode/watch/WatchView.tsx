'use client';
import { useSyncExternalStore } from 'react';
import { Spectator } from '@/components/terrornode/Spectator';
import { roomFrom } from '@/lib/terrornode/spectate';

const noop = () => () => undefined;
const search = () => location.search;

export function WatchView() {
  const q = useSyncExternalStore(noop, search, () => null);
  if (q === null) return <div className="fixed inset-0 z-[100] bg-[#05060f]" />;
  const params = new URLSearchParams(q);
  const room = roomFrom(params);
  if (!room)
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-[#05060f] p-6 text-center text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#ff2a46]">Welcome to TERRORNODE · Spectator</p>
          <h1 className="mt-2 text-3xl font-black">Add the room code</h1>
          <p className="mt-2 text-sm text-white/70">
            Open <span className="font-mono">/arcade/terrornode/watch?room=CODE</span> with the 5-letter match code from the team lobby.
          </p>
        </div>
      </div>
    );
  return <Spectator room={room} hudOnly={params.get('hud') === 'only'} />;
}
