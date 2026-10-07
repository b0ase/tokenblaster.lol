/**
 * Share cards (1200x630 JPEG, <=300 KB) for the home, arcade and BlastPad pages, in the DR style (Signal palette).
 * They live in public/og/ and are referenced from each page's metadata (not the opengraph-image file convention).
 * Redesigned cards get a NEW file name (-v2, -v3...) rather than overwriting, so X/Discord/Telegram drop their cache.
 */
export type ShareCard = { url: string; width: 1200; height: 630; alt: string };

const card = (file: string, alt: string): ShareCard => ({ url: `/og/${file}`, width: 1200, height: 630, alt });

export const HOME_CARD = card(
  'home-dr-v2.jpg',
  'TOKENBLASTER.LOL poster: load your tokens, blast the chain. Every bullet = 1 real BSV tx. Collage of bRacer, Arena, Double-O Satoshi and Token Rally.',
);
export const ARCADE_CARD = card(
  'arcade-dr-v3.jpg',
  'Play the TokenBlaster arcade: 17 games on the live BSV chain, shown as an A-Z grid of tilted game screenshots including Token Snake, Block Hopper, Mempool Invaders and BSVGun. Every bullet = 1 real BSV tx.',
);
export const LAUNCH_CARD = card(
  'launch-dr-v1.jpg',
  'BLASTPAD poster: launch a coin, blast it up the curve. 1B fixed supply, one atomic tx per trade, proof of reserves.',
);

/** openGraph.images / twitter.images are the same list; twitter wants plain URLs with alt. */
export const shareImages = (c: ShareCard) => ({ openGraph: [c], twitter: [{ url: c.url, width: c.width, height: c.height, alt: c.alt }] });

export const ARENA_CARD = card(
  "arena-hell-v1.jpg",
  "TokenBlaster Arena: a minigun blasting skull demons in an underground hell-forge. Your tokens are the ammo, every bullet = 1 real BSV tx.",
);

export const HALL_CARD = card(
  'hall-of-fame-dr-v1.jpg',
  'TokenBlaster hall of fame poster: a red and amber hazard-striped trophy board ranking the best players of every arcade game on the live BSV chain.',
);
