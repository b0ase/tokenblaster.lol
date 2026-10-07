import { Barlow_Condensed, Noto_Sans_JP, Space_Mono } from 'next/font/google';

/** The DR type pair: a heavy condensed grotesk for display, a mono for codes, and a JP face for katakana flourishes. */
export const drDisplay = Barlow_Condensed({ weight: ['800', '900'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--dr-display' });
export const drMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], display: 'swap', variable: '--dr-mono' });
export const drJp = Noto_Sans_JP({ weight: ['900'], preload: false, display: 'swap', variable: '--dr-jp' });

/** Put on a wrapper element to make the DR variables available to everything inside. */
export const drFontClass = `${drDisplay.variable} ${drMono.variable} ${drJp.variable}`;
