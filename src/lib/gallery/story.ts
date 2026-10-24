/**
 * NEO-TOKYO BLACKOUT: the story of the TokenBlaster Shooting Gallery. Pure data and copy (no React, no browser),
 * so the loading screen, the loadout ("MISSION BRIEFING"), the wave banners, the game-over screen and the
 * tests all read the same words.
 *
 * Settled by the owner (24 Oct 2026): Neo-Tokyo, 2048. DR KWEG WONG, a mad scientist and CEO of the megacorp
 * nSLAVE, invented the EROBOTS (bot, frog-bot, graf-bot, stripey-bot, tech) and wants the whole city. THE TWIST:
 * the silver liquid-metal boss, the LIQUID UNIT, IS Dr Kweg Wong himself, changed when one of his own experiments
 * went wrong. He still thinks he is the CEO and still peer-reviews everything. The NINJA PUNK GIRLS fight him and
 * the player joins them. bCorp (not evil, just corporate: Project EROBOT was its security experiment that went
 * wrong) versus nSLAVE (the rival megacorp whose black tower Kweg runs). Original, PG-13.
 * nSLAVE's corporate slogans are deadpan satire and appear on the street ads too: "a revolutionary new patent…
 * for your soul", and open source "on any chain you like… as long as it's BSV".
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
  'Neo-Tokyo, 2048. Rain on neon, hover traffic stacked twelve lanes high, and one mad professor with the keys to a robot army. DR KWEG WONG built the EROBOTS for bCorp as a security experiment. It went wrong, so he became CEO of the megacorp nSLAVE, took over its black tower, and now he wants the whole city. Then one of his own experiments went wrong too: the silver liquid giant stalking the street is Kweg himself. The NINJA PUNK GIRLS are the only ones fighting back, and you have just joined them with a rotary gun and a pocket of coins. Every round you fire goes on the record and jams his robot network. Fire enough, and the tower goes dark. Stop firing, and you are dead.';

/** Short lines for banners, shares and the lobby. */
export const TAGLINES = [
  'Every round goes on the record.',
  'Jam the network. Keep the lights off.',
  'The city never sleeps. Neither does the gun.',
  'One gun. One tower. One very liquid professor.',
  'He pours himself back together. Keep firing.',
  'Burn the coins. Break the machine.',
] as const;
export const TAGLINE = TAGLINES[0];

/** nSLAVE's corporate slogans (satire, deadpan). English first, then the short katakana line on the street ads. */
export const NSLAVE_SLOGANS = [
  { en: 'nSLAVE has developed a revolutionary new patent… for your soul.', jp: 'あなたの魂に特許を' },
  { en: 'nSLAVE’s software is all open source, so you’re free to use it to build on any chain you like… as long as it’s BSV.', jp: 'どのチェーンでも。BSVなら。' },
  { en: 'SOUL CHAIN™: the chain your patented soul is stored on. (chain of tools)', jp: 'ソウルチェーン' },
] as const;

// ── DR KWEG WONG: every word he says lives here ─────────────────────────────────────────

export const KWEG = {
  id: 'kweg',
  name: 'DR KWEG WONG',
  fullName: 'Professor Doctor Sir Kweg S Wong esq.',
  role: 'Mad scientist · CEO of nSLAVE',
  look: 'Round spectacles, a striped engineer’s cap, a red bow tie and a knitted vest under a lab coat. A tablet in one hand, a magnifying glass in the other. Now and then: a chrome giant with one red eye.',
  bio: 'Professor Doctor Sir Kweg S Wong esq. designed the EROBOTS for bCorp, marked his own work ACCEPTED and kept it, then took the top floor of the nSLAVE tower as its CEO. He is polite, precise and completely certain that he established all of this in 2009. He peer-reviews everything, including you, and he has never once been seen to smile. Lately he is also silver, seven metres tall and made of liquid metal, after Experiment 31. He calls this a temporary state change.',
  threat: 'Runs every Erobot from the top floor, reviews your rounds as they land, and, in his new body, walks down the street to review you in person.',
  /** Spoken on the loading screen, briefing and banners. */
  intro: 'I established this tower in 2009. You are, regrettably, trespassing on a peer-reviewed building.',
  boss: 'Please do not be alarmed by my appearance. It is a temporary state change, pending review.',
  /** One per wave, in order; the last one repeats with a number. */
  waves: [
    'Your first rounds have been received. Verdict: accepted with required revisions.',
    'I have reassembled myself. The process was reviewed, by me, and found excellent.',
    'nSLAVE has developed a revolutionary new patent… for your soul. Please sign here.',
    'You are hitting my robots very hard. Please note that they are also peer reviewed.',
    'Your soul is safe on SOUL CHAIN™. Our software is open source: build on any chain you like, as long as it is BSV.',
    'My tower is going dark. I would like it noted that I predicted this, in 2009.',
  ],
  overtime: 'Past the end of my paper. I did not plan for this. I did not plan for you.',
  /** The Liquid Unit melts: Kweg's line as he goes down. */
  melt: 'This is not a failure. This is a phase transition. Please cite it correctly.',
  /** And as he pulls himself back up. */
  reform: 'Revision accepted. I am, in the peer-review sense, reformed.',
  /** The player is flatlined. */
  flatlined: 'Cause of death: insufficient peer review. Insert coin to appeal.',
  /** Game over. */
  over: 'Peer review verdict: your gun is empty. REJECTED, pending further coins.',
  /** Share-card sign-off and loading line. */
  signoff: 'Respectfully, the CEO of nSLAVE.',
  loading: 'Please wait. The submarine is surfacing.',
} as const;

