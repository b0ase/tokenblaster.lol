'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ordnance } from '@/lib/ordnance';
import { gunArtUrl, spinGun } from '@/lib/ordnanceArt';

/**
 * A weapon's art: its image, or a render of its tinted 3D model. With `spin`, hovering (or
 * touching) swaps in the live model, which swivels to follow the pointer.
 */
export function GunArt({ o, className = '', spin = false }: { o: Ordnance; className?: string; spin?: boolean }) {
  const [src, setSrc] = useState<string | null>(o.image ?? null);
  const [live, setLive] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (o.image) return;
    let alive = true;
    gunArtUrl(o).then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [o]);

  useEffect(() => {
    if (!live || !canvas.current) return;
    pointer.current = { x: 0, y: 0 };
    return spinGun(o, canvas.current, pointer.current);
  }, [live, o]);

  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.current.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  };

  const still = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`${o.name} art`} className={className} loading="lazy" />
  ) : (
    <div className={`${className} animate-pulse bg-[var(--active-bg)]`} />
  );
  if (!spin) return still;
  return (
    <div
      ref={box}
      className="relative h-full w-full touch-pan-y"
      // Mouse: live while hovering. Touch/pen: a tap toggles it (touch fires leave right after the tap).
      onPointerEnter={(e) => e.pointerType === 'mouse' && setLive(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setLive(false)}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') return;
        move(e);
        setLive((v) => !v);
      }}
      onPointerMove={move}
    >
      {still}
      {live && <canvas ref={canvas} className="absolute inset-0 h-full w-full" />}
      {!live && <span className="pointer-events-none absolute bottom-2 right-2 bg-black/60 px-1 text-[10px] text-dim"><span className="hidden sm:inline">hover</span><span className="sm:hidden">tap</span> to inspect · 3D</span>}
    </div>
  );
}
