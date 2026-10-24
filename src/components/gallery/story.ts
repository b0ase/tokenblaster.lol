import type { StoryCard } from '../coinop/LoadingScreen';

/** Loading-screen story for the Shooting Gallery. Original characters; short, punchy, a few seconds each. */
export const GALLERY_STORY: StoryCard[] = [
  { title: 'THE NIGHT SHIFT', line: 'Neo-London, 1991. It never stops raining. Nobody sleeps on the night shift.', crop: { x: 0.6, y: 0.58, zoom: 2 } },
  { title: 'OMNICORE DYNAMICS', line: 'Ninety floors of black glass. They own the grid, the papers and the police.', crop: { x: 0.41, y: 0.14, zoom: 3.4 } },
  { title: 'THE LIQUID UNIT', line: 'Chrome that flows like mercury. Stop firing and it comes back whole.', crop: { x: 0.64, y: 0.5, zoom: 2.2 } },
  { title: 'THE GUNNER', line: 'One shooter. One rotary gun. A pocket full of coins.', crop: { x: 0.24, y: 0.72, zoom: 2.2 } },
  { title: 'THE RECORD', line: 'Every bullet goes on the record. The world can count them. Make yours count.', crop: { x: 0.45, y: 0.68, zoom: 2.4 } },
];

export const GALLERY_TIPS: string[] = [
  'Hold the trigger. Every bullet is a real transaction.',
  'The Liquid Unit heals when you stop firing. Keep the pressure on.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the tower glass for extra points.',
  'The more coins you put in, the more rounds you get.',
];

/** The loading screen's backdrop: the street scene, cropped clear of the share card's lettering. */
export const GALLERY_ART_CROP = { x: 0.55, y: 0.66, zoom: 1.55 };