// ── Lore beats (shown one at a time on the loading screen, in this order) ──────────────

export type LoreBeat = { id: string; title: string; line: string; /** The CHARACTERS id whose bio card sits beside this beat. */ focus: string };
export const LORE: LoreBeat[] = [
  { id: 'city', title: 'NEO-TOKYO, 2048', line: 'Rain on neon. Hover traffic stacked twelve lanes high. Ninety million people, and every one of them is being counted.', focus: 'gunner' },
  { id: 'bcorp', title: 'PROJECT EROBOT', line: 'bCorp built a robot guard for the city. Nothing evil, just corporate. One consultant wrote the code, and he kept a copy.', focus: 'bot' },
  { id: 'kweg', title: 'DR KWEG WONG', line: KWEG.intro, focus: 'kweg' },
  { id: 'nslave', title: 'THE nSLAVE TOWER', line: 'nSLAVE, bCorp’s richest rival, needed a miracle. Kweg sold it one, then made himself CEO of the whole black glass tower.', focus: 'kweg' },
  { id: 'patent', title: 'THE PATENT', line: NSLAVE_SLOGANS[0].en + ' It is stored on SOUL CHAIN™ (chain of tools). ' + NSLAVE_SLOGANS[1].en, focus: 'kweg' },
  { id: 'army', title: 'THE EROBOT ARMY', line: 'Rotor bots in the air, frog bots in the gutters, graf bots on the glass, stripey bots in the street and techs on the roof to fix them all. Every one rushes you, and every one is his.', focus: 'frog' },
  { id: 'girls', title: 'THE NINJA PUNK GIRLS', line: 'Neon hair, sharp blades and no patience. The only crew in Neo-Tokyo who will say no to a professor. They need a gunner who can keep the trigger down and the gun moving.', focus: 'npg' },
  { id: 'experiment', title: 'EXPERIMENT 31', line: 'Kweg tested his newest machine on himself. It went wrong. The thing walking up the street in chrome, with one red eye and a very polite voice, is the CEO.', focus: 'liquid' },
  { id: 'record', title: 'THE RECORD', line: 'Every round you fire is written where nobody can erase it. Put enough on the record at once and Kweg’s robot network chokes. Fire at him and he is pushed back. Stop, and he walks right through you.', focus: 'liquid' },
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
    role: 'Dr Kweg Wong, after Experiment 31',
    kind: 'boss',
    bio: 'It is Dr Kweg Wong. Experiment 31 turned the professor into a seven-metre body of living mercury with one red eye, and he has not noticed anything wrong beyond the formatting. Shoot him apart and he melts into the street, then pulls himself back up a little harder. He does not tire and he does not hurry, until you stop firing.',
    threat: 'Charges, lunges and smashes anything in reach. Sustained fire pushes him back; ease off and he closes the gap fast. Returns every wave with more health.',
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
  { src: '/gallery/loading/tower.webp', beat: 'nslave', focus: 'kweg', pos: '50% 50%', caption: 'The nSLAVE tower' },
  { src: '/gallery/loading/street-right.webp', beat: 'army', focus: 'frog', pos: '60% 50%', caption: 'The Erobots wake' },
  { src: '/gallery/loading/boss.webp', beat: 'experiment', focus: 'liquid', pos: '55% 50%', caption: 'Dr Kweg, after Experiment 31' },
  { src: '/gallery/loading/boss-fire.webp', beat: 'record', focus: 'npg', pos: '60% 50%', caption: 'Open fire' },
  { src: '/gallery/loading/muzzle.webp', beat: 'girls', focus: 'npg', pos: '62% 50%', caption: 'Hold the trigger' },
  // ── Slots for new renders (skipped until the file exists) ──
  { src: '/gallery/loading/kweg.webp', beat: 'kweg', focus: 'kweg', pos: '50% 40%', caption: 'Dr Kweg Wong' },
  { src: '/gallery/loading/npg.webp', beat: 'girls', focus: 'npg', pos: '50% 50%', caption: 'The Ninja Punk Girls' },
  { src: '/gallery/loading/erobots.webp', beat: 'army', focus: 'bot', pos: '50% 50%', caption: 'Erobots on the street' },
  { src: '/gallery/loading/graf-bot.webp', beat: 'army', focus: 'graf', pos: '50% 50%', caption: 'Graf-bot at work' },
  { src: '/gallery/loading/tech.webp', beat: 'army', focus: 'tech', pos: '50% 50%', caption: 'Tech on the roof' },
  { src: '/gallery/loading/stripey-bot.webp', beat: 'army', focus: 'stripey', pos: '50% 50%', caption: 'Stripey-bot holds the line' },
  { src: '/gallery/loading/liquid-melt.webp', beat: 'record', focus: 'liquid', pos: '50% 60%', caption: 'He melts. He returns.' },
  { src: '/gallery/loading/bcorp.webp', beat: 'bcorp', pos: '50% 50%', caption: 'Project EROBOT' },
];

