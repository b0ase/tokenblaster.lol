/**
 * ESCAPE FROM TERRORNODE: the story of the TokenBlaster Shooting Gallery. Pure data and copy (no React, no browser),
 * so the loading screen, the loadout ("MISSION BRIEFING"), the stage banners, the game-over screen and the
 * tests all read the same words.
 *
 * CANON (owner, 24 Oct 2026). Neo-Tokyo, 2048. DR KWEG S WONG is GOOD: one consistent character, brilliant
 * ("devastatingly so") and loved by everyone, never evil, no split personality. He invented the Erobotz and
 * the SOUL CHAIN. Affectionate parody touches: he "established it in 2009", he peer-reviews everything, the patent
 * "for your soul", the software is open source "as long as it's BSV", and THE FALL (the accident, the hacking, the
 * incident with the cow, the trial: vague, never explained).
 * NEW STORY (owner, 27 Oct 2026, TERRORNODE-NPG-SPEC): his inventions, the EROBOTZ (bot, frog-bot, graf-bot,
 * stripey-bot, tech), went crazy, seized the nSLAVE corporation and hold him HOSTAGE at its centre, TERRORNODE. The
 * NINJA PUNK GIRLS blast in to free him (Act 1, STORM THE NODE: street, HQ floors, the core, where he is cut loose),
 * then fight out with him while he keeps running the wrong way (Act 2, ESCAPE FROM TERRORNODE: the roof, the Liquid Unit, the helipad). The corporate
 * satire is nSLAVE's. Enemies are "Erobotz" in all text. The LIQUID UNIT is his invention gone mad, NOT Kweg. 17+
 * violence (blood in Act 2), no sexual content. NPG IP: "A Ninja Punk Girls game".
 * In-world conceit for the 31 Oct stress test: every round the player fires is a real transaction on the record,
 * and in the story it jams the Erobotz' control of the network. Plain words for players: no tech terms.
 * Fictional names only; no real people or companies. bCorp is not in the story.
 *
 * KWEG'S TEXT IS ALL IN `KWEG` BELOW (and nowhere else), because he gets upgraded for the bMovie "KWEG". His
 * character comes from kwegwong.com: Professor Doctor Sir Kweg S Wong esq., a deadpan academic who peer-reviews
 * everything and "established it in 2009". Round spectacles, striped engineer's cap, red bow tie, knitted vest.
 * Here he is the hostage on the radio: dry, polite, unflappable pleas and review comments.
 */

export const GAME_TITLE = 'WELCOME TO TERRORNODE';
export const GAME_KICKER = 'TOKENBLASTER SHOOTING GALLERY';
export const SETTING = 'NEO-TOKYO · 2048';
/** The launch call to action (owner, 27 Oct 2026): the START label wherever a call to action fits. */
export const CTA = 'STORM THE NODE';
/** The brand credit (NPG IP): small, in the footer and the credits. */
export const CREDIT = 'A Ninja Punk Girls game';

/** One paragraph. What the player is doing and why. */
export const PREMISE =
  'Neo-Tokyo, 2048. DR KWEG S WONG is brilliant, devastatingly so, and everyone loves him. The evil EROBOTZ have seized the nSLAVE corporation and hold him hostage at its centre, TERRORNODE. The NINJA PUNK GIRLS blast in to free him, and you have joined them with a rotary gun and a pocket of coins. Act 1: storm the node. Act 2: get him out. He keeps running the wrong way. Protect him. Every round you fire goes on the record and jams the Erobotz’ control of the network. Stop firing, and you are dead.';

/** Short lines for banners, shares and the lobby. */
export const TAGLINES = [
  'Every round goes on the record.',
  'Storm the node. Free Dr Kweg. Get out alive.',
  'The city never sleeps. Neither does the gun.',
  'Two acts. One very polite hostage.',
  'Rescue accepted, with required revisions.',
  'Burn the coins. Break the machine.',
] as const;
export const TAGLINE = TAGLINES[0];

