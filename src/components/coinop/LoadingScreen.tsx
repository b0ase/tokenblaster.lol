'use client';
/**
 * Full-screen ILLUSTRATED loading screen for the coin-op shooting games, in the style of ZX Spectrum / Amiga /
 * arcade loaders (owner, 24 Oct 2026). Reusable: pass the key art, your own story cards (each with a crop of
 * the art) and tips.
 *
 *  - Key art fills the screen, pixelated and dithered (ordered Bayer, small palette) on a canvas once, with a
 *    slow Ken Burns pan. It "paints in" line by line as the load progresses, tape-loader stripes below the line.
 *  - One comic-strip panel per story card: a crop of the art plus a bold boxed caption.
 *  - Tips in a HINT box. A big title lockup on top. A thin colour-bar border.
 *  - A big ammo-belt progress bar that fills with bullets, the status in plain words underneath.
 *  - A chiptune loop (src/lib/coinop/chiptune.ts) that respects the mute button.
 *
 * Plain words only (owner's rule): no technical terms. Transaction ids stay in the ON CHAIN panel.
 */
import { useEffect, useMemo, useState } from 'react';
import { DR } from '@/lib/dr/tokens';
import { startChiptune, stopChiptune } from '@/lib/coinop/chiptune';

/** A crop of the key art: centre (0..1 of width/height) and zoom (1 = the whole picture). */
export type Crop = { x: number; y: number; zoom: number };
export type StoryCard = { title: string; line: string; crop?: Crop };
export type LoadState =
  | { kind: 'approve' }
  | { kind: 'paid' }
  | { kind: 'loading'; pct: number; slowSecs: number }
  | { kind: 'ready' }
  | { kind: 'failed'; text: string };

const BORDER = ['#e8261d', '#00e5ff', '#ffd400', '#ff2fd0', '#39ff14', '#2d5bff'];
// A small 16-colour palette (Amiga-ish night tones + the house reds and ambers).
const PALETTE = [
  [8, 10, 22], [22, 28, 54], [38, 52, 96], [70, 92, 150], [120, 150, 200], [200, 214, 236], [255, 255, 255],
  [40, 30, 40], [90, 70, 80], [150, 130, 120], [232, 38, 29], [255, 120, 60], [245, 184, 0], [255, 220, 140], [150, 170, 190], [60, 64, 72],
];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The art, scaled down to `w` pixels wide, ordered-dithered to PALETTE: a data URL (drawn once). */
function useDithered(src: string, w: number, crop?: Crop) {
  const [url, setUrl] = useState<string | null>(null);
  const cx = crop?.x ?? 0.5;
  const cy = crop?.y ?? 0.5;
  const zoom = crop?.zoom ?? 1;
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const sw = img.width / zoom;
      const sh = img.height / zoom;
      const sx = Math.max(0, Math.min(img.width - sw, cx * img.width - sw / 2));
      const sy = Math.max(0, Math.min(img.height - sh, cy * img.height - sh / 2));
      const h = Math.round((w * sh) / sw);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) return;
      g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      const px = d.data;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const t = (BAYER[y & 3][x & 3] / 16 - 0.5) * 48;
          let best = 0;
          let bd = Infinity;
          for (let k = 0; k < PALETTE.length; k++) {
            const p = PALETTE[k];
            const dr = px[i] + t - p[0];
            const dg = px[i + 1] + t - p[1];
            const db = px[i + 2] + t - p[2];
            const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            if (dd < bd) {
              bd = dd;
              best = k;
            }
          }
          px[i] = PALETTE[best][0];
          px[i + 1] = PALETTE[best][1];
          px[i + 2] = PALETTE[best][2];
        }
      g.putImageData(d, 0, 0);
      setUrl(c.toDataURL());
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src, w, cx, cy, zoom]);
  return url;
}

function statusText(s: LoadState) {
  switch (s.kind) {
    case 'approve':
      return 'Waiting for you to approve in your wallet…';
    case 'paid':
      return 'Payment received.';
    case 'loading':
      return s.slowSecs > 0 ? `Still loading. The network is busy, hang on… ${s.slowSecs}s` : `Loading your gun… ${Math.round(s.pct)}%`;
    case 'ready':
      return 'GUN LOADED. PRESS FIRE';
    case 'failed':
      return s.text;
  }
}
const pctOf = (s: LoadState) => (s.kind === 'approve' ? 4 : s.kind === 'paid' ? 10 : s.kind === 'loading' ? Math.max(10, s.pct) : s.kind === 'ready' ? 100 : 0);