// ── Waves ───────────────────────────────────────────────────────────────────────────────

export type WaveBrief = { n: number; code: string; title: string; brief: string; intel: string; boss: string; kweg: string };
const WAVES: Omit<WaveBrief, 'kweg'>[] = [
  { n: 1, code: 'STREET LEVEL', title: 'FIRST CONTACT', brief: 'Erobots pour out of the lobby and the Liquid Unit walks up the street. Keep the trigger down and sweep the gun across whatever is shooting at you.', intel: 'You can die. Erobots die fast. Fire at the Unit and it is pushed back; stop and it closes in.', boss: 'The Liquid Unit, Dr Kweg himself, has stepped out of the lobby.' },
  { n: 2, code: 'SERVER FLOOR', title: 'THE REBUILD', brief: 'The professor poured himself back together and the Erobots are rushing you. Some run wide to flank. Drop every rack before Tech repairs it.', intel: 'Rushers hit hard up close. Shoot their bolts out of the air.', boss: 'He is back, half as tough again.' },
  { n: 3, code: 'SKY LANE', title: 'THE PATENT', brief: 'nSLAVE has patented your soul and sent graf-bots to paint over the glass. Frog-bots leap the gutters. Keep firing and keep moving your aim.', intel: 'Frog-bots land where you were. Lead them.', boss: 'Kweg walks in through the paint, over twice as tough.' },
  { n: 4, code: 'LOCKDOWN', title: 'STRIPES', brief: 'The Stripey-bots have blocked the street and the Unit is hitting like a train. Hold the trigger and keep him at arm’s length.', intel: 'Heavy plating. Sustained fire only.', boss: 'He steps out from behind the shields, three times as tough.' },
  { n: 5, code: 'THE VAULT', title: 'NETWORK JAM', brief: 'Everything Kweg has is out. The more rounds you put on the record, the harder his robot network chokes. Do not stop.', intel: 'Every round counts. Faster is better.', boss: 'The Unit is five times as tough as when you started.' },
  { n: 6, code: 'ROOFTOP', title: 'LIGHTS OUT', brief: 'One floor left. The professor is throwing everything he has, including himself. Burn through your last coins and take the lights out.', intel: 'No more patches. No more reloads from him.', boss: 'He will not stop. Neither should you.' },
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
    brief: 'Past the end of the plan. Kweg keeps pouring himself back together and you keep shooting. How long can you stay alive and keep his network jammed?',
    intel: 'Nothing new to learn. Hold the trigger.',
    boss: `The Unit is ${bossGrowth(w)}% tougher than at the start.`,
    kweg: KWEG.overtime,
  };
}
export const WAVE_COUNT = WAVES.length;

// ── Banners ─────────────────────────────────────────────────────────────────────────────

export const BANNERS = {
  loaded: { top: 'GUN LOADED.', bottom: 'LIVE ROUNDS', sub: 'Every round you fire is on the record.' },
  boss: { top: 'BOSS INCOMING', sub: 'THE LIQUID UNIT · DR KWEG WONG', kweg: KWEG.boss },
} as const;

// ── Loadout: MISSION BRIEFING ───────────────────────────────────────────────────────────

export const BRIEFING = {
  heading: 'MISSION BRIEFING',
  code: 'OPERATION BLACKOUT · NEO-TOKYO 2048',
  from: 'The Ninja Punk Girls',
  objective: 'Fight your way up the nSLAVE tower, jam Dr Kweg Wong’s robot network, and keep the Liquid Unit (that is Kweg) down. You have 100 health: stay alive.',
  rules: [
    'Hold the trigger to fire. Every round is real and goes on the record.',
    'The Liquid Unit is pushed back by sustained fire. Stop and he closes in fast. Erobots shoot and swing: keep the gun moving.',
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

/** The player dies (health at 0): the arcade CONTINUE? screen. */
export const FLATLINED = {
  title: 'FLATLINED',
  line: 'The street takes another gunner.',
  kweg: KWEG.flatlined,
  prompt: 'CONTINUE?',
  coin: 'Insert coins to continue',
  keep: 'Your loaded rounds stay in the gun. New coins add to them.',
  over: 'GAME OVER',
} as const;

export const GAME_OVER = {
  title: 'OUT OF ROUNDS',
  line: 'The gun is empty. Dr Kweg is still standing, and so is the tower.',
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
  'Fire at the Liquid Unit to push him back. Stop, and he closes in.',
  'Shoot the red bolts out of the air, or take the hit.',
  'LOCK TRIGGER keeps firing without holding.',
  'Smash the tower glass for extra points.',
  'Drop the server racks before Tech can repair them.',
  'The more coins you put in, the more rounds you get.',
  'Lead the Frog-bots. They land where you were.',
];
