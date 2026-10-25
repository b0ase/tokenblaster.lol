import { GameShell } from '@/components/GameShell';
import { ShootingGallery } from '@/components/gallery/ShootingGallery';
import { TERRORNODE_CARD, shareImages } from '@/lib/og';

const description =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo against the Erobots holding TERRORNODE HQ: every bullet is a real BSV transaction from your own wallet in paid play.';
// The share card never mentions free play or prizes: those change, the card is cached by X/Discord/Telegram.
const shareDescription =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo against the Erobots holding TERRORNODE HQ: every bullet is a real BSV transaction from your own wallet.';
export const metadata = {
  title: '31 Oct BSV Stress Test · Assault on Terrornode',
  description,
  openGraph: { title: 'Assault on Terrornode: fire a million transactions', description: shareDescription, url: '/arcade/terrornode', images: shareImages(TERRORNODE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster: Assault on Terrornode', description: shareDescription, images: shareImages(TERRORNODE_CARD).twitter },
};

// FREE PLAY on production while the payment flow is fixed (owner, 24 Oct 2026: "keep it online but let everyone
// play for free"): the game runs on the simulated network, no wallet, nothing paid or broadcast. Real payments
// come back with NEXT_PUBLIC_GALLERY_PAID=1 (and always run on a local dev server).
const PAID = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_GALLERY_PAID === '1';

export default function GalleryPage() {
  return (
    <GameShell
      title="31 Oct Stress Test · Assault on Terrornode"
      lock
    >
      <ShootingGallery freePlay={!PAID} />
    </GameShell>
  );
}