/** nSLAVE's corporate slogans (satire, deadpan). English first, then the short katakana line on the street ads. */
export const NSLAVE_SLOGANS = [
  { en: 'nSLAVE has developed a revolutionary new patent… for your soul.', jp: 'あなたの魂に特許を' },
  { en: 'nSLAVE’s software is all open source, so you’re free to use it to build on any chain you like… as long as it’s BSV.', jp: 'どのチェーンでも。BSVなら。' },
  { en: 'SOUL CHAIN™ by nSLAVE: the chain your patented soul is stored on. (chain of tools)', jp: 'ソウルチェーン' },
] as const;
/** Old name, kept so nothing that imported it breaks. */
export const TERRORNODE_SLOGANS = NSLAVE_SLOGANS;

// ── The two acts ────────────────────────────────────────────────────────────────────────

export type Act = { n: 1 | 2; code: string; title: string; line: string; stages: readonly number[] };
/**
 * Act 1 STORM THE NODE: fight IN through the street and the HQ floors to the core at the centre of nSLAVE, where
 * Dr Wong is cut loose. Act 2 ESCAPE FROM TERRORNODE: fight OUT with him (he keeps running the wrong way: protect him), up through the server room to the roof
 * and the helipad, through angrier Erobotz and the Liquid Unit.
 */
export const ACTS: readonly Act[] = [
  { n: 1, code: 'ACT 1', title: 'STORM THE NODE', line: 'Fight your way in to the centre of nSLAVE.', stages: [1, 2, 3] },
  { n: 2, code: 'ACT 2', title: 'ESCAPE FROM TERRORNODE', line: 'He keeps running the wrong way. Protect him.', stages: [4] },
];
/** The act a stage (1 to 4) belongs to. */
export const actOf = (stage: number): Act => (stage >= 4 ? ACTS[1] : ACTS[0]);
/** The beat between the acts: Dr Wong is cut loose at the core. */
export const FREED = { top: 'DR KWEG WONG IS FREE', sub: 'He keeps running the wrong way. Protect him.' } as const;

/** ACT 2 ESCORT: Dr Kweg died on the way out. */
export const KWEG_LOST = { top: 'DR KWEG WONG IS LOST', sub: 'He ran the wrong way once too often. Stay close, and CALL KWEG when he bolts.', retry: 'RETRY ACT 2' } as const;

// ── DR KWEG S WONG: every word he says lives here ───────────────────────────────────────

export const KWEG = {
  id: 'kweg',
  name: 'DR KWEG S WONG',
  fullName: 'Professor Doctor Sir Kweg S Wong esq.',
  role: 'Hostage',
  look: 'Round spectacles, a striped engineer’s cap, a red bow tie and a knitted vest under a lab coat. A tablet in one hand, a magnifying glass in the other. Currently chained to the core.',
  bio: 'Held hostage at the centre of TERRORNODE by the evil Erobotz. Get him out.',
  threat: 'On your side. Held at the core in Act 1, running out with the girls in Act 2 (the wrong way, mostly: protect him). He talks to you over the radio: dry pleas, review comments and the occasional correction.',
  /** Spoken on the loading screen and the briefing. */
  intro: 'This is Dr Wong. I am being held hostage by the Erobotz, whom I invented, in a building I established in 2009. I did not authorise this.',
  /** One per stage, in order: the radio as the stage opens. */
  stages: [
    'Rescue accepted, with required revisions. I can see you from the core cameras. Your aim is under peer review.',
    'The Erobotz have taken the lifts. I would like it noted that I installed the lifts. Please do not shoot the labs, they are peer-reviewed.',
    'I am chained to the core. It runs the SOUL CHAIN, and also the coffee machine. Jam the first one, then untie me.',
    'I am running. I am not sure which way. The helipad is on the roof. So, regrettably, is the Liquid Unit. I built him.',
  ],
  /** One per stage, when it is cleared and the lift arrives. */
  clear: [
    'The street is secure. Revisions: fewer fires.',
    'The labs are clear. I peer-reviewed every one of those windows.',
    'I am free. My claims are fully verifiable. Verification is available on request. Requests are not. Now run.',
  ],
  /** The final boss walks in. */
  boss: 'Please do not be alarmed. He is a prototype. He has not passed review.',
  /** The Liquid Unit melts. */
  melt: 'That was a phase transition. Please cite it correctly.',
  /** Freed: the cutscene beat and the results screen. */
  rescued: 'Escape complete. Verdict: accepted, with required revisions. Thank you. I established this helipad in 2009.',
  rescuedSub: 'He is in the chopper, looking for a pen. He would like to sign the paperwork.',
  /** The player is flatlined. */
  flatlined: 'Cause of death: insufficient peer review. INSERT $b to appeal. I will be here.',
  /** Game over. */
  over: 'Peer review verdict: your gun is empty. REJECTED, pending further coins. I will wait.',
  /** Share-card sign-off and loading line. */
  signoff: 'Respectfully, Dr K S Wong (formerly hostage).',
  loading: 'Please wait. The lift is arriving.',
} as const;

