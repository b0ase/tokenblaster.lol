/**
 * NEO-TOKYO BLACKOUT: the story of the TokenBlaster Shooting Gallery. Pure data and copy (no React, no browser),
 * so the loading screen, the loadout ("MISSION BRIEFING"), the wave banners, the game-over screen and the
 * tests all read the same words.
 *
 * Original characters and world, PG-13. Plain words for players: no tech terms. The in-world conceit for the
 * 31 Oct stress test is that every round the Gunner fires goes on the record and jams OMNICORE's grid.
 * (Players can see the real thing in the ON CHAIN panel; the story never needs the jargon.)
 */

export const GAME_TITLE = 'NEO-TOKYO BLACKOUT';
export const SETTING = 'NEO-TOKYO · 2048';
export const GAME_KICKER = 'TOKENBLASTER SHOOTING GALLERY';

/** One paragraph. What the player is doing and why. */
export const PREMISE =
  'Neo-Tokyo, 2048. Rain on neon, hover traffic stacked twelve lanes high, and OMNICORE DYNAMICS watching all of it. Its machine mind runs the grid, the sky lanes and the police, and it has built an army to keep it that way: the EROBOTS, and the LIQUID UNIT, a chrome android that pours itself back together. You are THE GUNNER, the last night-shift mechanic with a rotary gun and a pocket full of coins. Every round you fire goes on the record and jams their grid. Fire enough, and the whole tower goes dark.';

/** Short lines for banners, shares and the lobby. */
export const TAGLINES = [
  'Every round goes on the record.',
  'Jam the grid. Keep the lights off.',
  'The city never sleeps. Neither does the gun.',
  'One gun. One tower. Zero mercy.',
  'It pours itself back together. Keep firing.',
  'Burn the coins. Break the machine.',
] as const;
export const TAGLINE = TAGLINES[0];

// ── Lore beats (shown one at a time on the loading screen, in this order) ──────────────

export type LoreBeat = { id: string; title: string; line: string };
export const LORE: LoreBeat[] = [
  { id: 'rain', title: 'NEO-TOKYO, 2048', line: 'Rain on neon. Hover traffic stacked twelve lanes high. Everyone who still has a job works the night shift, and everyone is being counted.' },
  { id: 'tower', title: 'OMNICORE DYNAMICS', line: 'Ninety floors of black glass. Its machine mind runs the grid, the sky lanes and the police. It has never once said please.' },
  { id: 'army', title: 'THE EROBOT ARMY', line: 'Cheap, fast and everywhere. Rotor bots in the air, frog bots in the gutters, and techs on the roof to patch them back up.' },
  { id: 'liquid', title: 'THE LIQUID UNIT', line: 'Chrome that flows like mercury. Break it and it melts into the street, then stands up again. Tougher every time.' },
  { id: 'gunner', title: 'THE GUNNER', line: 'No badge, no army. One rotary gun and a pocket of coins. Every coin you drop in becomes rounds.' },
  { id: 'record', title: 'THE RECORD', line: 'Every round you fire is written down where nobody can erase it. Enough of them at once and OMNICORE’s grid chokes.' },
  { id: 'dawn', title: 'BEFORE DAWN', line: 'You have until sunrise. Break the glass, drop the racks, keep the Liquid Unit down, and make the tower go dark.' },
];

// ── Characters ──────────────────────────────────────────────────────────────────────────

export type CharacterKind = 'hero' | 'boss' | 'erobot';
export type Character = {
  id: string;
  name: string;
  /** Short role line shown under the name. */
  role: string;
  kind: CharacterKind;
  bio: string;
  /** What it does to you in the game, in plain words. */
  threat: string;
  /** Accent colour for its card. */
  colour: string;
  /**
   * Portrait slot. Drop a render at this path and it is picked up by itself (the loader and the briefing
   * check the file exists; until then a drawn badge is shown). 4:5, at least 640x800, WebP.
   */
  portrait: string;
  /** Key-art slot: a wide render of this character. Optional; used as a loading-screen shot when it exists. */
  shot?: string;
};

