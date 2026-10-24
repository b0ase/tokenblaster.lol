/**
 * NEO-TOKYO BLACKOUT: the story of the TokenBlaster Shooting Gallery. Pure data and copy (no React, no browser),
 * so the loading screen, the loadout ("MISSION BRIEFING"), the wave banners, the game-over screen and the
 * tests all read the same words.
 *
 * Settled by the owner (24 Oct 2026): Neo-Tokyo, 2048. DR KWEG WONG, a mad scientist, invented the EROBOTS
 * (bot, frog-bot, graf-bot, stripey-bot, tech) and the LIQUID UNIT, and wants the whole city. The NINJA PUNK
 * GIRLS fight him and the player joins them. bCorp (not evil, just corporate: Project EROBOT was its security
 * experiment that went wrong) versus OMNICORE (the rival megacorp whose tower Kweg took over). Original, PG-13.
 * In-world conceit for the 31 Oct stress test: every round the player fires goes on the record and jams
 * Kweg's robot network. Plain words for players: no tech terms.
 *
 * KWEG WONG'S TEXT IS ALL IN `KWEG` BELOW (and nowhere else), because he gets upgraded for the bMovie "KWEG".
 * His character comes from kwegwong.com: Professor Doctor Sir Kweg S Wong esq., self-appointed CEO of Bitcoin,
 * a deadpan academic who peer-reviews everything, "established it in 2009", with a submarine, an elephant and
 * a seahorse. Round spectacles, striped engineer's cap, red bow tie, knitted vest. Never winks. Never breaks.
 */

export const GAME_TITLE = 'NEO-TOKYO BLACKOUT';
export const GAME_KICKER = 'TOKENBLASTER SHOOTING GALLERY';
export const SETTING = 'NEO-TOKYO · 2048';

/** One paragraph. What the player is doing and why. */
export const PREMISE =
  'Neo-Tokyo, 2048. Rain on neon, hover traffic stacked twelve lanes high, and one mad professor with the keys to a robot army. DR KWEG WONG built the EROBOTS and the LIQUID UNIT for bCorp as a security experiment. It went wrong, he sold out to the rival megacorp OMNICORE, took over its tower, and now he wants the whole city. The NINJA PUNK GIRLS are the only ones fighting back, and you have just joined them with a rotary gun and a pocket of coins. Every round you fire goes on the record and jams his robot network. Fire enough, and the tower goes dark.';

/** Short lines for banners, shares and the lobby. */
export const TAGLINES = [
  'Every round goes on the record.',
  'Jam the network. Keep the lights off.',
  'The city never sleeps. Neither does the gun.',
  'One gun. One tower. One very bad professor.',
  'It pours itself back together. Keep firing.',
  'Burn the coins. Break the machine.',
] as const;
export const TAGLINE = TAGLINES[0];

// ── DR KWEG WONG: every word he says lives here ─────────────────────────────────────────

export const KWEG = {
  id: 'kweg',
  name: 'DR KWEG WONG',
  fullName: 'Professor Doctor Sir Kweg S Wong esq.',
  role: 'Mad scientist · Self-appointed CEO of Neo-Tokyo',
  look: 'Round spectacles, a striped engineer’s cap, a red bow tie and a knitted vest under a lab coat. A tablet in one hand, a magnifying glass in the other.',
  bio: 'Professor Doctor Sir Kweg S Wong esq. designed the EROBOTS for bCorp, then marked his own work ACCEPTED and kept it. He is polite, precise and completely certain that he established all of this in 2009. He peer-reviews everything, including you, and he has never once been seen to smile.',
  threat: 'Runs the Liquid Unit and every Erobot from the top floor, and reviews your rounds as they land.',
  /** Spoken on the loading screen, briefing and banners. */
  intro: 'I established this tower in 2009. You are, regrettably, trespassing on a peer-reviewed building.',
  boss: 'Rotate your monitor 180 degrees. The Liquid Unit is arriving, and so is the correct answer.',
  /** One per wave, in order; the last one repeats with a number. */
  waves: [
    'Your first rounds have been received. Verdict: accepted with required revisions.',
    'The Liquid Unit has been reassembled. I have corrected your assumptions about it.',
    'Paint, springs and plate. Allow me to cite my earlier work, also mine.',
    'You are hitting my robots very hard. Please note that they are also peer reviewed.',
    'I notice the network is slowing. This is not a coincidence. It is you.',
    'My tower is going dark. I would like it noted that I predicted this, in 2009.',
  ],
  overtime: 'Past the end of my paper. I did not plan for this. I did not plan for you.',
  /** Game over. */
  over: 'Peer review verdict: your gun is empty. REJECTED, pending further coins.',
  /** Share-card sign-off and loading line. */
  signoff: 'Respectfully, the CEO of Neo-Tokyo.',
  loading: 'Please wait. The submarine is surfacing.',
} as const;

