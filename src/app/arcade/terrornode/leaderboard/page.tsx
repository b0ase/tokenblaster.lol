import { AssaultInfo } from '@/components/gallery/AssaultInfo';
import { GALLERY_PAID } from '@/lib/devFlags';

export const metadata = {
  title: 'Top blasters · Welcome to TERRORNODE',
  description: 'The 31 Oct BSV stress test board, the prize and rules, and where to watch the rounds land.',
};

// Paid play always in production; NEXT_PUBLIC_GALLERY_PAID=0 is dev-only (src/lib/devFlags.ts).
const PAID = GALLERY_PAID;

export default function AssaultLeaderboardPage() {
  return <AssaultInfo paid={PAID} />;
}
