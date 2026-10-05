'use client';

import { useEffect, useRef, useState } from 'react';
import { cardPath, type Ordnance } from '@/lib/ordnance';
import { gunArtUrl, spinGun, type LiveGun } from '@/lib/ordnanceArt';

/** Only one card is live at a time (each live card holds a WebGL context). */
let closeOther: (() => void) | null = null;

/**
 * A weapon's art: its image, or a render of its tinted 3D model. With `spin`, hovering (or a tap
 * on touch screens) swaps in the live model, which swivels to follow the pointer; clicking or
 * holding on it fires a demo burst (nothing on chain, no token).
 */
export function GunArt({ o, className = '', spin = false }: { o: Ordnance; className?: string; spin?: boolean }) {
  // Pre-rendered poster card (fast); falls back to rendering in the browser if it's missing.
  const [src, setSrc] = useState<string | null>(o.image ?? cardPath(o));
  const [live, setLive] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const gun = useRef<LiveGun | null>(null);
  const wantFire = useRef(false);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (o.image || !failed) return;
    let alive = true;
    gunArtUrl(o).then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [o, failed]);

  useEffect(() => {
    if (!live || !canvas.current) return;
    pointer.current = { x: 0, y: 0 };
    const g = spinGun(o, canvas.current, pointer.current);
    gun.current = g;
    if (wantFire.current) g.trigger(true);
    const close = () => setLive(false);
    if (closeOther && closeOther !== close) closeOther();
    closeOther = close;
    return () => {
      g.stop();
      gun.current = null;
      if (closeOther === close) closeOther = null;
    };
  }, [live, o]);

  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.current.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  const trigger = (down: boolean) => {
    wantFire.current = down;
    gun.current?.trigger(down);
  };

  const still = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`${o.name} art`} className={className} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div className={`${className} animate-pulse bg-[var(--active-bg)]`} />
  );
  if (!spin) return still;
  return (
    <div
      ref={box}
      className="relative h-full w-full cursor-crosshair touch-pan-y select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)]"
      // Keyboard: focus shows the live model, Space/Enter test-fires (held = burst).
      tabIndex={0}
      role="button"
      aria-label={`${o.name}: 3D view. Press Space or Enter to test-fire (demo only, nothing on chain).`}
      onFocus={() => setLive(true)}
      onBlur={() => {
        trigger(false);
        setLive(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        if (!e.repeat) trigger(true);
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') trigger(false);
      }}
      // Mouse: live while hovering, click/hold fires. Touch/pen: first tap goes live, then tap/hold fires.
      onPointerEnter={(e) => e.pointerType === 'mouse' && setLive(true)}
      onPointerLeave={(e) => {
        trigger(false);
        if (e.pointerType === 'mouse') setLive(false);
      }}
      onPointerDown={(e) => {
        move(e);
        if (e.pointerType !== 'mouse' && !live) return setLive(true);
        trigger(true);
      }}
      onPointerUp={() => trigger(false)}
      onPointerCancel={() => trigger(false)}
      onPointerMove={move}
      onContextMenu={(e) => e.preventDefault()}
    >
      {still}
      {live && <canvas ref={canvas} className="absolute inset-0 h-full w-full" />}
      <span className="pointer-events-none absolute bottom-2 right-2 bg-black/60 px-1 text-[10px] text-dim">
        {live ? (
          <>
            <span className="hidden sm:inline">click / hold to test fire · demo, nothing on chain</span>
            <span className="sm:hidden">tap / hold to fire · demo</span>
          </>
        ) : (
          <>
            <span className="hidden sm:inline">hover</span>
            <span className="sm:hidden">tap</span> to inspect · 3D
          </>
        )}
      </span>
    </div>
  );
}
