import { Audiowide } from 'next/font/google';
import type { CSSProperties } from 'react';
import { DR } from '@/lib/dr/tokens';
import { GAME_B, GAME_REST } from '@/lib/hyper/brand';

/** The bRacer logotype face. Only the logo uses it; everything else keeps the DR pair. */
export const logoFont = Audiowide({ weight: '400', subsets: ['latin'], display: 'swap', fallback: ['Arial Black', 'Impact', 'sans-serif'] });
export const LOGO_FAMILY = logoFont.style.fontFamily;

/** Lowercase red b + RACER, in Audiowide. `size` is a CSS length. */
export function Logo({ size, rest = DR.colour.paper, style }: { size: number | string; rest?: string; style?: CSSProperties }) {
  return (
    <span
      style={{ fontFamily: LOGO_FAMILY, fontWeight: 400, fontSize: size, lineHeight: 0.9, letterSpacing: '-0.02em', color: rest, textShadow: '0.04em 0.04em 0 #000', whiteSpace: 'nowrap', display: 'inline-block', ...style }}
    >
      <span style={{ color: DR.colour.signal }}>{GAME_B}</span>
      {GAME_REST}
    </span>
  );
}
