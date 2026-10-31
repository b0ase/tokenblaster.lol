'use client';
/**
 * TERRORNODE's cabinet wrapper. The "Try a 20 s demo" button is gone (owner, 31 Oct 2026): paid play only.
 */
import { ShootingGallery } from './ShootingGallery';
import { CreditSafeBoundary } from '@/components/coinop/CreditSafeFallback';

export function GalleryDemo({ paid }: { paid: boolean }) {
  if (!paid) return <ShootingGallery freePlay />;
  return (
    <div className="relative">
      {/* A crash after a paid load shows the credit with PLAY / UNLOAD, never a dead screen (31 Oct 2026). */}
      <CreditSafeBoundary>
        <ShootingGallery />
      </CreditSafeBoundary>
    </div>
  );
}