export const CHARACTERS: Character[] = [
  {
    id: 'gunner',
    name: 'THE GUNNER',
    role: 'Night-shift shooter',
    kind: 'hero',
    bio: 'Used to fix the hover-trams for OMNICORE. Was let go by a text message. Kept the keys to the old armoury and one very big gun. Talks to nobody, counts everything.',
    threat: 'You. A rotary gun that never jams while there are rounds in it.',
    colour: '#ffb21a',
    portrait: '/gallery/characters/gunner.webp',
    shot: '/gallery/loading/gunner.webp',
  },
  {
    id: 'liquid',
    name: 'THE LIQUID UNIT',
    role: 'OMNICORE’s chrome android',
    kind: 'boss',
    bio: 'The tower’s best work. A body of living mercury with one red eye. Shoot it apart and it melts into the street, then pulls itself back up a little harder. It does not tire and it does not hurry.',
    threat: 'Strides straight at you and loops back every wave with more health. Stop firing and it heals.',
    colour: '#dfe8f5',
    portrait: '/gallery/characters/liquid.webp',
    shot: '/gallery/loading/boss.webp',
  },
  {
    id: 'bot',
    name: 'BOT',
    role: 'Rotor drone',
    kind: 'erobot',
    bio: 'The standard EROBOT. A camera, four rotors and a fear of heights it was never given. Cheap, loud, and there are thousands.',
    threat: 'Swarms in from above. Worth a few points each.',
    colour: '#ff5a4a',
    portrait: '/gallery/characters/bot.webp',
  },
  {
    id: 'frog',
    name: 'FROG-BOT',
    role: 'Gutter jumper',
    kind: 'erobot',
    bio: 'Built for the drains. Springs for legs, a chrome green shell and a habit of landing exactly where you were standing.',
    threat: 'Leaps across the street in long arcs. Hard to track, easy to pop.',
    colour: '#c8ff1a',
    portrait: '/gallery/characters/frog-bot.webp',
  },
  {
    id: 'graf',
    name: 'GRAF-BOT',
    role: 'Street tagger',
    kind: 'erobot',
    bio: 'A spray-can arm and a dented head. OMNICORE sends it to paint over every sign that is not theirs. It thinks it is an artist. It is not.',
    threat: 'Covers the glass in paint, so you have to keep shooting to see.',
    colour: '#ff2f92',
    portrait: '/gallery/characters/graf-bot.webp',
  },
  {
    id: 'stripey',
    name: 'STRIPEY-BOT',
    role: 'Warning-stripe enforcer',
    kind: 'erobot',
    bio: 'Black and yellow, because a warning should be seen. A riot shield on one arm and a baton on the other. Slow, stubborn and very hard to move.',
    threat: 'Soaks up rounds before it goes down. Aim high, and keep the trigger down.',
    colour: '#ffd23a',
    portrait: '/gallery/characters/stripey-bot.webp',
  },
  {
    id: 'tech',
    name: 'TECH',
    role: 'Repair unit',
    kind: 'erobot',
    bio: 'The one with the toolbox. Climbs the tower, patches the racks and brings broken bots back online. If you leave it alone it will fix everything you just broke.',
    threat: 'Rebuilds smashed racks and glass. Take it out first.',
    colour: '#27e6ff',
    portrait: '/gallery/characters/tech.webp',
  },
];
export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id);

// ── Loading screen shots ────────────────────────────────────────────────────────────────

/**
 * Key art for the loading screen. EASY TO EXTEND: add a row, drop the file in `public/gallery/loading/`, done.
 *  - `src`: the render (hi-res 16:9 WebP, 1920x1080 or more). A file that is missing is skipped by itself, so a
 *    slot can be listed before the art exists.
 *  - `beat`: the LORE id shown with it. `focus`: a CHARACTERS id, its bio card shows on the right.
 *  - `pos`: CSS object-position, to keep the subject in view on a phone (default 'center').
 * Shots show in this order and loop. The scene and character agents add theirs to the end (or the front).
 */