// ── Lore beats (shown one at a time on the loading screen, in this order) ──────────────

export type LoreBeat = { id: string; title: string; line: string; /** The CHARACTERS id whose bio card sits beside this beat. */ focus: string };
export const LORE: LoreBeat[] = [
  { id: 'city', title: 'NEO-TOKYO, 2048', line: 'Rain on neon. Hover traffic stacked twelve lanes high. Ninety million people, and every one of them is being counted.', focus: 'gunner' },
  { id: 'kweg', title: 'DR KWEG S WONG', line: 'Brilliant. Devastatingly so. Everyone loves him. He invented the Erobotz. ' + KWEG.intro, focus: 'kweg' },
  { id: 'fall', title: 'THE FALL', line: 'There was the accident, and the hacking, and the incident with the cow, and the trial, and all that. Nobody has explained any of it. Ugly situation. He remains brilliant.', focus: 'kweg' },
  { id: 'terrornode', title: 'nSLAVE', line: 'The nSLAVE corporation runs the city on the SOUL CHAIN. At its centre is TERRORNODE, the black glass core of its tower, and that is where he is being held.', focus: 'kweg' },
  { id: 'patent', title: 'THE PATENT', line: NSLAVE_SLOGANS[0].en + ' It is stored on SOUL CHAIN™ (chain of tools). ' + NSLAVE_SLOGANS[1].en, focus: 'kweg' },
  { id: 'control', title: 'OUT OF CONTROL', line: 'The evil Erobotz seized nSLAVE floor by floor, chained Dr Kweg to the core, and a silver giant of liquid metal, his own creation, guards the roof.', focus: 'liquid' },
  { id: 'army', title: 'THE EROBOTZ', line: 'Rotor bots in the air, frog bots in the gutters, graf bots on the glass, stripey bots in the doorways and techs in the server rooms. Every one of them rushes you, and every one is evil.', focus: 'frog' },
  { id: 'girls', title: 'THE NINJA PUNK GIRLS', line: 'They blast into the centre of nSLAVE to free him, then get him out while he runs the wrong way. Neon hair, sharp blades and no patience. They need a gunner who keeps the trigger down.', focus: 'npg' },
  { id: 'liquid', title: 'THE LIQUID UNIT', line: 'It was meant to clean up after disasters. Something in it went mad. Seven metres of living silver with one red eye, and it is not Kweg, whatever the Erobotz say.', focus: 'liquid' },
  { id: 'record', title: 'THE RECORD', line: 'Every round you fire is written where nobody can erase it, and every one jams the Erobotz’ control of the tower. Fire at the Unit and it is pushed back. Stop, and it walks right through you.', focus: 'liquid' },
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
   * Portrait render (4:5, at least 640x800, WebP). Set it only once the file is committed under
   * public/gallery/characters/; until then a drawn badge is shown.
   */
  portrait?: string;
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
  },
  {
    id: 'npg',
    name: 'THE NINJA PUNK GIRLS',
    role: 'Rescue team · Team NPG',
    kind: 'hero',
    bio: 'Neon hair, sharp blades and a van with no brakes. They know every back alley and every way into the tower. They are here to free Dr Wong and keep him alive on the way out. You keep the guns loud.',
    threat: 'On your side. They keep the way clear while you hold the trigger.',
    colour: '#ff2f92',
  },
  {
    id: 'kweg',
    name: KWEG.name,
    role: KWEG.role,
    kind: 'hostage',
    bio: KWEG.bio,
    threat: KWEG.threat,
    colour: '#ffb21a',
  },
  {
    id: 'liquid',
    name: 'THE LIQUID UNIT',
    role: 'Final boss · an invention gone mad',
    kind: 'boss',
    bio: 'One of Dr Wong’s inventions: seven metres of living mercury with one red eye, built to clean up after disasters. Something went wrong with it, and now it guards the roof for the Erobotz. Shoot it apart and it melts into the floor. It does not tire and it does not hurry, until you stop firing.',
    threat: 'Charges, lunges and smashes anything in reach. Sustained fire pushes it back; ease off and it closes the gap fast.',
    colour: '#dfe8f5',
    shot: '/gallery/loading/boss.webp',
  },
  {
    id: 'bot',
    name: 'BOT',
    role: 'Rotor drone',
    kind: 'erobot',
    bio: 'The standard EROBOTZ unit. A camera, four rotors and a fear of heights it was never given. One of Dr Wong’s inventions, out of control. Cheap, loud, and there are thousands.',
    threat: 'Swarms in from above. Worth a few points each.',
    colour: '#ff5a4a',
  },
  {
    id: 'frog',
    name: 'FROG-BOT',
    role: 'Gutter jumper',
    kind: 'erobot',
    bio: 'Built for the drains. Springs for legs, a chrome green shell and a habit of landing exactly where you were standing.',
    threat: 'Leaps across the floor in long arcs. Hard to track, easy to pop.',
    colour: '#c8ff1a',
  },
  {
    id: 'graf',
    name: 'GRAF-BOT',
    role: 'Wall tagger',
    kind: 'erobot',
    bio: 'A spray-can arm and a dented head. It paints over every sign that is not the Erobotz’. It thinks it is an artist. It is not.',
    threat: 'Covers the glass in paint, so you have to keep shooting to see.',
    colour: '#ff2f92',
  },
  {
    id: 'stripey',
    name: 'STRIPEY-BOT',
    role: 'Warning-stripe enforcer',
    kind: 'erobot',
    bio: 'Black and yellow, because a warning should be seen. A riot shield on one arm and a baton on the other. Slow, stubborn and very hard to move.',
    threat: 'Soaks up rounds before it goes down. Aim high, and keep the trigger down.',
    colour: '#ffd23a',
  },
  {
    id: 'tech',
    name: 'TECH',
    role: 'Repair unit',
    kind: 'erobot',
    bio: 'The one with the toolbox. Climbs the tower, patches the racks and brings broken bots back online. Leave it alone and it fixes everything you just broke.',
    threat: 'Rebuilds smashed racks and glass. Take it out first.',
    colour: '#27e6ff',
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
  { src: '/gallery/loading/street-left.webp', beat: 'city', focus: 'gunner', pos: '50% 50%', caption: 'Neo-Tokyo, 01:14' },
  { src: '/gallery/loading/tower.webp', beat: 'terrornode', focus: 'kweg', pos: '50% 50%', caption: 'TERRORNODE HQ' },
  { src: '/gallery/loading/street-right.webp', beat: 'army', focus: 'frog', pos: '60% 50%', caption: 'The Erobotz hold the street' },
  { src: '/gallery/loading/boss.webp', beat: 'liquid', focus: 'liquid', pos: '55% 50%', caption: 'The Liquid Unit' },
  { src: '/gallery/loading/boss-fire.webp', beat: 'record', focus: 'npg', pos: '60% 50%', caption: 'Open fire' },
  { src: '/gallery/loading/muzzle.webp', beat: 'girls', focus: 'npg', pos: '62% 50%', caption: 'Hold the trigger' },
  // Add a row here only once its file is committed to public/gallery/loading/ (25 Oct: listing missing files 404'd).
];

