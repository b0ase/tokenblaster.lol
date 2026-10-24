import type { StoryCard } from '../coinop/LoadingScreen';

/** Loading-screen key art: renders from the gallery's own 3D engine at High quality (1894×972 WebP). */
export const GALLERY_SHOTS = ['/gallery/loading/tower.webp', '/gallery/loading/boss.webp', '/gallery/loading/street-left.webp', '/gallery/loading/street-right.webp', '/gallery/loading/boss-fire.webp'];

/** Loading-screen story for the Shooting Gallery. Original characters; short, punchy, a few seconds each. */
export const GALLERY_STORY: StoryCard[] = [
  { title: 'THE NIGHT SHIFT', line: 'Neo-London, 1991. It never stops raining. Nobody sleeps on the night shift.' },
  { title: 'OMNICORE DYNAMICS', line: 'Ninety floors of black glass. They own the grid, the papers and the police.' },
  { title: 'THE LIQUID UNIT', line: 'Chrome that flows like mercury. Stop firing and it comes back whole.' },
  { title: 'THE GUNNER', line: 'One shooter. One rotary gun. A pocket full of coins.' },
  { title: 'THE RECORD', line: 'Every bullet goes on the record. The world can count them. Make yours count.' },
];

export const GALLERY_TIPS: string[] = [
  'Hold the trigger. Every bullet is a real transaction.',
  'The Liquid Unit heals when you stop firing. Keep the pressure on.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the tower glass for extra points.',
  'The more coins you put in, the more rounds you get.',
];