export type LoadingShot = { src: string; beat: string; focus?: string; pos?: string; caption?: string };
export const LOADING_SHOTS: LoadingShot[] = [
  { src: '/gallery/loading/street-left.webp', beat: 'rain', pos: '38% 50%', caption: 'Neo-Tokyo, 01:14' },
  { src: '/gallery/loading/tower.webp', beat: 'tower', focus: 'bot', pos: '50% 50%', caption: 'OMNICORE DYNAMICS' },
  { src: '/gallery/loading/street-right.webp', beat: 'army', focus: 'stripey', pos: '60% 50%', caption: 'The army wakes' },
  { src: '/gallery/loading/boss.webp', beat: 'liquid', focus: 'liquid', pos: '62% 50%', caption: 'The Liquid Unit' },
  { src: '/gallery/loading/boss-fire.webp', beat: 'gunner', focus: 'gunner', pos: '70% 50%', caption: 'Open fire' },
  // ── Slots for new renders (skipped until the file exists) ──
  { src: '/gallery/loading/city-wide.webp', beat: 'record', pos: '50% 50%', caption: 'The whole city is listening' },
  { src: '/gallery/loading/erobots.webp', beat: 'army', focus: 'frog', pos: '50% 50%', caption: 'Erobots on the street' },
  { src: '/gallery/loading/graf-bot.webp', beat: 'army', focus: 'graf', pos: '50% 50%', caption: 'Graf-bot at work' },
  { src: '/gallery/loading/tech.webp', beat: 'army', focus: 'tech', pos: '50% 50%', caption: 'Tech on the roof' },
  { src: '/gallery/loading/liquid-melt.webp', beat: 'liquid', focus: 'liquid', pos: '50% 60%', caption: 'It melts. It returns.' },
  { src: '/gallery/loading/dawn.webp', beat: 'dawn', focus: 'gunner', pos: '50% 50%', caption: 'Before dawn' },
];

// ── Waves ───────────────────────────────────────────────────────────────────────────────

export type WaveBrief = { n: number; code: string; title: string; brief: string; intel: string; boss: string };
const WAVES: WaveBrief[] = [
  { n: 1, code: 'STREET LEVEL', title: 'FIRST CONTACT', brief: 'Rotor bots in the air, and the Liquid Unit walking up the street. Smash the lobby glass and keep the trigger down.', intel: 'Bots are quick but weak. The Unit heals when you stop.', boss: 'The Liquid Unit has stepped out of the lobby.' },
  { n: 2, code: 'SERVER FLOOR', title: 'THE REBUILD', brief: 'OMNICORE poured the Unit back together and sent Tech to patch the racks. Drop every rack before it gets repaired.', intel: 'Racks are worth big points. Tech rebuilds what you leave.', boss: 'The Unit is back, half as tough again.' },
  { n: 3, code: 'SKY LANE', title: 'PAINT OVER', brief: 'Graf-bots are tagging the glass and Frog-bots are leaping the gutters. Keep firing and keep moving your aim.', intel: 'Frog-bots land where you were. Lead them.', boss: 'The Unit walks in through the paint, over twice as tough.' },
  { n: 4, code: 'LOCKDOWN', title: 'STRIPES', brief: 'The Stripey-bots have blocked the street. They soak up rounds. Hold the trigger and let the volume do the work.', intel: 'Heavy plating. Sustained fire only.', boss: 'The Unit steps out from behind the shields, three times as tough.' },
  { n: 5, code: 'THE VAULT', title: 'GRID JAM', brief: 'Everything OMNICORE has is out. The more rounds you put on the record, the harder their grid chokes. Do not stop.', intel: 'Every round counts. Faster is better.', boss: 'The Unit is five times as tough as when you started.' },
  { n: 6, code: 'ROOFTOP', title: 'LIGHTS OUT', brief: 'One floor left. The machine mind is throwing everything it has. Burn through your last coins and take the lights out.', intel: 'No more patches. No more reloads from them.', boss: 'The Unit will not stop. Neither should you.' },
];
const bossGrowth = (n: number) => Math.round((Math.pow(1.5, n - 1) - 1) * 100);
/** The briefing for wave n. Past the written waves it keeps escalating. */
export function waveBrief(n: number): WaveBrief {
  const w = Math.max(1, Math.floor(n));
  const known = WAVES[w - 1];
  if (known) return known;
  return {
    n: w,
    code: `OVERTIME ${w - WAVES.length}`,
    title: 'NO SURRENDER',
    brief: 'Past the end of the plan. OMNICORE keeps pouring the Unit back together and you keep shooting. How long can you keep the grid jammed?',
    intel: 'Nothing new to learn. Hold the trigger.',
    boss: `The Unit is ${bossGrowth(w)}% tougher than at the start.`,
  };
}
export const WAVE_COUNT = WAVES.length;

