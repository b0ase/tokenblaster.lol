import { WatchView } from './WatchView';

export const metadata = {
  title: 'Watch · Welcome to TERRORNODE',
  description: 'Spectate a TERRORNODE team match live: all 16 players, the round counter and the transactions a second. No wallet needed.',
  robots: { index: false },
};

/** /arcade/terrornode/watch?room=CODE: the read-only spectator view for the livestream (bChatX Space, OBS). */
export default function WatchPage() {
  return <WatchView />;
}
