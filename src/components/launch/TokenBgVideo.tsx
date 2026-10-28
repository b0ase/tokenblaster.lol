'use client';

import { useEffect, useState } from 'react';
import { isMobileLite } from '@/lib/mobileLite';
import type { BgVideo } from '@/lib/launch/tokenPage';

/** Poster only on reduced motion, Save-Data and the phone lite tier. */
function stillOnly(): boolean {
  if (typeof window === 'undefined') return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(conn?.saveData) || isMobileLite();
}

/** A token's muted looping background (TOKEN_PAGE_RULES.bgVideo), fixed behind the page under a dark overlay. */
export function TokenBgVideo({ v }: { v: BgVideo }) {
  // Start with the poster (server render and first paint), then switch to the video if allowed.
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!stillOnly());
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return (
    <div className="tb-bgv" aria-hidden data-bg-video={motion ? 'video' : 'poster'}>
      <style>{CSS}</style>
      {motion ? (
        <video autoPlay muted loop playsInline preload="auto" poster={v.poster} disablePictureInPicture>
          <source src={v.webm} type="video/webm" />
          <source src={v.mp4} type="video/mp4" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.poster} alt="" />
      )}
      <div className="tb-bgv-shade" />
    </div>
  );
}

const CSS = `
.tb-bgv{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:#000}
.tb-bgv video,.tb-bgv img{width:100%;height:100%;object-fit:cover;filter:saturate(1.15)}
.tb-bgv-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,5,8,.42) 0%,rgba(5,5,8,.62) 45%,rgba(5,5,8,.85) 100%)}
`;
