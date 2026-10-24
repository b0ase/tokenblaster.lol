/**
 * ASSAULT ON TERRORNODE: the story of the TokenBlaster Shooting Gallery. Pure data and copy (no React, no browser),
 * so the loading screen, the loadout ("MISSION BRIEFING"), the stage banners, the game-over screen and the
 * tests all read the same words.
 *
 * CANON (owner, 24 Oct 2026). Neo-Tokyo, 2048. DR KWEG S WONG is GOOD: one consistent character, brilliant
 * ("devastatingly so") and loved by everyone, never evil, no split personality. He founded TERRORNODE and invented
 * the SOUL CHAIN. Affectionate parody touches: he "established it in 2009", he peer-reviews everything, the patent
 * "for your soul", the software is open source "as long as it's BSV", and THE FALL (the accident, the hacking, the
 * incident with the cow, the trial: vague, never explained).
 * His inventions went OUT OF CONTROL. The EROBOTS (bot, frog-bot, graf-bot, stripey-bot, tech) seized TERRORNODE HQ
 * and hold him HOSTAGE. Every Erobot is an evil CPU enemy. The LIQUID UNIT (the silver liquid-metal robot) is his
 * invention gone mad and the FINAL boss on the roof. It is NOT Kweg. The NINJA PUNK GIRLS are on a mission to RESCUE
 * him and the player fights with them. PG-13. Teams (for later multiplayer): NPG vs EROBOTS.
 * In-world conceit for the 31 Oct stress test: every round the player fires is a real transaction on the record,
 * and in the story it jams the Erobots' control of the TERRORNODE network. Plain words for players: no tech terms.
 * Fictional names only; no real people or companies. bCorp is not in the story.
 *
 * KWEG'S TEXT IS ALL IN `KWEG` BELOW (and nowhere else), because he gets upgraded for the bMovie "KWEG". His
 * character comes from kwegwong.com: Professor Doctor Sir Kweg S Wong esq., a deadpan academic who peer-reviews
 * everything and "established it in 2009". Round spectacles, striped engineer's cap, red bow tie, knitted vest.
 * Here he is the hostage on the radio: dry, polite, unflappable pleas and review comments.
 */

export const GAME_TITLE = 'ASSAULT ON TERRORNODE';
export const GAME_KICKER = 'TOKENBLASTER SHOOTING GALLERY';
export const SETTING = 'NEO-TOKYO · 2048';

/** One paragraph. What the player is doing and why. */
export const PREMISE =
  'Neo-Tokyo, 2048. DR KWEG S WONG is brilliant, devastatingly so, and everyone loves him. He founded TERRORNODE and invented the SOUL CHAIN. Then his inventions went out of control. The EROBOTS seized TERRORNODE HQ and are holding him hostage, and the LIQUID UNIT, his own creation gone mad, guards the roof. The NINJA PUNK GIRLS are on a mission to rescue him, and you have joined them with a rotary gun and a pocket of coins. Every round you fire goes on the record and jams the Erobots’ control of the network. Fire enough, and the tower falls silent. Stop firing, and you are dead.';

/** Short lines for banners, shares and the lobby. */
export const TAGLINES = [
  'Every round goes on the record.',
  'Storm TERRORNODE HQ. Rescue Dr Kweg.',
  'The city never sleeps. Neither does the gun.',
  'Four stages up. One very polite hostage.',
  'Rescue accepted, with required revisions.',
  'Burn the coins. Break the machine.',
] as const;
export const TAGLINE = TAGLINES[0];

/** TERRORNODE's corporate slogans (satire, deadpan). English first, then the short katakana line on the street ads. */
export const TERRORNODE_SLOGANS = [
  { en: 'TERRORNODE has developed a revolutionary new patent… for your soul.', jp: 'あなたの魂に特許を' },
  { en: 'TERRORNODE’s software is all open source, so you’re free to use it to build on any chain you like… as long as it’s BSV.', jp: 'どのチェーンでも。BSVなら。' },
  { en: 'SOUL CHAIN™: the chain your patented soul is stored on. (chain of tools)', jp: 'ソウルチェーン' },
] as const;

// ── DR KWEG S WONG: every word he says lives here ───────────────────────────────────────

