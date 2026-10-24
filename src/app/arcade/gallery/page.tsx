import { GameShell } from '@/components/GameShell';
import { ShootingGallery } from '@/components/gallery/ShootingGallery';

const description =
  'Fire a million transactions. Hold the trigger on a minigun in Neo-Tokyo against the nSLAVE tower and its liquid-metal robot: every bullet is a real BSV transaction from your own wallet. Free practice, or LIVE packs from about $0.05.';
export const metadata = {
  title: '31 Oct BSV Stress Test · TokenBlaster Shooting Gallery',
  description,
  openGraph: { title: 'TokenBlaster Shooting Gallery: fire a million transactions', description, url: '/arcade/gallery' },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Shooting Gallery', description },
};

// Closed on production while the payment flow is fixed (owner, 24 Oct 2026: "the game is eating my money").
// It still runs on a local dev server, or anywhere NEXT_PUBLIC_GALLERY_OPEN=1 is set.
const OPEN = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_GALLERY_OPEN === '1';

export default function GalleryPage() {
  if (!OPEN)
    return (
      <GameShell title="Shooting Gallery">
        <div className="panel flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--accent)]">Temporarily closed</p>
          <h1 className="text-[clamp(28px,5vw,48px)] font-black uppercase leading-none">The Shooting Gallery is offline for repairs</h1>
          <p className="max-w-xl text-dim">We&apos;re fixing how coins load the gun. No payments are taken while it&apos;s closed. Any ammo already in your gun stays there and will be usable when it reopens.</p>
        </div>
      </GameShell>
    );
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
      <ShootingGallery />
    </GameShell>
  );
}
