'use client';
/**
 * TERRORNODE's demo (taste) mode, owner 28 Oct 2026. The gallery has its own cabinet (no CoinOpGate), so the
 * demo reuses its simulated network run (nothing paid, signed or broadcast, not scored) under the shared
 * INSERT $b banner (src/components/coinop/DemoOverlay.tsx). One tap on the banner goes back to the paid cabinet.
 */
import { useState } from 'react';
import { DemoButton, DemoOverlay } from '@/components/coinop/DemoOverlay';
import { ShootingGallery } from './ShootingGallery';

export function GalleryDemo({ paid }: { paid: boolean }) {
  const [demo, setDemo] = useState(0);
  if (!paid) return <ShootingGallery freePlay />;
  if (demo > 0)
    return (
      <div key={demo} className="relative" data-demo-run>
        <ShootingGallery freePlay />
        <DemoOverlay onInsert={() => setDemo(0)} />
      </div>
    );
  return (
    <div className="relative">
      <ShootingGallery />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center">
        <span className="pointer-events-auto rounded-full bg-black/70">
          <DemoButton onDemo={() => setDemo((n) => n + 1)} />
        </span>
      </div>
    </div>
  );
}
