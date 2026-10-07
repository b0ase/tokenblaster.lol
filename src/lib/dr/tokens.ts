/**
 * "DR" design tokens: the graphic language that started with the 1Sat Ordnance cards (hazard stripes, halftone,
 * sunbursts, boxed stamps) and grows up in bRacer (team chevrons, pictograms, oversized condensed type, product
 * codes, katakana flourishes, sticker slogans). It is an homage to 90s electronic-label graphic design; all
 * layouts are original. Components live in src/components/dr/.
 */
export const DR = {
  colour: {
    ink: '#0a0a0c',
    carbon: '#14151a',
    paper: '#f2efe6',
    signal: '#e8261d', // house red
    amber: '#ffb800', // ordnance hazard
    cyan: '#27e6ff',
    magenta: '#ff2f92',
    acid: '#c8ff1a',
    blue: '#2a5bff',
    grey: '#8a8a92',
  },
  /** CSS custom properties set by <DrFonts> (src/components/dr/fonts.ts). */
  font: {
    display: 'var(--dr-display), Impact, "Arial Black", sans-serif',
    mono: 'var(--dr-mono), ui-monospace, Menlo, monospace',
    jp: 'var(--dr-jp), "Hiragino Sans", "Noto Sans JP", sans-serif',
  },
  /** 8px base unit. */
  space: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 },
  /** 12-column grid with a thin visible rule, as on a poster. */
  grid: { cols: 12, gap: 8, rule: 'rgba(255,255,255,0.09)', cell: 48 },
  /** Type scale (px at 1x; use clamp() in layouts). Display is always uppercase italic condensed. */
  type: { micro: 10, small: 12, body: 14, lead: 18, h3: 28, h2: 44, h1: 76, mega: 160 },
} as const;

export type DrColour = keyof typeof DR.colour;

/** The six teams double as accent systems: base / accent / trim. */
export const DR_TEAM_INKS = {
  house: ['#e8261d', '#ffffff', '#111111'],
  token: ['#101015', '#e8b53a', '#ffffff'],
  ordinal: ['#f2f2ee', '#c4161c', '#101010'],
  merchant: ['#1f8f4a', '#f4efe2', '#101010'],
  data: ['#2a5bff', '#ff5a48', '#e8e8e8'],
  signal: ['#d33d8c', '#fff2f8', '#2a0a1a'],
} as const;

/** Catalogue code, e.g. drCode('HG', 3) -> HG-003. */
export const drCode = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;
