import { GameShell } from '@/components/GameShell';
import { ModeSwitch } from '@/components/terrornode/ModeSwitch';
import { ShootingGallery } from '@/components/gallery/ShootingGallery';
import { TERRORNODE_CARD, shareImages } from '@/lib/og';

const description =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo to storm the node and free Dr Kweg Wong from the Erobotz, then escape from TERRORNODE while he keeps running the wrong way: every bullet is a real BSV transaction from your own wallet in paid play.';
// The share card never mentions free play or prizes: those change, the card is cached by X/Discord/Telegram.
const shareDescription =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo to storm the node and free Dr Kweg Wong from the Erobotz, then escape from TERRORNODE: every bullet is a real BSV transaction from your own wallet.';
export const metadata = {
  title: '31 Oct BSV Stress Test · Welcome to TERRORNODE',
  description,
  openGraph: { title: 'Welcome to TERRORNODE: fire a million transactions', description: shareDescription, url: '/arcade/terrornode', images: shareImages(TERRORNODE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster: Welcome to TERRORNODE', description: shareDescription, images: shareImages(TERRORNODE_CARD).twitter },
};

// FREE PLAY on production while the payment flow is fixed (owner, 24 Oct 2026: "keep it online but let everyone
// play for free"): the game runs on the simulated network, no wallet, nothing paid or broadcast. Real payments
// come back with NEXT_PUBLIC_GALLERY_PAID=1 (and always run on a local dev server).
// Paid play is the default (owner, 25 Oct: LOCK & LOAD = connect and pay). NEXT_PUBLIC_GALLERY_PAID=0 brings free play back.
const PAID = process.env.NEXT_PUBLIC_GALLERY_PAID !== '0';

export default function GalleryPage() {
  return (
    <GameShell
      title="31 Oct Stress Test · Welcome to TERRORNODE"
      lock
      liveTicker="TERRORNODE"
      tabs={<ModeSwitch active="solo" />}
    >
      <ShootingGallery freePlay={!PAID} />
    </GameShell>
  );
}
