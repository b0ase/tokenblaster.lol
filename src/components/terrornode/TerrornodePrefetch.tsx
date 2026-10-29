'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { loadShootingGallery } from './LazyShootingGallery';

const HREF = '/arcade/terrornode';

/**
 * Warms TERRORNODE from the home page (29 Oct audit: 15.6 s cold from the home click): the route on hover or
 * touchstart of any link to it, and the engine chunk once the browser is idle. Renders nothing.
 */
export function TerrornodePrefetch() {
  const router = useRouter();
  useEffect(() => {
    let done = false;
    const warm = () => {
      if (done) return;
      done = true;
      router.prefetch(HREF);
    };
    const onPoint = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(`a[href="${HREF}"]`)) warm();
    };
    document.addEventListener('pointerover', onPoint, { passive: true });
    document.addEventListener('touchstart', onPoint, { passive: true });
    const idle = () => void loadShootingGallery().catch(() => undefined);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(idle, { timeout: 4000 }) : window.setTimeout(idle, 2500);
    return () => {
      document.removeEventListener('pointerover', onPoint);
      document.removeEventListener('touchstart', onPoint);
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, [router]);
  return null;
}