// ── Stages ──────────────────────────────────────────────────────────────────────────────

export type StageBrief = { n: number; code: string; place: string; title: string; brief: string; intel: string; goal: string; kweg: string };
const STAGES: Omit<StageBrief, 'kweg'>[] = [
  { n: 1, code: 'STAGE 1 · STREET', place: 'THE STREET', title: 'STORM THE NODE', brief: 'The Erobotz and worse hold the street outside the nSLAVE tower. You walk on toward the lobby doors whatever happens. Keep the trigger down and sweep the gun across whatever comes at you.', intel: 'You never stop walking. A knockdown shields you and you fire on.', goal: 'Walk the street, hold the trigger' },
  { n: 2, code: 'STAGE 2 · HQ FLOORS', place: 'HQ FLOORS', title: 'THE LABS', brief: 'Through the lobby and down the corridor: glass labs, server racks, and something behind every desk. The corridor opens straight onto the server core. Smash what you like on the way.', intel: 'Rushers close in fast. Shoot their bolts out of the air.', goal: 'Walk the corridor, hold the trigger' },
  { n: 3, code: 'STAGE 3 · SERVER CORE', place: 'SERVER CORE', title: 'THE CENTRE', brief: 'The centre of nSLAVE: a shaft of glowing racks around TERRORNODE, the core that runs the Erobotz, with Dr Wong chained to it. Pour fire on the core as you pass. The girls cut him loose on the far side.', intel: 'Sustained fire on the core blows it for points. It re-arms.', goal: 'Walk round the core, hold the trigger' },
  { n: 4, code: 'STAGE 4 · ROOFTOP', place: 'THE ROOFTOP', title: 'THE LIQUID UNIT', brief: 'ACT 2. Dr Wong runs up out of the shaft with the girls to the roof and the helipad, the only way out. The Erobotz are angrier, and the Liquid Unit walks in between you and the chopper. Fire pushes it back. He keeps running the wrong way: stay close, or CALL KWEG (tap him, C or E). If he dies, the mission is lost.', intel: 'Heavy hitter. It staggers under sustained fire. Do not stop.', goal: 'Keep Dr Kweg alive, melt the Liquid Unit' },
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
  rescued: { top: 'ESCAPED', sub: 'Dr Kweg S Wong is out', kweg: KWEG.rescued },
} as const;

