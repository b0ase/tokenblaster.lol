'use client';

import { useEffect, useState } from 'react';
import type { Ordnance } from '@/lib/ordnance';
import { gunArtUrl } from '@/lib/ordnanceArt';

/** A weapon's art: its image, or a render of its tinted 3D model. */
export function GunArt({ o, className = '' }: { o: Ordnance; className?: string }) {
  const [src, setSrc] = useState<string | null>(o.image ?? null);
  useEffect(() => {
    if (o.image) return;
    let live = true;
    gunArtUrl(o).then((u) => live && setSrc(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [o]);
  if (!src) return <div className={`${className} animate-pulse bg-[var(--active-bg)]`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`${o.name} art`} className={className} loading="lazy" />;
}