// ── Lore beats (shown one at a time on the loading screen, in this order) ──────────────

export type LoreBeat = { id: string; title: string; line: string; /** The CHARACTERS id whose bio card sits beside this beat. */ focus: string };
export const LORE: LoreBeat[] = [
  { id: 'city', title: 'NEO-TOKYO, 2048', line: 'Rain on neon. Hover traffic stacked twelve lanes high. Ninety million people, and every one of them is being counted.', focus: 'gunner' },
  { id: 'bcorp', title: 'PROJECT EROBOT', line: 'bCorp built a robot guard for the city. Nothing evil, just corporate. One consultant wrote the code, and he kept a copy.', focus: 'bot' },
  { id: 'kweg', title: 'DR KWEG WONG', line: KWEG.intro, focus: 'kweg' },
  { id: 'omnicore', title: 'THE OMNICORE TOWER', line: 'OMNICORE, bCorp’s richest rival, needed a miracle. Kweg sold it one, then took over the top floor. The black glass tower is his now.', focus: 'kweg' },
  { id: 'army', title: 'THE EROBOT ARMY', line: 'Rotor bots in the air, frog bots in the gutters, graf bots on the glass, stripey bots in the street and techs on the roof to fix them all. Every one is his.', focus: 'frog' },
  { id: 'girls', title: 'THE NINJA PUNK GIRLS', line: 'Neon hair, sharp blades and no patience. The only crew in Neo-Tokyo who will say no to a professor. They need a gunner who can keep the trigger down.', focus: 'npg' },
  { id: 'record', title: 'THE RECORD', line: 'Every round you fire is written where nobody can erase it. Put enough on the record at once and Kweg’s robot network chokes.', focus: 'liquid' },
];

// ── Characters ──────────────────────────────────────────────────────────────────────────