/** The lift between stages: the line under the floor counter. */

// ── Loadout: MISSION BRIEFING ───────────────────────────────────────────────────────────

export const BRIEFING = {
  heading: 'MISSION BRIEFING',
  code: 'WELCOME TO TERRORNODE · NEO-TOKYO 2048 · TEAM NPG vs TEAM EROBOTZ',
  from: 'The Ninja Punk Girls',
  objective: 'Act 1, STORM THE NODE: the street, the HQ floors and the core, where Dr Kweg is freed. Act 2, ESCAPE FROM TERRORNODE: get him to the roof, past the Liquid Unit. He keeps running the wrong way: protect him. You have 100 health: stay alive.',
  rules: [
    'Hold the trigger to fire. In paid play every round is real; in the demo they are simulated and nothing is sent.',
    'Clear the Erobotz to move up a stage. In the server core, sustained fire on the core jams the whole tower.',
    'The Liquid Unit is pushed back by sustained fire. Stop and it closes in fast. Erobotz shoot and swing: keep the gun moving.',
    'Smash the glass, drop the racks and clear the Erobotz for points.',
    'Unused credit stays in your gun. UNLOAD in the Your gun panel takes it back.',
  ],
} as const;

// ── Game over ───────────────────────────────────────────────────────────────────────────

export type Rank = { min: number; title: string; line: string };
/** By rounds fired, highest first. */
export const RANKS: Rank[] = [
  { min: 1_000_000, title: 'NETWORK BREAKER', line: 'A million rounds on the record. The Erobotz’ network is a smoking hole.' },
  { min: 100_000, title: 'LIGHTS OUT', line: 'The lights are going out across nSLAVE.' },
  { min: 10_000, title: 'TOWER SHAKER', line: 'The tower felt every one of those.' },
  { min: 1_000, title: 'NEON HERO', line: 'A good night’s work. The Ninja Punk Girls are impressed.' },
  { min: 100, title: 'STREET FIGHTER', line: 'You made some noise. Come back with more coins.' },
  { min: 0, title: 'ROOKIE', line: 'The night is long. Load up and try again.' },
];
export const rankFor = (rounds: number): Rank => RANKS.find((r) => rounds >= r.min) ?? RANKS[RANKS.length - 1];

/** The player dies (health at 0): the arcade CONTINUE? screen. */
export const FLATLINED = {
  title: 'FLATLINED',
  line: 'The Erobotz take another gunner.',
  kweg: KWEG.flatlined,
  prompt: 'CONTINUE?',
  coin: 'INSERT $b to continue',
  keep: 'Your loaded rounds stay in the gun. New coins add to them.',
  over: 'GAME OVER',
} as const;

export const GAME_OVER = {
  title: 'OUT OF ROUNDS',
  line: 'The gun is empty. The Erobotz still hold nSLAVE, and Dr Wong is still inside.',
  kweg: KWEG.over,
  next: 'The next coin is on you.',
} as const;

