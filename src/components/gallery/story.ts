import type { StoryCard } from '../coinop/LoadingScreen';

/** Loading-screen story for the Shooting Gallery. Original characters; short, punchy, a few seconds each. */
export const GALLERY_STORY: StoryCard[] = [
  { title: 'THE NIGHT SHIFT', line: 'Neo-London, 1991. It never stops raining. The street lights hum. Nobody sleeps on the night shift.' },
  { title: 'OMNICORE DYNAMICS', line: 'Ninety floors of black glass. They own the power grid, the papers and the police. Tonight they own the street.' },
  { title: 'THE LIQUID UNIT', line: 'Omnicore’s finest work. Chrome that flows like mercury. Hit it and it heals. Stop firing and it comes back whole.' },
  { title: 'THE GUNNER', line: 'One shooter. One rotary gun. A pocket full of coins. Every round you fire is written into the record forever.' },
  { title: 'THE RECORD', line: 'Every bullet is a real transaction. The world can count them. Make yours count.' },
];

export const GALLERY_TIPS: string[] = [
  'Hold the trigger. Every bullet is a real transaction.',
  'The Liquid Unit heals when you stop firing. Keep the pressure on.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the tower glass for extra points.',
  'The more coins you put in, the more rounds you get.',
];
