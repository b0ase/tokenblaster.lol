import { GameShell } from '@/components/GameShell';
import { ModeSwitch } from '@/components/terrornode/ModeSwitch';
import { TeamMode } from '@/components/terrornode/TeamMode';
import { TERRORNODE_CARD, shareImages } from '@/lib/og';

const description = 'TERRORNODE team mode: up to 16 players on the Neo-Tokyo street. Co-op squads against the Erobot horde, or NPG vs Erobotz 8 v 8. Every bullet is a real BSV transaction.';
export const metadata = {
  title: 'Team mode · Escape from TERRORNODE',
  description,
  openGraph: { title: 'Escape from TERRORNODE: team mode', description, url: '/arcade/terrornode/team', images: shareImages(TERRORNODE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster: TERRORNODE team mode', description, images: shareImages(TERRORNODE_CARD).twitter },
};

// Same switch as solo: paid by default, NEXT_PUBLIC_GALLERY_PAID=0 is free play.
const PAID = process.env.NEXT_PUBLIC_GALLERY_PAID !== '0';

export default function TeamPage() {
  return (
    <GameShell title="Escape from TERRORNODE · Team" lock liveTicker="TERRORNODE" back="/arcade/terrornode" backLabel="SOLO" tabs={<ModeSwitch active="team" />}>
      <TeamMode freePlay={!PAID} />
    </GameShell>
  );
}