export type CharacterKind = 'hero' | 'villain' | 'boss' | 'erobot';
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
    role: 'You · newest of the crew',
    kind: 'hero',
    bio: 'Used to fix hover-trams for bCorp. Let go by a text message. Kept the keys to the old armoury and one very big gun. The Ninja Punk Girls took one look and said the trigger is yours.',
    threat: 'You. A rotary gun that never jams while there are rounds in it.',
    colour: '#ffb21a',
    portrait: '/gallery/characters/gunner.webp',
  },
  {
    id: 'npg',
    name: 'THE NINJA PUNK GIRLS',
    role: 'Neo-Tokyo’s last street crew',
    kind: 'hero',
    bio: 'Neon hair, sharp blades and a van with no brakes. They know every back alley and every way into the tower. They get you to the glass; you keep the guns loud so they can reach the top floor.',
    threat: 'On your side. They keep the street clear while you hold the trigger.',
    colour: '#ff2f92',
    portrait: '/gallery/characters/npg.webp',
  },
  {
    id: 'kweg',
    name: KWEG.name,
    role: KWEG.role,
    kind: 'villain',
    bio: KWEG.bio,
    threat: KWEG.threat,
    colour: '#ff3b30',
    portrait: '/gallery/characters/kweg.webp',
    shot: '/gallery/loading/kweg.webp',
  },
  {
    id: 'liquid',
    name: 'THE LIQUID UNIT',
    role: 'Kweg’s chrome android',
    kind: 'boss',
    bio: 'His masterpiece. A body of living mercury with one red eye. Shoot it apart and it melts into the street, then pulls itself back up a little harder. It does not tire and it does not hurry.',
    threat: 'Strides straight at you and returns every wave with more health. Stop firing and it heals.',
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
    bio: 'A spray-can arm and a dented head. Kweg sends it to paint over every sign that is not his. It thinks it is an artist. It is not.',
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
    bio: 'The one with the toolbox. Climbs the tower, patches the racks and brings broken bots back online. Leave it alone and it fixes everything you just broke.',
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
  { src: '/gallery/loading/street-left.webp', beat: 'city', focus: 'gunner', pos: '50% 50%', caption: 'Neo-Tokyo, 01:14' },
  { src: '/gallery/loading/tower.webp', beat: 'omnicore', focus: 'kweg', pos: '50% 50%', caption: 'The OMNICORE tower' },
  { src: '/gallery/loading/street-right.webp', beat: 'army', focus: 'frog', pos: '60% 50%', caption: 'The Erobots wake' },
  { src: '/gallery/loading/boss.webp', beat: 'army', focus: 'liquid', pos: '55% 50%', caption: 'The Liquid Unit' },
  { src: '/gallery/loading/boss-fire.webp', beat: 'record', focus: 'npg', pos: '60% 50%', caption: 'Open fire' },
  { src: '/gallery/loading/muzzle.webp', beat: 'girls', focus: 'npg', pos: '62% 50%', caption: 'Hold the trigger' },
  // ── Slots for new renders (skipped until the file exists) ──
  { src: '/gallery/loading/kweg.webp', beat: 'kweg', focus: 'kweg', pos: '50% 40%', caption: 'Dr Kweg Wong' },
  { src: '/gallery/loading/npg.webp', beat: 'girls', focus: 'npg', pos: '50% 50%', caption: 'The Ninja Punk Girls' },
  { src: '/gallery/loading/erobots.webp', beat: 'army', focus: 'bot', pos: '50% 50%', caption: 'Erobots on the street' },
  { src: '/gallery/loading/graf-bot.webp', beat: 'army', focus: 'graf', pos: '50% 50%', caption: 'Graf-bot at work' },
  { src: '/gallery/loading/tech.webp', beat: 'army', focus: 'tech', pos: '50% 50%', caption: 'Tech on the roof' },
  { src: '/gallery/loading/stripey-bot.webp', beat: 'army', focus: 'stripey', pos: '50% 50%', caption: 'Stripey-bot holds the line' },
  { src: '/gallery/loading/liquid-melt.webp', beat: 'record', focus: 'liquid', pos: '50% 60%', caption: 'It melts. It returns.' },
  { src: '/gallery/loading/bcorp.webp', beat: 'bcorp', pos: '50% 50%', caption: 'Project EROBOT' },
];

// ── Waves ───────────────────────────────────────────────────────────────────────────────

export type WaveBrief = { n: number; code: string; title: string; brief: string; intel: string; boss: string; kweg: string };
const WAVES: Omit<WaveBrief, 'kweg'>[] = [
  { n: 1, code: 'STREET LEVEL', title: 'FIRST CONTACT', brief: 'Rotor bots in the air and the Liquid Unit walking up the street. Smash the lobby glass and keep the trigger down.', intel: 'Bots are quick but weak. The Unit heals when you stop.', boss: 'The Liquid Unit has stepped out of the lobby.' },
  { n: 2, code: 'SERVER FLOOR', title: 'THE REBUILD', brief: 'Kweg poured the Unit back together and sent Tech to patch the racks. Drop every rack before it gets repaired.', intel: 'Racks are worth big points. Tech rebuilds what you leave.', boss: 'The Unit is back, half as tough again.' },
  { n: 3, code: 'SKY LANE', title: 'PAINT OVER', brief: 'Graf-bots are tagging the glass and Frog-bots are leaping the gutters. Keep firing and keep moving your aim.', intel: 'Frog-bots land where you were. Lead them.', boss: 'The Unit walks in through the paint, over twice as tough.' },
  { n: 4, code: 'LOCKDOWN', title: 'STRIPES', brief: 'The Stripey-bots have blocked the street. They soak up rounds. Hold the trigger and let the volume do the work.', intel: 'Heavy plating. Sustained fire only.', boss: 'The Unit steps out from behind the shields, three times as tough.' },
  { n: 5, code: 'THE VAULT', title: 'NETWORK JAM', brief: 'Everything Kweg has is out. The more rounds you put on the record, the harder his robot network chokes. Do not stop.', intel: 'Every round counts. Faster is better.', boss: 'The Unit is five times as tough as when you started.' },
  { n: 6, code: 'ROOFTOP', title: 'LIGHTS OUT', brief: 'One floor left. The professor is throwing everything he has. Burn through your last coins and take the lights out.', intel: 'No more patches. No more reloads from him.', boss: 'The Unit will not stop. Neither should you.' },
];
const bossGrowth = (n: number) => Math.round((Math.pow(1.5, n - 1) - 1) * 100);
/** The briefing for wave n. Past the written waves it keeps escalating. Kweg's taunt comes from KWEG. */
export function waveBrief(n: number): WaveBrief {
  const w = Math.max(1, Math.floor(n));
  const known = WAVES[w - 1];
  if (known) return { ...known, kweg: KWEG.waves[w - 1] ?? KWEG.overtime };
  return {
    n: w,
    code: `OVERTIME ${w - WAVES.length}`,
    title: 'NO SURRENDER',
    brief: 'Past the end of the plan. Kweg keeps pouring the Unit back together and you keep shooting. How long can you keep his network jammed?',
    intel: 'Nothing new to learn. Hold the trigger.',
    boss: `The Unit is ${bossGrowth(w)}% tougher than at the start.`,
    kweg: KWEG.overtime,
  };
}
export const WAVE_COUNT = WAVES.length;

