import { AssaultInfo } from '@/components/gallery/AssaultInfo';

export const metadata = {
  title: 'Top blasters · Assault on Terrornode',
  description: 'The 31 Oct BSV stress test board, the prize and rules, and where to watch the rounds land.',
};

// Same switch as the game page: free play on production until NEXT_PUBLIC_GALLERY_PAID=1.
// Paid play is the default (owner, 25 Oct: LOCK & LOAD = connect and pay). NEXT_PUBLIC_GALLERY_PAID=0 brings free play back.
const PAID = process.env.NEXT_PUBLIC_GALLERY_PAID !== '0';

export default function AssaultLeaderboardPage() {
  return <AssaultInfo paid={PAID} />;
}
