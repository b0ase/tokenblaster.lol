import { GameShell } from '@/components/GameShell';
import { GALLERY_PAID } from '@/lib/devFlags';
import { ModeSwitch } from '@/components/terrornode/ModeSwitch';
import { TeamMode } from '@/components/terrornode/TeamMode';
import { TERRORNODE_CARD, shareImages } from '@/lib/og';

const description = 'TERRORNODE team mode: up to 16 players on the Neo-Tokyo street. Co-op squads against the Erobotz horde, or NPG vs Erobotz 8 v 8. Every bullet is a real BSV transaction.';
export const metadata = {
  title: 'Team mode · Welcome to TERRORNODE',
  description,
  openGraph: { title: 'Welcome to TERRORNODE: team mode', description, url: '/arcade/terrornode/team', images: shareImages(TERRORNODE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster: TERRORNODE team mode', description, images: shareImages(TERRORNODE_CARD).twitter },
};

// Paid play always in production; NEXT_PUBLIC_GALLERY_PAID=0 is dev-only (src/lib/devFlags.ts).
const PAID = GALLERY_PAID;

export default function TeamPage() {
  return (
    <GameShell title="Welcome to TERRORNODE · Team" lock liveTicker="TERRORNODE" back="/arcade/terrornode" backLabel="SOLO" tabs={<ModeSwitch active="team" />}>
      <TeamMode freePlay={!PAID} />
    </GameShell>
  );
}
