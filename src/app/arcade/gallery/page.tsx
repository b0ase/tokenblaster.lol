import { GameShell } from '@/components/GameShell';
import { ShootingGallery } from '@/components/gallery/ShootingGallery';

const description =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo against the OMNICORE DYNAMICS tower and its liquid-metal robot: every bullet is a real BSV transaction from your own wallet. Free practice, or LIVE packs from about $0.05.';
export const metadata = {
  title: '31 Oct BSV Stress Test · TokenBlaster Shooting Gallery',
  description,
  openGraph: { title: 'TokenBlaster Shooting Gallery: fire a million transactions', description, url: '/arcade/gallery' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Shooting Gallery', description },
};

export default function GalleryPage() {
  return (
    <GameShell
      title="31 Oct Stress Test · Shooting Gallery"
      below={
        <p className="panel text-dim">
          Neo-Tokyo, 2048. THE GUNNER brings a minigun to OMNICORE DYNAMICS: shoot out the windows, the server floor and the drones, and keep the LIQUID UNIT down. It
          reforms the moment you let up. In LIVE every round is a real tagged BSV transaction (&quot;tokenblaster.lol&quot; … &quot;gallery&quot;), signed in your browser from a gun your
          wallet funds, so you can watch them land on bsv.lol.
        </p>
      }
    >
      <ShootingGallery />
    </GameShell>
  );
}