const BULLETS = 24;

/** The ammo belt: brass rounds clipped into a canvas belt, filling left to right. */
function AmmoBelt({ pct, failed }: { pct: number; failed: boolean }) {
  const n = Math.round((pct / 100) * BULLETS);
  return (
    <div className="flex w-full items-end gap-[2px] border-[3px] border-black bg-[#3b2f1c] px-1.5 pt-1.5 shadow-[0_0_0_2px_#c9a24a]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: BULLETS }, (_, i) => (
        <svg key={i} viewBox="0 0 10 30" className="h-[clamp(30px,6vw,56px)] flex-1" preserveAspectRatio="none" aria-hidden>
          <rect x="0" y="22" width="10" height="8" fill="#1d160c" />
          {i < n && (
            <>
              <path d="M2 10 Q5 0 8 10 Z" fill={failed ? '#6b3a2a' : '#d9773d'} />
              <rect x="2" y="10" width="6" height="14" fill={failed ? '#6b5a2a' : '#e3b341'} />
              <rect x="2.6" y="10" width="1.4" height="14" fill="#fff2b0" opacity="0.6" />
              <rect x="1.5" y="23" width="7" height="2" fill="#9a6f1c" />
            </>
          )}
        </svg>
      ))}
    </div>
  );
}

export function LoadingScreen({
  title,
  kicker = 'TOKENBLASTER',
  art,
  artCrop,
  story,
  tips,
  state,
  onFire,
  music = true,
}: {
  title: string;
  kicker?: string;
  /** Key art (e.g. /gallery/share.jpg). */
  art: string;
  /** Crop of the key art for the full-screen backdrop (keep it clear of any lettering in the art). */
  artCrop?: Crop;
  story: StoryCard[];
  tips: string[];
  state: LoadState;
  onFire?: () => void;
  music?: boolean;
}) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [tick, setTick] = useState(0);
  const card = story[i % Math.max(1, story.length)];
  const tip = tips[i % Math.max(1, tips.length)];
  const bg = useDithered(art, 320, artCrop);
  const panel = useDithered(art, 220, card?.crop);

  useEffect(() => {
    const t = setInterval(() => {
      setI((n) => n + 1);
      setTyped(0);
    }, 5200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTyped((n) => n + 1), 26);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 110);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!music) return;
    startChiptune();
    return () => stopChiptune();
  }, [music]);
  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'failed') stopChiptune();
  }, [state.kind]);

  const failed = state.kind === 'failed';
  const ready = state.kind === 'ready';
  const pct = pctOf(state);
  // Thin cassette-loader border: colour bars that roll while loading.
  const border = useMemo(() => {
    if (failed) return '#5a0c08';
    if (ready) return '#0d4a16';
    const bars = Array.from({ length: 12 }, (_, k) => BORDER[(k + tick) % BORDER.length]);
    return `repeating-linear-gradient(0deg, ${bars.map((c, k) => `${c} ${k * 4}px ${(k + 1) * 4}px`).join(',')})`;
  }, [tick, failed, ready]);
  // Tape-loader stripes in the part of the picture not loaded yet.
  const stripes = `repeating-linear-gradient(0deg, ${BORDER[tick % 6]} 0 3px, #000 3px 7px, ${BORDER[(tick + 2) % 6]} 7px 9px, #000 9px 14px)`;

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden p-[6px] sm:p-[10px]" style={{ background: border, fontFamily: DR.font.mono }} role="status" aria-live="polite" data-loading-screen>
      <div className="relative h-full w-full overflow-hidden bg-black">
        {/* Key art: dithered, slow Ken Burns pan, painting in line by line with the progress. */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="lsr-kenburns absolute inset-[-6%]">
            {bg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bg} alt="" className="h-full w-full object-cover" style={{ imageRendering: 'pixelated', clipPath: `inset(0 0 ${100 - pct}% 0)` }} />
            )}
            <div className="absolute inset-x-0 bottom-0" style={{ top: `${pct}%`, background: stripes, opacity: 0.85 }} />
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px)' }} />
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.75))' }} />
        </div>

        <div className="relative flex h-full flex-col gap-[clamp(8px,1.6vh,18px)] p-[clamp(10px,2.4vw,28px)]">
          {/* Title lockup */}
          <header className="text-center">
            <p className="text-[clamp(12px,1.8vw,20px)] font-black tracking-[0.5em]" style={{ color: DR.colour.amber, textShadow: '3px 3px 0 #000' }}>
              {kicker}
            </p>
            <h1 className="text-[clamp(34px,7.5vw,104px)] font-black uppercase italic leading-[0.86]" style={{ fontFamily: DR.font.display, color: DR.colour.paper, textShadow: `4px 4px 0 ${DR.colour.signal}, 8px 8px 0 #000` }}>
              {title}
            </h1>
          </header>

          {/* Comic panel + HINT */}
          <div className="flex min-h-0 flex-1 flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-end">
            {ready ? (
              <div className="flex flex-1 items-center justify-center">
                <button type="button" data-fs-skip onClick={onFire} className="lock-load px-8 py-5 text-[clamp(30px,6.5vw,80px)] font-black uppercase italic leading-none" style={{ fontFamily: DR.font.display, background: DR.colour.signal, color: DR.colour.paper, border: '5px solid #000', boxShadow: '8px 8px 0 #000' }}>
                  Gun loaded. Press fire
                </button>
              </div>
            ) : failed ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="max-w-[760px] border-[5px] border-black bg-[#ffe7e2] px-5 py-4 text-center text-[clamp(20px,3.2vw,36px)] font-black leading-tight text-[#7a0f08] shadow-[8px_8px_0_#000]">{state.text}</p>
              </div>
            ) : (
              <>
                <figure className="relative flex min-h-0 w-full flex-1 flex-col sm:flex-none border-[5px] border-black bg-black shadow-[8px_8px_0_#000] sm:w-[min(56%,720px)] sm:-rotate-1">
                  <div className="relative min-h-[110px] flex-1 overflow-hidden sm:aspect-video sm:flex-none">
                    {panel && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={panel} alt="" className="lsr-panel absolute inset-0 h-full w-full object-cover" style={{ imageRendering: 'pixelated' }} />
                    )}
                    <span className="absolute left-0 top-0 border-b-[4px] border-r-[4px] border-black px-3 py-1 text-[clamp(14px,2vw,24px)] font-black tracking-[0.15em]" style={{ background: DR.colour.amber, color: '#000', fontFamily: DR.font.display }}>
                      {card?.title}
                    </span>
                  </div>
                  <figcaption className="border-t-[5px] border-black bg-[#fff6d6] px-3 py-2 text-left text-[clamp(16px,2.3vw,28px)] font-black leading-snug text-black">
                    {card?.line.slice(0, typed)}
                    <span style={{ opacity: tick % 6 < 3 ? 1 : 0 }}>▌</span>
                  </figcaption>
                </figure>
                {tip && (
                  <aside className="w-full border-[4px] border-black bg-[#0b1a3a] p-3 text-left shadow-[6px_6px_0_#000] sm:w-[min(32%,380px)] sm:rotate-1">
                    <p className="mb-1 inline-block bg-[#00e5ff] px-2 text-[clamp(14px,1.8vw,20px)] font-black tracking-[0.3em] text-black">HINT</p>
                    <p className="text-[clamp(15px,2vw,24px)] font-bold leading-snug" style={{ color: '#e8f6ff' }}>
                      {tip}
                    </p>
                  </aside>
                )}
              </>
            )}
          </div>

          {/* Ammo belt + plain status */}
          <footer className="mx-auto w-full max-w-[1100px]">
            <AmmoBelt pct={pct} failed={failed} />
            <p className="mt-2 text-center text-[clamp(16px,2.6vw,30px)] font-black" style={{ color: failed ? '#ffb4a8' : DR.colour.paper, textShadow: '3px 3px 0 #000' }} data-load-status>
              {statusText(state)}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
