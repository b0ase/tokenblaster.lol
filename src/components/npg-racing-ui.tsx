'use client';
/**
 * NPG Racing's HUD and result pieces in the NPG card language: black stat boxes with a thick white bevelled border
 * (the card's stat band), flat cel colours, hazard tape, the graffiti tag only ever white or black.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Item } from '@/lib/hyper/engine';
import { LOGO_FAMILY } from './bracer-logo';

export const NPG = { pink: '#ff2d95', cyan: '#22e6ff', yellow: '#ffd93a', ink: '#0a0a0c', paper: '#ffffff' } as const;

/** The card stat box: black fill, white bevelled border, blocky type. */
export const cardBox: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: NPG.ink,
  color: '#fff',
  border: '3px solid #fff',
  borderRadius: 6,
  boxShadow: 'inset 0 0 0 2px #0a0a0c, inset 0 -3px 0 2px #555, 0 0 0 2px #0a0a0c',
  fontFamily: `${LOGO_FAMILY}, "Arial Black", Impact, sans-serif`,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  padding: '2px 8px',
  lineHeight: 1.1,
  whiteSpace: 'nowrap',
};

export function CardBox({ children, style, className, fill }: { children: ReactNode; style?: CSSProperties; className?: string; fill?: string }) {
  return (
    <span className={className} style={{ ...cardBox, ...(fill ? { background: fill, color: fill === NPG.yellow || fill === NPG.cyan || fill === '#fff' ? NPG.ink : '#fff' } : {}), ...style }}>
      {children}
    </span>
  );
}

/** Label + value pair, like a card's STRENGTH 12 row. */
export function Stat({ label, value, big, fill, refValue }: { label: string; value?: ReactNode; big?: boolean; fill?: string; refValue?: (el: HTMLElement | null) => void }) {
  return (
    <span className="inline-grid gap-1" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
      <CardBox style={{ fontSize: big ? 13 : 10, justifyContent: 'flex-start', padding: big ? '4px 9px' : '2px 7px' }}>{label}</CardBox>
      <CardBox fill={fill} style={{ fontSize: big ? 22 : 15, minWidth: '2.6em', fontVariantNumeric: 'tabular-nums' }}>
        <span ref={refValue}>{value}</span>
      </CardBox>
    </span>
  );
}

/** Pink/black hazard tape. */
export const tape = (colour: string = NPG.pink, h = 8): CSSProperties => ({ height: h, background: `repeating-linear-gradient(-45deg, ${colour} 0 10px, ${NPG.ink} 10px 20px)` });

/** Item pictograms: shuriken, smoke bomb, ramen, EMP. Flat fills with a thick black outline, card-sticker style. */
export function ItemIcon({ item, size = 40 }: { item: Item; size?: number }) {
  const s = { width: size, height: size, display: 'block' } as const;
  const stroke = { stroke: NPG.ink, strokeWidth: 5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  if (item === 'shuriken')
    return (
      <svg viewBox="0 0 64 64" style={s} aria-label="shuriken">
        <path d="M32 4 L38 26 L60 32 L38 38 L32 60 L26 38 L4 32 L26 26 Z" fill="#fff" {...stroke} />
        <circle cx="32" cy="32" r="5" fill={NPG.pink} {...stroke} />
      </svg>
    );
  if (item === 'smoke')
    return (
      <svg viewBox="0 0 64 64" style={s} aria-label="smoke bomb">
        <circle cx="22" cy="38" r="13" fill="#8a8396" {...stroke} />
        <circle cx="40" cy="34" r="15" fill="#b4adc2" {...stroke} />
        <circle cx="30" cy="22" r="11" fill="#d8d2e6" {...stroke} />
        <rect x="26" y="4" width="12" height="8" fill={NPG.pink} {...stroke} />
      </svg>
    );
  if (item === 'ramen')
    return (
      <svg viewBox="0 0 64 64" style={s} aria-label="ramen boost">
        <path d="M6 28 H58 C58 44 50 56 32 56 C14 56 6 44 6 28 Z" fill={NPG.pink} {...stroke} />
        <rect x="10" y="26" width="44" height="7" fill="#fff" {...stroke} />
        <path d="M20 26 C22 16 28 12 34 10 M30 26 C30 16 36 12 44 10" fill="none" stroke={NPG.yellow} strokeWidth="5" strokeLinecap="round" />
        <path d="M14 20 C24 20 28 24 30 26 M40 26 C44 20 50 18 56 20" fill="none" {...stroke} strokeWidth={4} />
      </svg>
    );
  return (
    <svg viewBox="0 0 64 64" style={s} aria-label="EMP">
      <circle cx="32" cy="32" r="26" fill={NPG.cyan} {...stroke} />
      <path d="M36 8 L18 36 H32 L28 56 L46 28 H32 Z" fill={NPG.yellow} {...stroke} />
    </svg>
  );
}

export const ITEM_NAME: Record<Item, string> = { shuriken: 'SHURIKEN', smoke: 'SMOKE BOMB', ramen: 'RAMEN', emp: 'EROBOT EMP' };

/**
 * A result card in the NPG card format (961×1441): the pilot's card background, her face if we have one, the frame
 * layer on top, then the name box and stat boxes down the bottom.
 */
export function ResultCard({ slug, name, face, place, stats, width = 220, tag }: { slug: string; name: string; face: string | null; place: string; stats: [string, string][]; width?: number; tag: 'NPG' | 'EROBOT' }) {
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width, aspectRatio: '961 / 1441', border: `3px solid ${NPG.ink}`, boxShadow: `8px 8px 0 ${NPG.ink}`, background: `#1a0630 url(/npg/cards/${slug}-card-bg.webp) center / cover` }}>
      {face && <div className="absolute inset-x-[10%] top-[12%] h-[46%]" style={{ background: `url(${face}) center 20% / cover` }} />}
      <div className="absolute inset-0" style={{ background: `url(/npg/cards/${slug}-card-frame.webp) center / cover` }} />
      <div className="absolute left-[6%] top-[4%] rotate-[-6deg]" style={{ ...cardBox, fontSize: width * 0.1, padding: '2px 10px', background: tag === 'NPG' ? '#fff' : NPG.ink, color: tag === 'NPG' ? NPG.ink : '#fff', fontStyle: 'italic', fontWeight: 900, fontFamily: 'Impact, "Arial Black", sans-serif' }}>
        {tag}
      </div>
      <div className="absolute right-[5%] top-[5%]" style={{ ...cardBox, fontSize: width * 0.13, background: NPG.pink, padding: '4px 10px' }}>
        {place}
      </div>
      <div className="absolute inset-x-[5%] bottom-[5%] grid gap-1">
        <CardBox style={{ fontSize: width * 0.085, justifyContent: 'flex-start' }}>{name}</CardBox>
        <div className="grid gap-1">
          {stats.map(([k, v]) => (
            <span key={k} className="grid gap-1" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <CardBox style={{ fontSize: width * 0.05, justifyContent: 'flex-start', padding: '1px 6px', overflow: 'hidden' }}>{k}</CardBox>
              <CardBox style={{ fontSize: width * 0.06, padding: '1px 6px', minWidth: '3em' }}>{v}</CardBox>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
