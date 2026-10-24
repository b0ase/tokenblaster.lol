import { GameShell } from '@/components/GameShell';
import { ShootingGallery } from '@/components/gallery/ShootingGallery';

const description =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo against the nSLAVE tower and its liquid-metal robot: every bullet is a real BSV transaction from your own wallet. Free play while we finish the coin-op.';
export const metadata = {
  title: '31 Oct BSV Stress Test · TokenBlaster Shooting Gallery',
  description,
  openGraph: { title: 'TokenBlaster Shooting Gallery: fire a million transactions', description, url: '/arcade/gallery' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Shooting Gallery', description },
};

// FREE PLAY on production while the payment flow is fixed (owner, 24 Oct 2026: "keep it online but let everyone
// play for free"): the game runs on the simulated network, no wallet, nothing paid or broadcast. Real payments
// come back with NEXT_PUBLIC_GALLERY_PAID=1 (and always run on a local dev server).
const PAID = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_GALLERY_PAID === '1';

export default function GalleryPage() {
  return (
    <GameShell
      title="31 Oct Stress Test · Shooting Gallery"
      below={
        <p className="panel text-dim">
          Neo-Tokyo, 2048. THE GUNNER brings a minigun to nSLAVE: shoot out the windows, the server floor and the drones, and keep the LIQUID UNIT down. It
          reforms the moment you let up. In LIVE every round is a real tagged BSV transaction (&quot;tokenblaster.lol&quot; … &quot;gallery&quot;), signed in your browser from a gun your
          wallet funds, so you can watch them land on bsv.lol.
        </p>
      }
    >
      <ShootingGallery freePlay={!PAID} />
    </GameShell>
  );
}
