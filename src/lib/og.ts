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

export const MULTIPLAYER_CARD = card(
  'multiplayer-dr-v1.jpg',
  'BLAST YOUR GROUP CHAT poster: tilted TokenBlaster screenshots of Arena, bRacer, Double-O Satoshi and Token Snake with X avatars and verified ticks floating over the players.',
);

export const RALLY_CARD = card(
  'rally-v3.jpg',
  'TOKEN RALLY poster in a bold italic rally title with speed streaks: a blue rally car, spotlights blazing, drifting through forest dust on a gravel stage. Every litre of fuel is a BSV tx, rivals are live mainnet transactions.',
);

export const CITY_CARD = card(
  'city-v3.jpg',
  'SATOSHI CITY poster in magenta and cyan neon-tube lettering: a low wide shot of a rainy neon night plaza, the gold B monument beside the title and a red supercar on the wet street. Every car is a live BSV tx.',
);

// Red neon dripping blood (25 Oct 2026): scripts/og/compose-neon-card.mjs scripts/og/terrornode-neon-v5.json (v5 adds OFFICIAL NPG GAME)
export const TERRORNODE_CARD = card(
  'terrornode-neon-v5.jpg',
  'WELCOME TO TERRORNODE in red neon-tube lettering dripping blood, with the pink Ninja Punk Girls logo and OFFICIAL NPG GAME, over a first-person minigun on a rainy Neo-Tokyo 2048 street with an Erobotz unit ahead. Every bullet = 1 real BSV tx.',
);

// OG refresh (24 Oct 2026): house-style cards from real in-game renders (scripts/og/compose-dr-card.mjs).
export const SAT_STACK_CARD = card('sat-stack-2048-neon-v2.jpg', 'SAT STACK 2048 poster: a tilted board of merging sat-stack tiles, dust to sat to coin to a gold 128 vault tile. Cut a 1 BSV tile.');
export const HIGHWAY21_CARD = card('highway21-neon-v2.jpg', 'HIGHWAY 21M poster: a yellow supercar racing a pixel sunset highway past a glowing BSV billboard. Traffic = live BSV transactions.');
export const FROGGER_CARD = card('frogger-neon-v2.jpg', 'CHAIN FROGGER poster: a pink-haired frog on a 3D city crosswalk. Every car is a live BSV transaction.');
export const COIN_POP_CARD = card('coin-pop-neon-v2.jpg', 'COIN POP poster: a tilted bubble-shooter board packed with token coins, with the aiming line and cannon. Aim, match three, clear the board.');
export const TOKEN_POTIONS_CARD = card('token-potions-neon-v2.jpg', 'TOKEN POTIONS poster: a tilted match-3 board of flame, drop and swirl potions on a purple backdrop. Chain combos against the 60-second clock.');
export const NPG_ARENA_CARD = card('npg-arena-neon-v2.jpg', 'NINJA PUNK ARENA poster: two chibi Ninja Punk Girls clash in a neon rooftop dojo. Twelve fighters, best of three.');
export const ORDNANCE_STORE_CARD = card('ordnance-store-neon-v2.jpg', '1SAT ORDNANCE STORE poster: a fan of gun cards (rocket launcher, minigun, Genesis Blaster). 22 guns as real 1Sat ordinals, inscribed straight to your wallet.');
