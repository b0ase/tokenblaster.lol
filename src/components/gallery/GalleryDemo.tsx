'use client';
/**
 * TERRORNODE's demo (taste) mode. The gallery has its own cabinet (no CoinOpGate), so the demo reuses its
 * simulated network run (nothing paid, signed or broadcast, not scored) with the shared friendly DemoOverlay
 * (src/components/coinop/DemoOverlay.tsx): a quiet "DEMO · 14s" chip that starts when the run goes live, then the
 * engine's own pause and a calm end panel over the stage. Play for real / Close go back to the paid cabinet.
 */
import { useCallback, useState } from 'react';
import { DemoButton, DemoOverlay, focusCabinetStart } from '@/components/coinop/DemoOverlay';
import { ShootingGallery } from './ShootingGallery';
import { CreditSafeBoundary } from '@/components/coinop/CreditSafeFallback';

export function GalleryDemo({ paid }: { paid: boolean }) {
  const [demo, setDemo] = useState(0);
  const [live, setLive] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const onLive = useCallback(() => setLive(true), []);
  const start = () => {
    setLive(false);
    setFrozen(false);
    setDemo((n) => n + 1);
  };
  const leave = (forReal: boolean) => {
    setDemo(0);
    setLive(false);
    setFrozen(false);
    if (forReal) focusCabinetStart();
  };
  if (!paid) return <ShootingGallery freePlay />;
  if (demo > 0)
    return (
      <div key={demo} className="relative" data-demo-run>
        <ShootingGallery freePlay demo={{ onLive, frozen }} />
        <DemoOverlay started={live} onOver={() => setFrozen(true)} onPlayForReal={() => leave(true)} onAgain={start} onClose={() => leave(false)} />
      </div>
    );
  return (
    <div className="relative">
      {/* A crash after a paid load shows the credit with PLAY / UNLOAD, never a dead screen (31 Oct 2026). */}
      <CreditSafeBoundary>
        {/* In the start card, not floating over the stage: on phones the music bar covered it (31 Oct 2026). */}
        <ShootingGallery startExtra={<DemoButton onDemo={start} />} />
      </CreditSafeBoundary>
    </div>
  );
}
