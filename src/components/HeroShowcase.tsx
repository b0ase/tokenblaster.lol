'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * The home hero's cycling showcase of the flagship games: full-colour frames, a Ken Burns push, a chevron wipe with
 * a scanline glitch every ~4.6s, a product code and PLAY button per slide, clickable progress ticks. The tick fill's
 * CSS animation drives the advance (onAnimationEnd), so reduced motion (animations off) simply holds the frame.
 * Frames are the arcade cards in public/arcade: swap the hell-forge Arena card in when it lands.
 */
const SLIDES = [
  { href: '/arcade/bracer', img: '/arcade/bracer.jpg', title: 'bRacer', tag: 'Anti-gravity racer', kana: '反重力レース' },
  { href: '/arena', img: '/arcade/arena.jpg', title: 'Arena', tag: 'Hell-forge shooter', kana: 'アリーナ' },
  { href: '/arcade/doubleosatoshi', img: '/arcade/doubleo.jpg', title: 'Double-O Satoshi', tag: 'Spy shooter', kana: 'スパイ作戦' },
  { href: '/arcade/rally', img: '/arcade/rally.jpg', title: 'Token Rally', tag: '3D rally', kana: 'ラリー' },
  { href: '/arcade/city', img: '/arcade/city.jpg', title: 'Satoshi City', tag: 'Open-world city', kana: 'サトシ市' },
] as const;

const KB = [
  ['-1.5%', '-1%'],
  ['1.5%', '-1%'],
  ['-1%', '1.2%'],
  ['1.2%', '1%'],
  ['-1.5%', '0.5%'],
];

export function HeroShowcase() {
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState(-1);
  const [first, setFirst] = useState(true);
  const [hold, setHold] = useState(false);
  const go = (n: number) => {
    const to = (n + SLIDES.length) % SLIDES.length;
    if (to === i) return;
    setPrev(i);
    setI(to);
    setFirst(false);
  };
  const s = SLIDES[i];

  return (
    <>
      {/* Full-bleed art, behind the headline (the hero supplies the scrim). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[330px] overflow-hidden bg-black lg:inset-0 lg:h-auto" aria-hidden>
        {SLIDES.map((x, n) => (
          <div key={x.href} className="dr-slide" data-active={n === i} data-prev={n === prev && n !== i} data-first={first && n === i} style={{ ['--kx' as string]: KB[n][0], ['--ky' as string]: KB[n][1] }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.img} alt="" loading={n === 0 ? 'eager' : 'lazy'} fetchPriority={n === 0 ? 'high' : 'auto'} decoding="async" className="object-[70%_center]" />
          </div>
        ))}
        {!first && <div key={i} className="dr-glitch" />}
      </div>

      {/* Corner label: code, title, katakana, PLAY, clickable progress ticks. */}
      <div
        className="absolute right-2 top-2 z-20 w-[min(300px,calc(100%-1rem))] border-2 border-[var(--hot)] bg-[var(--panel)] shadow-[5px_5px_0_var(--accent-fill)] lg:bottom-16 lg:right-5 lg:top-auto lg:w-[320px]"
        onMouseEnter={() => setHold(true)}
        onMouseLeave={() => setHold(false)}
        onFocus={() => setHold(true)}
        onBlur={() => setHold(false)}
        role="region"
        aria-roledescription="carousel"
        aria-label="Flagship games"
      >
        <div className="dr-hazard !h-1.5" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-2.5 py-2" aria-live={hold ? 'polite' : 'off'}>
          <div className="min-w-0">
            <p className="dr-code !text-[var(--accent)]">
              {String(i + 1).padStart(2, '0')}/{String(SLIDES.length).padStart(2, '0')} · TB-F{String(i + 1).padStart(2, '0')}
            </p>
            <p className="dr-display overflow-hidden text-ellipsis whitespace-nowrap text-[22px] text-hot sm:text-[26px]">{s.title}</p>
            <p className="dr-kana text-[10px] text-[var(--muted)]" aria-hidden>
              {s.kana}
            </p>
          </div>
          <Link href={s.href} className="btn-fire inline-flex shrink-0 items-center !px-3 !py-1.5 !text-lg">
            Play <span aria-hidden>&nbsp;▶</span>
          </Link>
        </div>
        <div className="flex gap-1 px-2.5 pb-1.5" role="group" aria-label="Choose a game">
          {SLIDES.map((x, n) => (
            <button key={x.href} type="button" onClick={() => go(n)} aria-label={`Show ${x.title}`} aria-current={n === i} className="group relative h-6 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--border-dim)] transition-all group-hover:h-2.5" />
              {n < i && <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--text)] opacity-60 transition-all group-hover:h-2.5" />}
              {n === i && (
                <span
                  key={`${i}-${prev}`}
                  className="dr-fill absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-[var(--accent-fill)] transition-[height] group-hover:h-2.5"
                  style={{ animationPlayState: hold ? 'paused' : 'running' }}
                  onAnimationEnd={() => go(i + 1)}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