// ── Banners ─────────────────────────────────────────────────────────────────────────────

export const BANNERS = {
  loaded: { top: 'GUN LOADED.', bottom: 'LIVE ROUNDS', sub: 'Every round you fire is on the record.' },
  boss: { top: 'BOSS INCOMING', sub: 'THE LIQUID UNIT' },
} as const;

// ── Loadout: MISSION BRIEFING ───────────────────────────────────────────────────────────

export const BRIEFING = {
  heading: 'MISSION BRIEFING',
  code: 'OPERATION BLACKOUT · NEO-TOKYO 2048',
  objective: 'Break into OMNICORE DYNAMICS, jam its grid, and keep the Liquid Unit down.',
  rules: [
    'Hold the trigger to fire. Every round is real and goes on the record.',
    'The Liquid Unit heals when you stop. Keep the pressure on.',
    'Smash the glass, drop the racks and clear the bots for points.',
    'No refunds. Only put in what you want to spend.',
  ],
} as const;

// ── Game over ───────────────────────────────────────────────────────────────────────────

export type Rank = { min: number; title: string; line: string };
/** By rounds fired, highest first. */
export const RANKS: Rank[] = [
  { min: 1_000_000, title: 'GRID BREAKER', line: 'A million rounds on the record. OMNICORE’s grid is a smoking hole.' },
  { min: 100_000, title: 'LIGHTS OUT', line: 'The lights are going out across Neo-Tokyo.' },
  { min: 10_000, title: 'TOWER SHAKER', line: 'The tower felt every one of those.' },
  { min: 1_000, title: 'NEON HERO', line: 'A good night’s work. The machine is rattled.' },
  { min: 100, title: 'STREET FIGHTER', line: 'You made some noise. Come back with more coins.' },
  { min: 0, title: 'ROOKIE', line: 'The night is long. Load up and try again.' },
];
export const rankFor = (rounds: number): Rank => RANKS.find((r) => rounds >= r.min) ?? RANKS[RANKS.length - 1];

export const GAME_OVER = {
  title: 'OUT OF ROUNDS',
  line: 'The gun is empty. The Liquid Unit is still standing, and so is the tower.',
  next: 'The next coin is on you.',
} as const;

/** The text a player shares. Plain words. */
export function shareText(p: { rounds: number; score: number; waves: number; name?: string | null }): string {
  const who = p.name ? `@${p.name} fired` : 'I fired';
  return `${who} ${p.rounds.toLocaleString('en-US')} rounds at OMNICORE DYNAMICS, reached wave ${p.waves} and scored ${p.score.toLocaleString('en-US')}. Every round is on the record. Beat that.`;
}

// ── Tips ────────────────────────────────────────────────────────────────────────────────

export const TIPS: string[] = [
  'Hold the trigger. Every round is real.',
  'The Liquid Unit heals when you stop. Keep the pressure on.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the tower glass for extra points.',
  'Drop the server racks before Tech can repair them.',
  'The more coins you put in, the more rounds you get.',
  'Lead the Frog-bots. They land where you were.',
];
