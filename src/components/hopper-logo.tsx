import { Syncopate } from 'next/font/google';
import type { CSSProperties } from 'react';
import { DR } from '@/lib/dr/tokens';

/** The Block Hopper logotype face (wide, geometric). Only the logo uses it; everything else keeps the DR pair. */
export const hopperLogoFont = Syncopate({ weight: ['700'], subsets: ['latin'], display: 'swap', fallback: ['Arial Black', 'Impact', 'sans-serif'] });
export const HOPPER_LOGO_FAMILY = hopperLogoFont.style.fontFamily;

/** BLOCK in outline over HOPPER in house red, slightly sheared, with a hop-arc chevron. `size` is a CSS length. */
export function HopperLogo({ size, style }: { size: number | string; style?: CSSProperties }) {
  const base: CSSProperties = { fontFamily: HOPPER_LOGO_FAMILY, fontWeight: 700, lineHeight: 0.92, letterSpacing: '-0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', display: 'block' };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize: size, transform: 'skewX(-9deg)', transformOrigin: 'left bottom', ...style }}>
      <span style={{ ...base, color: 'transparent', WebkitTextStroke: `0.045em ${DR.colour.paper}`, fontSize: '0.62em', letterSpacing: '0.02em' }}>BLOCK</span>
      <span style={{ ...base, color: DR.colour.signal, textShadow: '0.05em 0.05em 0 #000', marginTop: '-0.04em' }}>HOPPER</span>
    </span>
  );
}
