import { Big_Shoulders, Chakra_Petch } from 'next/font/google';

/** The coin-op / gallery type pair: one display face (Big Shoulders, condensed industrial) and one UI face (Chakra Petch). */
export const tbxDisplay = Big_Shoulders({ subsets: ['latin'], display: 'swap', preload: false, variable: '--tbx-display' });
export const tbxUi = Chakra_Petch({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', preload: false, variable: '--tbx-ui' });

/** Put on a wrapper to make the fonts and the .tbx design tokens available to everything inside. */
export const tbxFontClass = `tbx ${tbxDisplay.variable} ${tbxUi.variable}`;