export const KWEG = {
  id: 'kweg',
  name: 'DR KWEG S WONG',
  fullName: 'Professor Doctor Sir Kweg S Wong esq.',
  role: 'Founder of TERRORNODE · Inventor of SOUL CHAIN · Hostage',
  look: 'Round spectacles, a striped engineer’s cap, a red bow tie and a knitted vest under a lab coat. A tablet in one hand, a magnifying glass in the other. Currently tied to a chair.',
  bio: 'Professor Doctor Sir Kweg S Wong esq. is brilliant, devastatingly so, and loved by everyone who has met him. He established TERRORNODE in 2009 (he will mention this), invented the SOUL CHAIN, and peer-reviews everything he sees, including his own kidnapping. There was an accident, and a hacking, and an incident with the cow, and a trial. Nobody has ever explained any of it, and he does not intend to start. Lately his inventions went out of control, and the Erobots took his tower with him in it.',
  threat: 'On your side. He is held on the top floor and talks to you over the radio: dry pleas, review comments and the occasional correction.',
  /** Spoken on the loading screen and the briefing. */
  intro: 'This is Dr Wong. I am being held hostage on the top floor of a building I established in 2009. I did not authorise this.',
  /** One per stage, in order: the radio as the stage opens. */
  stages: [
    'Rescue accepted, with required revisions. I can see you from the sixty-first floor. Your aim is under peer review.',
    'The Erobots have taken the lifts. I would like it noted that I installed the lifts. Please do not shoot the labs, they are peer-reviewed.',
    'That is the core. It runs the SOUL CHAIN, and also the coffee machine. Please jam the first one.',
    'Ah. That is the Liquid Unit. I built him. In my defence, his safety review was scheduled for Thursday.',
  ],
  /** One per stage, when it is cleared and the lift arrives. */
  clear: [
    'The street is secure. Revisions: fewer fires.',
    'The labs are clear. I peer-reviewed every one of those windows.',
    'The core is jammed. My claims are fully verifiable. Verification is available on request. Requests are not.',
  ],
  /** The final boss walks in. */
  boss: 'Please do not be alarmed. He is a prototype. He has not passed review.',
  /** The Liquid Unit melts. */
  melt: 'That was a phase transition. Please cite it correctly.',
  /** Freed: the cutscene beat and the results screen. */
  rescued: 'Rescue complete. Verdict: accepted, with required revisions. Thank you. I established this roof in 2009.',
  rescuedSub: 'He is looking for a pen. He would like to sign the paperwork.',
  /** The player is flatlined. */
  flatlined: 'Cause of death: insufficient peer review. Insert coin to appeal. I will be here.',
  /** Game over. */
  over: 'Peer review verdict: your gun is empty. REJECTED, pending further coins. I will wait.',
  /** Share-card sign-off and loading line. */
  signoff: 'Respectfully, Dr K S Wong (hostage).',
  loading: 'Please wait. The lift is arriving.',
} as const;

// ── Lore beats (shown one at a time on the loading screen, in this order) ──────────────

export type LoreBeat = { id: string; title: string; line: string; /** The CHARACTERS id whose bio card sits beside this beat. */ focus: string };
export const LORE: LoreBeat[] = [
  { id: 'city', title: 'NEO-TOKYO, 2048', line: 'Rain on neon. Hover traffic stacked twelve lanes high. Ninety million people, and every one of them is being counted.', focus: 'gunner' },
  { id: 'kweg', title: 'DR KWEG S WONG', line: 'Brilliant. Devastatingly so. Everyone loves him. ' + KWEG.intro, focus: 'kweg' },
  { id: 'fall', title: 'THE FALL', line: 'There was the accident, and the hacking, and the incident with the cow, and the trial, and all that. Nobody has explained any of it. Ugly situation. He remains brilliant.', focus: 'kweg' },
  { id: 'terrornode', title: 'TERRORNODE', line: 'He founded TERRORNODE and invented the SOUL CHAIN. Its black glass tower is the headquarters, and it is where he is being held.', focus: 'kweg' },
  { id: 'patent', title: 'THE PATENT', line: TERRORNODE_SLOGANS[0].en + ' It is stored on SOUL CHAIN™ (chain of tools). ' + TERRORNODE_SLOGANS[1].en, focus: 'kweg' },
  { id: 'control', title: 'OUT OF CONTROL', line: 'His inventions went out of control. The Erobots seized the tower floor by floor, and a silver giant of liquid metal, his own creation, stands guard on the roof.', focus: 'liquid' },
  { id: 'army', title: 'THE EROBOT ARMY', line: 'Rotor bots in the air, frog bots in the gutters, graf bots on the glass, stripey bots in the doorways and techs in the server rooms. Every one rushes you, and every one is evil.', focus: 'frog' },
  { id: 'girls', title: 'THE NINJA PUNK GIRLS', line: 'On a mission to rescue him. Neon hair, sharp blades and no patience. They need a gunner who keeps the trigger down and the gun moving.', focus: 'npg' },
  { id: 'liquid', title: 'THE LIQUID UNIT', line: 'It was meant to clean up after disasters. Something in it went mad. Seven metres of living silver with one red eye, and it is not Kweg, whatever the Erobots say.', focus: 'liquid' },
  { id: 'record', title: 'THE RECORD', line: 'Every round you fire is written where nobody can erase it, and every one jams the Erobots’ control of the tower. Fire at the Unit and it is pushed back. Stop, and it walks right through you.', focus: 'liquid' },
];

