'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { newRoomCode } from '@/lib/doubleo/mp';

/** Hero gameplay loop: poster only under reduced motion or Save-Data, otherwise a muted looping capture (practice mode). */
export function HeroLoop({ vid, poster }: { vid: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || conn?.saveData) {
      v.pause();
      return;
    }
    void v.play().catch(() => undefined);
  }, []);
  return (
    <video ref={ref} className="absolute inset-0 h-full w-full object-cover" poster={poster} muted loop playsInline preload="metadata" aria-hidden>
      <source src={`${vid}-720.mp4`} media="(max-width: 900px)" type="video/mp4" />
      <source src={`${vid}.mp4`} type="video/mp4" />
    </video>
  );
}

/** "Start a private room": mints a fresh code and opens the game on ?room=CODE (the game joins that private room on load). */
export function PrivateRoomButton({ href, extra = '', label = 'Start a private room', className = '' }: { href: string; extra?: string; label?: string; className?: string }) {
  const router = useRouter();
  return (
    <button type="button" className={className} data-private-room={href} onClick={() => router.push(`${href}?room=${newRoomCode()}${extra}`)}>
      {label}
    </button>
  );
}