// ── Banners ─────────────────────────────────────────────────────────────────────────────

export const BANNERS = {
  loaded: { top: 'GUN LOADED.', bottom: 'LIVE ROUNDS', sub: 'Every round you fire is on the record.' },
  boss: { top: 'BOSS INCOMING', sub: 'THE LIQUID UNIT', kweg: KWEG.boss },
} as const;

// ── Loadout: MISSION BRIEFING ───────────────────────────────────────────────────────────

export const BRIEFING = {
  heading: 'MISSION BRIEFING',
  code: 'OPERATION BLACKOUT · NEO-TOKYO 2048',
  from: 'The Ninja Punk Girls',
  objective: 'Fight your way up the OMNICORE tower, jam Dr Kweg Wong’s robot network, and keep the Liquid Unit down.',
  rules: [
    'Hold the trigger to fire. Every round is real and goes on the record.',
    'The Liquid Unit heals when you stop. Keep the pressure on.',
    'Smash the glass, drop the racks and clear the Erobots for points.',
    'No refunds. Only put in what you want to spend.',
  ],
} as const;

// ── Game over ───────────────────────────────────────────────────────────────────────────

export type Rank = { min: number; title: string; line: string };
/** By rounds fired, highest first. */
export const RANKS: Rank[] = [
  { min: 1_000_000, title: 'NETWORK BREAKER', line: 'A million rounds on the record. Kweg’s robot network is a smoking hole.' },
  { min: 100_000, title: 'LIGHTS OUT', line: 'The lights are going out across Neo-Tokyo.' },
  { min: 10_000, title: 'TOWER SHAKER', line: 'The tower felt every one of those.' },
  { min: 1_000, title: 'NEON HERO', line: 'A good night’s work. The Ninja Punk Girls are impressed.' },
  { min: 100, title: 'STREET FIGHTER', line: 'You made some noise. Come back with more coins.' },
  { min: 0, title: 'ROOKIE', line: 'The night is long. Load up and try again.' },
];
export const rankFor = (rounds: number): Rank => RANKS.find((r) => rounds >= r.min) ?? RANKS[RANKS.length - 1];

export const GAME_OVER = {
  title: 'OUT OF ROUNDS',
  line: 'The gun is empty. The Liquid Unit is still standing, and so is the tower.',
  kweg: KWEG.over,
  next: 'The next coin is on you.',
} as const;

/** The text a player shares. Plain words. */
export function shareText(p: { rounds: number; score: number; waves: number; name?: string | null }): string {
  const who = p.name ? `@${p.name} fired` : 'I fired';
  return `${who} ${p.rounds.toLocaleString('en-US')} rounds at Dr Kweg Wong’s robot army in Neo-Tokyo, reached wave ${p.waves} and scored ${p.score.toLocaleString('en-US')}. Every round is on the record. Beat that.`;
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