/** The rescue is done: the results screen heading and its lines. */
export const RESCUED = {
  title: 'ESCAPED',
  line: 'Dr Kweg S Wong is out, the Liquid Unit is down and TERRORNODE is quiet. The Ninja Punk Girls are already arguing about who flies the chopper.',
  kweg: KWEG.rescued,
  sub: KWEG.rescuedSub,
  next: 'Mission complete. The next coin starts it again.',
} as const;

/** The text a player shares. Plain words. */
export function shareText(p: { rounds: number; score: number; stage: number; rescued?: boolean; name?: string | null }): string {
  const who = p.name ? `@${p.name} fired` : 'I fired';
  const end = p.rescued ? 'rescued Dr Kweg S Wong and escaped' : `reached stage ${p.stage}`;
  return `${who} ${p.rounds.toLocaleString('en-US')} rounds at the Erobotz holding TERRORNODE in Neo-Tokyo, ${end} and scored ${p.score.toLocaleString('en-US')}. Every round is on the record. Beat that.`;
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

// ── Demo (taste) run / dry run: honest copy ─────────────────────────────────────────────────────
// In the demo (and the dev dry run) nothing is paid, signed, broadcast or counted on chain, and the words LIVE,
// "on chain", "on the record", "real transaction" and "accepted" must never describe the player's own rounds.
// Every player-visible string above that says so goes through `forPractice` when the game is simulated.
// (The hostage's "accepted, with required revisions" is a peer-review joke about the rescue, not about rounds.)

export const PRACTICE = {
  badge: 'DEMO · nothing on chain',
  kicker: 'DEMO · INSERT $b TO PLAY',
  loaded: { top: 'GUN LOADED.', bottom: 'DEMO ROUNDS', sub: 'Demo: simulated rounds, nothing goes on chain. Insert $b to play.' },
  nothing: 'Demo: nothing is paid and nothing goes on chain.',
  warmup: 'Getting your demo rounds ready…',
  results: 'Demo run: nothing was paid or sent, so there is no proof to check.',
} as const;

const SWAPS: [RegExp, string][] = [
  [/Every round goes on the record\./g, 'Demo rounds: nothing goes on chain.'],
  [/Every round you fire goes on the record and jams the Erobotz’ control of the network\./g, 'Every demo round you fire jams the Erobotz’ control of the network, in the story.'],
  [/Every round you fire is on the record\./g, 'Demo: simulated rounds, nothing goes on chain.'],
  [/Every round you fire is written where nobody can erase it, and every one jams the Erobotz’ control of the tower\./g, 'In the story, every round you fire jams the Erobotz’ control of the tower. This is a demo: simulated rounds, nothing goes on chain.'],
  [/Hold the trigger to fire\. Every round is real and goes on the record\./g, 'Hold the trigger to fire. Demo: simulated rounds, nothing goes on chain.'],
  [/Hold the trigger\. Every round is real\./g, 'Hold the trigger. These are demo rounds.'],
  [/A million rounds on the record\./g, 'A million demo rounds.'],
  [/Every round is on the record\. Beat that\./g, 'Demo rounds. Insert $b to play for real.'],
  [/\bLIVE ROUNDS\b/g, 'DEMO ROUNDS'],
];
/** Demo wording for a story string (identity for strings that never mention the record). */
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
    ...ACTS.flatMap((a) => [a.code, a.title, a.line]), FREED.top, FREED.sub, CTA, CREDIT,
    ...Object.values(PRACTICE.loaded), BANNERS.boss.top, BANNERS.boss.sub, BANNERS.boss.kweg, BANNERS.rescued.top, BANNERS.rescued.sub, BANNERS.rescued.kweg,
    BRIEFING.heading, BRIEFING.code, BRIEFING.objective, ...BRIEFING.rules, ...RANKS.flatMap((r) => [r.title, r.line]),
    ...Object.values(FLATLINED), ...Object.values(GAME_OVER), ...Object.values(RESCUED), ...TIPS,
    ...(Object.values(KWEG) as unknown[]), ...KWEG.stages, ...KWEG.clear,
    shareText({ rounds: 1234, score: 99, stage: 2, name: 'x' }),
  ]
    .filter((x): x is string => typeof x === 'string')
    .map((x) => forPractice(x));
}
