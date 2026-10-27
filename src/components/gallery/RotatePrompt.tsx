'use client';

import { useEffect, useState } from 'react';
import { isPhone } from '@/lib/mobileLite';
import { PlayInBwalletButton, usePlayInBwallet } from './PlayInBwallet';

/** Phones in portrait: TERRORNODE plays in landscape, so a full-screen prompt asks for the phone on its side. */
export function RotatePrompt() {
  const [show, setShow] = useState(false);
  const playInBwallet = usePlayInBwallet();
  useEffect(() => {
    if (!isPhone()) return;
    const mq = window.matchMedia('(orientation: portrait)');
    const on = () => setShow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (!show) return null;
  return (
    <div role="alert" className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-5 bg-[#03070c] px-8 text-center" data-rotate-prompt>
      <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden fill="none" stroke="#e8f1f6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="24" width="40" height="24" rx="4" />
        <path d="M40 30v12" stroke="#3fd8e8" />
        <path d="M30 10a20 20 0 0 1 22 18" stroke="#ff3b3b" />
        <path d="M47 25l5 3 3-5" stroke="#ff3b3b" />
      </svg>
      <p className="text-lg font-bold tracking-[0.08em] text-[#e8f1f6]">Turn your phone sideways</p>
      {playInBwallet && <PlayInBwalletButton className="max-w-[320px]" />}
    </div>
  );
}