// ── Characters ──────────────────────────────────────────────────────────────────────────

export type CharacterKind = 'hero' | 'hostage' | 'boss' | 'erobot';
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
    bio: 'Used to fix hover-trams across Neo-Tokyo. Let go by a text message. Kept the keys to the old armoury and one very big gun. The Ninja Punk Girls took one look and said the trigger is yours.',
    threat: 'You. A rotary gun that never jams while there are rounds in it.',
    colour: '#ffb21a',
    portrait: '/gallery/characters/gunner.webp',
  },
  {
    id: 'npg',
    name: 'THE NINJA PUNK GIRLS',
    role: 'Rescue team · Team NPG',
    kind: 'hero',
    bio: 'Neon hair, sharp blades and a van with no brakes. They know every back alley and every way into the tower. They are here to get Dr Wong out. You keep the guns loud so they can reach the top floor.',
    threat: 'On your side. They keep the way clear while you hold the trigger.',
    colour: '#ff2f92',
    portrait: '/gallery/characters/npg.webp',
  },
  {
    id: 'kweg',
    name: KWEG.name,
    role: KWEG.role,
    kind: 'hostage',
    bio: KWEG.bio,
    threat: KWEG.threat,
    colour: '#ffb21a',
    portrait: '/gallery/characters/kweg.webp',
    shot: '/gallery/loading/kweg.webp',
  },
  {
    id: 'liquid',
    name: 'THE LIQUID UNIT',
    role: 'Final boss · an invention gone mad',
    kind: 'boss',
    bio: 'One of Dr Wong’s inventions: seven metres of living mercury with one red eye, built to clean up after disasters. Something went wrong with it, and now it guards the roof for the Erobots. Shoot it apart and it melts into the floor. It does not tire and it does not hurry, until you stop firing.',
    threat: 'Charges, lunges and smashes anything in reach. Sustained fire pushes it back; ease off and it closes the gap fast.',
    colour: '#dfe8f5',
    portrait: '/gallery/characters/liquid.webp',
    shot: '/gallery/loading/boss-v2.webp',
  },
  {
    id: 'bot',
    name: 'BOT',
    role: 'Rotor drone',
    kind: 'erobot',
    bio: 'The standard EROBOT. A camera, four rotors and a fear of heights it was never given. One of Dr Wong’s inventions, out of control. Cheap, loud, and there are thousands.',
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
    threat: 'Leaps across the floor in long arcs. Hard to track, easy to pop.',
    colour: '#c8ff1a',
    portrait: '/gallery/characters/frog-bot.webp',
  },
  {
    id: 'graf',
    name: 'GRAF-BOT',
    role: 'Wall tagger',
    kind: 'erobot',
    bio: 'A spray-can arm and a dented head. It paints over every sign that is not the Erobots’. It thinks it is an artist. It is not.',
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
 * Shots show in this order and loop. The `-v2` renders are the TERRORNODE-branded set, drawn by the game engine.
 */
export type LoadingShot = { src: string; beat: string; focus?: string; pos?: string; caption?: string };
export const LOADING_SHOTS: LoadingShot[] = [
  { src: '/gallery/loading/street-left-v2.webp', beat: 'city', focus: 'gunner', pos: '50% 50%', caption: 'Neo-Tokyo, 01:14' },
  { src: '/gallery/loading/tower-v2.webp', beat: 'terrornode', focus: 'kweg', pos: '50% 50%', caption: 'TERRORNODE HQ' },
  { src: '/gallery/loading/street-right-v2.webp', beat: 'army', focus: 'frog', pos: '60% 50%', caption: 'The Erobots hold the street' },
  { src: '/gallery/loading/floors-v2.webp', beat: 'control', focus: 'tech', pos: '50% 50%', caption: 'HQ floors' },
  { src: '/gallery/loading/core-v2.webp', beat: 'record', focus: 'npg', pos: '50% 50%', caption: 'Jam the core' },
  { src: '/gallery/loading/boss-v2.webp', beat: 'liquid', focus: 'liquid', pos: '55% 50%', caption: 'The Liquid Unit' },
  { src: '/gallery/loading/boss-fire-v2.webp', beat: 'record', focus: 'npg', pos: '60% 50%', caption: 'Open fire' },
  { src: '/gallery/loading/roof-v2.webp', beat: 'fall', focus: 'kweg', pos: '50% 50%', caption: 'The roof. The hostage.' },
  { src: '/gallery/loading/muzzle-v2.webp', beat: 'girls', focus: 'npg', pos: '62% 50%', caption: 'Hold the trigger' },
  // ── Slots for new renders (skipped until the file exists) ──
  { src: '/gallery/loading/kweg.webp', beat: 'kweg', focus: 'kweg', pos: '50% 40%', caption: 'Dr Kweg S Wong' },
  { src: '/gallery/loading/npg.webp', beat: 'girls', focus: 'npg', pos: '50% 50%', caption: 'The Ninja Punk Girls' },
  { src: '/gallery/loading/erobots.webp', beat: 'army', focus: 'bot', pos: '50% 50%', caption: 'Erobots on the street' },
  { src: '/gallery/loading/graf-bot.webp', beat: 'army', focus: 'graf', pos: '50% 50%', caption: 'Graf-bot at work' },
  { src: '/gallery/loading/tech.webp', beat: 'army', focus: 'tech', pos: '50% 50%', caption: 'Tech in the server room' },
  { src: '/gallery/loading/stripey-bot.webp', beat: 'army', focus: 'stripey', pos: '50% 50%', caption: 'Stripey-bot holds the line' },
  { src: '/gallery/loading/liquid-melt.webp', beat: 'record', focus: 'liquid', pos: '50% 60%', caption: 'It melts. It stays down.' },
];

// ── Stages ──────────────────────────────────────────────────────────────────────────────

export type StageBrief = { n: number; code: string; place: string; title: string; brief: string; intel: string; goal: string; kweg: string };
const STAGES: Omit<StageBrief, 'kweg'>[] = [
  { n: 1, code: 'STAGE 1 · STREET', place: 'THE STREET', title: 'STORM THE HQ', brief: 'The Erobots hold the street outside TERRORNODE HQ. Keep the trigger down, sweep the gun across whatever is shooting at you and clear the way to the lobby doors.', intel: 'You can die. Erobots die fast. Keep the aim moving.', goal: 'Stop the Erobots' },
  { n: 2, code: 'STAGE 2 · HQ FLOORS', place: 'HQ FLOORS', title: 'THE LABS', brief: 'Offices, glass labs and server racks, and an Erobot behind every desk. Some run wide to flank. Smash the labs, drop the racks and clear every floor on the way up.', intel: 'Rushers hit hard up close. Shoot their bolts out of the air.', goal: 'Clear the floors' },
  { n: 3, code: 'STAGE 3 · SERVER CORE', place: 'SERVER CORE', title: 'JAM THE CORE', brief: 'A shaft of glowing racks and the core that runs the Erobots. Sustained fire on the core jams their control of the whole tower. Keep the trigger down and do not let up.', intel: 'The core recovers when you stop. Sustained fire only.', goal: 'Jam the core' },
  { n: 4, code: 'STAGE 4 · ROOFTOP', place: 'THE ROOFTOP', title: 'THE LIQUID UNIT', brief: 'One floor left, and the roof is the last place anyone wanted to be. The Liquid Unit stands between you and Dr Wong. Hold the trigger: fire pushes it back, and stopping lets it in.', intel: 'Heavy hitter. It staggers under sustained fire. Do not stop.', goal: 'Bring down the Liquid Unit' },
];
/** The briefing for stage n (1 to 4; out of range clamps). Dr Wong's radio line comes from KWEG. */
export function stageBrief(n: number): StageBrief {
  const i = Math.min(STAGES.length, Math.max(1, Math.floor(n))) - 1;
  return { ...STAGES[i], kweg: KWEG.stages[i] };
}
export const STAGE_COUNT = STAGES.length;

// ── Banners ─────────────────────────────────────────────────────────────────────────────

export const BANNERS = {
  loaded: { top: 'GUN LOADED.', bottom: 'LIVE ROUNDS', sub: 'Every round you fire is on the record.' },
  boss: { top: 'FINAL BOSS', sub: 'THE LIQUID UNIT', kweg: KWEG.boss },
  rescued: { top: 'RESCUED', sub: 'Dr Kweg S Wong is free', kweg: KWEG.rescued },
} as const;

/** The lift between stages: the line under the floor counter. */
export const TRANSITION = { up: 'GOING UP', floors: ['LOBBY', 'FLOOR 14 · LABS', 'SERVER CORE', 'ROOF'] as const } as const;

// ── Loadout: MISSION BRIEFING ───────────────────────────────────────────────────────────

export const BRIEFING = {
  heading: 'MISSION BRIEFING',
  code: 'ASSAULT ON TERRORNODE · NEO-TOKYO 2048 · TEAM NPG vs TEAM EROBOTS',
  from: 'The Ninja Punk Girls',
  objective: 'Storm TERRORNODE HQ. Rescue Dr Kweg. Four stages: the street, the HQ floors, the server core and the roof, where the Liquid Unit waits. You have 100 health: stay alive.',
  rules: [
    'Hold the trigger to fire. Every round is real and goes on the record.',
    'Clear the Erobots to move up a stage. In the server core, sustained fire on the core jams the whole tower.',
    'The Liquid Unit is pushed back by sustained fire. Stop and it closes in fast. Erobots shoot and swing: keep the gun moving.',
    'Smash the glass, drop the racks and clear the Erobots for points.',
    'No refunds. Only put in what you want to spend.',
  ],
} as const;

// ── Game over ───────────────────────────────────────────────────────────────────────────

export type Rank = { min: number; title: string; line: string };
/** By rounds fired, highest first. */
export const RANKS: Rank[] = [
  { min: 1_000_000, title: 'NETWORK BREAKER', line: 'A million rounds on the record. The Erobots’ network is a smoking hole.' },
  { min: 100_000, title: 'LIGHTS OUT', line: 'The lights are going out across TERRORNODE.' },
  { min: 10_000, title: 'TOWER SHAKER', line: 'The tower felt every one of those.' },
  { min: 1_000, title: 'NEON HERO', line: 'A good night’s work. The Ninja Punk Girls are impressed.' },
  { min: 100, title: 'STREET FIGHTER', line: 'You made some noise. Come back with more coins.' },
  { min: 0, title: 'ROOKIE', line: 'The night is long. Load up and try again.' },
];
export const rankFor = (rounds: number): Rank => RANKS.find((r) => rounds >= r.min) ?? RANKS[RANKS.length - 1];

/** The player dies (health at 0): the arcade CONTINUE? screen. */
export const FLATLINED = {
  title: 'FLATLINED',
  line: 'The Erobots take another gunner.',
  kweg: KWEG.flatlined,
  prompt: 'CONTINUE?',
  coin: 'Insert coins to continue',
  keep: 'Your loaded rounds stay in the gun. New coins add to them.',
  over: 'GAME OVER',
} as const;

export const GAME_OVER = {
  title: 'OUT OF ROUNDS',
  line: 'The gun is empty. The Erobots still hold the tower, and Dr Wong is still upstairs.',
  kweg: KWEG.over,
  next: 'The next coin is on you.',
} as const;

/** The rescue is done: the results screen heading and its lines. */
export const RESCUED = {
  title: 'RESCUED',
  line: 'Dr Kweg S Wong is free, the Liquid Unit is down and TERRORNODE HQ is quiet. The Ninja Punk Girls are already arguing about the van.',
  kweg: KWEG.rescued,
  sub: KWEG.rescuedSub,
  next: 'Mission complete. The next coin starts it again.',
} as const;

/** The text a player shares. Plain words. */
export function shareText(p: { rounds: number; score: number; stage: number; rescued?: boolean; name?: string | null }): string {
  const who = p.name ? `@${p.name} fired` : 'I fired';
  const end = p.rescued ? 'rescued Dr Kweg S Wong' : `reached stage ${p.stage}`;
  return `${who} ${p.rounds.toLocaleString('en-US')} rounds at the Erobots holding TERRORNODE HQ in Neo-Tokyo, ${end} and scored ${p.score.toLocaleString('en-US')}. Every round is on the record. Beat that.`;
}

// ── Tips ────────────────────────────────────────────────────────────────────────────────

export const TIPS: string[] = [
  'Hold the trigger. Every round is real.',
  'Fire at the Liquid Unit to push it back. Stop, and it closes in.',
  'Shoot the red bolts out of the air, or take the hit.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the glass labs for extra points.',
  'In the server core, sustained fire is the only thing that jams it.',
  'Drop the server racks before Tech can repair them.',
  'The more coins you put in, the more rounds you get.',
  'Lead the Frog-bots. They land where you were.',
];

// ── Free play / dry run: honest copy ─────────────────────────────────────────────────────
// In free play (and the dev dry run) nothing is paid, signed, broadcast or counted on chain, and the words LIVE,
// "on chain", "on the record", "real transaction" and "accepted" must never describe the player's own rounds.
// Every player-visible string above that says so goes through `forPractice` when the game is simulated.
// (The hostage's "accepted, with required revisions" is a peer-review joke about the rescue, not about rounds.)

export const PRACTICE = {
  badge: 'PRACTICE · nothing on chain',
  kicker: 'FREE PLAY · PRACTICE',
  loaded: { top: 'GUN LOADED.', bottom: 'PRACTICE ROUNDS', sub: 'Free play: practice rounds, nothing goes on chain.' },
  nothing: 'Free play: nothing is paid and nothing goes on chain.',
  warmup: 'Getting your practice rounds ready…',
  results: 'Practice run: nothing was paid or sent, so there is no proof to check.',
} as const;

const SWAPS: [RegExp, string][] = [
  [/Every round goes on the record\./g, 'Practice rounds: nothing goes on chain.'],
  [/Every round you fire goes on the record and jams the Erobots’ control of the network\./g, 'Every practice round you fire jams the Erobots’ control of the network, in the story.'],
  [/Every round you fire is on the record\./g, 'Free play: practice rounds, nothing goes on chain.'],
  [/Every round you fire is written where nobody can erase it, and every one jams the Erobots’ control of the tower\./g, 'In the story, every round you fire jams the Erobots’ control of the tower. This is free play: practice rounds, nothing goes on chain.'],
  [/Hold the trigger to fire\. Every round is real and goes on the record\./g, 'Hold the trigger to fire. Free play: practice rounds, nothing goes on chain.'],
  [/Hold the trigger\. Every round is real\./g, 'Hold the trigger. These are practice rounds.'],
  [/A million rounds on the record\./g, 'A million practice rounds.'],
  [/Every round is on the record\. Beat that\./g, 'Free play, practice rounds. Beat that.'],
  [/\bLIVE ROUNDS\b/g, 'PRACTICE ROUNDS'],
];
/** Free-play wording for a story string (identity for strings that never mention the record). */
export function forPractice(s: string): string {
  let o = s;
  for (const [re, to] of SWAPS) o = o.replace(re, to);
  return o;
}

/** Everything a player can read in free play, for the unit test and for audits. */
export function practiceCopy(): string[] {
  const stages = Array.from({ length: STAGE_COUNT }, (_, i) => {
    const b = stageBrief(i + 1);
    return [b.code, b.place, b.title, b.brief, b.intel, b.goal, b.kweg];
  }).flat();
  return [
    GAME_TITLE, GAME_KICKER, SETTING, PREMISE, ...TAGLINES, PRACTICE.badge, PRACTICE.kicker, PRACTICE.nothing, PRACTICE.warmup, PRACTICE.results, ...stages,
    ...LORE.flatMap((l) => [l.title, l.line]),
    ...CHARACTERS.flatMap((c) => [c.name, c.role, c.bio, c.threat]),
    ...Object.values(PRACTICE.loaded), BANNERS.boss.top, BANNERS.boss.sub, BANNERS.boss.kweg, BANNERS.rescued.top, BANNERS.rescued.sub, BANNERS.rescued.kweg,
    BRIEFING.heading, BRIEFING.code, BRIEFING.objective, ...BRIEFING.rules, ...RANKS.flatMap((r) => [r.title, r.line]),
    ...Object.values(FLATLINED), ...Object.values(GAME_OVER), ...Object.values(RESCUED), ...TIPS,
    ...(Object.values(KWEG) as unknown[]), ...KWEG.stages, ...KWEG.clear,
    shareText({ rounds: 1234, score: 99, stage: 2, name: 'x' }),
  ]
    .filter((x): x is string => typeof x === 'string')
    .map((x) => forPractice(x));
}
