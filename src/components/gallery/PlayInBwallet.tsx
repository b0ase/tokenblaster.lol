'use client';

import { useEffect, useState } from 'react';
import { detectPhone, openInBwalletBrowserUrl, showPlayInBwallet, TERRORNODE_URL } from '@/lib/pair/phoneUi';

/** True in a phone browser that is not bWallet's in-app browser (client only, after mount). */
export function usePlayInBwallet(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setShow(showPlayInBwallet(navigator.userAgent, detectPhone())));
  }, []);
  return show;
}

export function PlayInBwalletButton({ className = '' }: { className?: string }) {
  return (
    <a
      href={openInBwalletBrowserUrl(TERRORNODE_URL)}
      className={`lock-load flex min-h-[72px] w-full items-center justify-center rounded-lg bg-[var(--tbx-red)] px-8 py-2 text-center text-2xl font-black tracking-[0.1em] text-white sm:w-auto ${className}`}
      data-play-in-bwallet
    >
      ▶ Play in bWallet (full screen)
    </a>
  );
}
