/**
 * bRacer teams and sponsors as DATA. One look (bRacer's own: flat racing colours, chevrons, katakana, codes); the
 * grid and the adverts are chosen per race.
 *
 * Teams: bRacer's six launch teams (one per chain-transaction kind, plus the house team) and the family teams. Every
 * team is painted the bRacer way: `base` is the big flat body colour (the family colour for family teams), `accent`
 * the chevrons and number, `trim` the spine and wing stripes.
 *
 * Sponsors: family sites, run as adverts on billboards, gantry beams, the pit wall and car decals, and listed as
 * plain links on the garage and results screens. Taglines are short and factual (what the site is).
 *
 * URL: ?teams=dnsdex,clawdex,tokenblaster,… picks the grid (first is the player's team; unknown ids are ignored; at
 * most MAX_TEAMS), ?team=<id> picks the player's team, ?sponsors=<ids> overrides the advert set, ?ads=0 removes
 * every advert (the original bRacer track).
 *
 * Pure: no DOM, no imports. Unit-tested in src/lib/bracer-teams.test.ts.
 */

export type Team = {
  id: string;
  name: string;
  kana: string;
  code: string;
  /** Body colour. */
  base: string;
  /** Chevrons, number, and the colour the team's name is set in on its chip. */
  accent: string;
  /** Spine and wing stripes. */
  trim: string;
  motto: string;
  /** Text colour on `base` (rival name tags). Unset keeps the launch teams' rule (white on black trim, else black). */
  ink?: string;
  /** The team's site (family teams). */
  url?: string;
};

export type Sponsor = {
  id: string;
  name: string;
  /** Family sites only, https. */
  url: string;
  /** Short and factual: what the site is. No income or returns wording. */
  tagline: string;
  /** Main colour (the advert's colour block). */
  colour: string;
  /** Text colour on `colour`. */
  ink: string;
};

export const MAX_TEAMS = 8;

/** bRacer's launch teams: one per chain-transaction kind, plus the house team. */
export const BRACER_TEAMS: readonly Team[] = [
  { id: 'house', name: 'TOKENBLASTER', kana: 'トークンブラスター', code: 'TB-01', base: '#e8261d', accent: '#ffffff', trim: '#111111', motto: 'BLAST MORE' },
  { id: 'token', name: 'TOKEN GUILD', kana: 'トークンギルド', code: 'TG-07', base: '#101015', accent: '#e8b53a', trim: '#ffffff', motto: 'HOLD NOTHING' },
  { id: 'inscription', name: 'ORDINAL ORDER', kana: 'オーディナル', code: 'OO-21', base: '#f2f2ee', accent: '#c4161c', trim: '#101010', motto: 'ETCHED FOREVER' },
  { id: 'payment', name: 'MERCHANT CORP', kana: 'マーチャント', code: 'MC-05', base: '#1f8f4a', accent: '#f4efe2', trim: '#101010', motto: 'BUY NOW' },
  { id: 'data', name: 'DATASTREAM', kana: 'データストリーム', code: 'DS-64', base: '#2a5bff', accent: '#ff5a48', trim: '#e8e8e8', motto: 'ALWAYS ON' },
  { id: 'social', name: 'SIGNAL FM', kana: 'シグナル', code: 'SF-99', base: '#d33d8c', accent: '#fff2f8', trim: '#2a0a1a', motto: 'TURN IT UP' },
];

/**
 * The family, one team per site. The family colour is the body; chevrons and stripes follow bRacer's decal language
 * (one loud contrasting accent, a dark or deep trim), chosen so no two teams on a grid read as the same car.
 */
export const FAMILY_TEAMS: readonly Team[] = [
  { id: 'dnsdex', name: 'DNS-DEX', kana: 'ドメインデックス', code: 'DX-01', base: '#00d26a', accent: '#ffffff', trim: '#0b5d3b', ink: '#010101', motto: 'OWN THE NAME', url: 'https://dns-dex.com' },
  { id: 'clawdex', name: 'CLAW-DEX', kana: 'クローデックス', code: 'CX-07', base: '#f97316', accent: '#ffffff', trim: '#111111', ink: '#010101', motto: 'MACHINE SPEED', url: 'https://claw-dex.com' },
  { id: 'repodex', name: 'REPO-DEX', kana: 'レポデックス', code: 'RX-02', base: '#3d9cff', accent: '#ffffff', trim: '#0e2a6b', ink: '#010101', motto: 'SHIP IT', url: 'https://repo-dex.com' },
  { id: 'gitdex', name: 'GITDEX', kana: 'ギットデックス', code: 'GX-03', base: '#d9dce2', accent: '#f05032', trim: '#111111', ink: '#010101', motto: 'MERGE FAST', url: 'https://git-dex.com' },
  { id: 'bwalletx', name: 'bWalletX', kana: 'ビーアック', code: 'BX-01', base: '#f5b800', accent: '#111111', trim: '#7a5600', ink: '#010101', motto: 'MAKE BITCOIN FASTER', url: 'https://bwalletx.com' },
  { id: 'vexvoid', name: 'V3XV0ID', kana: 'ヴェクスヴォイド', code: 'VX-00', base: '#0b0b0b', accent: '#ffffff', trim: '#8a8a8a', ink: '#ffffff', motto: 'ACCELERATE', url: 'https://vexvoid.com' },
  { id: 'npg', name: 'NPG', kana: 'ニンジャパンクガールズ', code: 'NP-01', base: '#ff3d8b', accent: '#2de2d0', trim: '#111111', ink: '#0a0a0c', motto: 'NO RULES', url: 'https://ninjapunkgirls.com' },
  { id: 'npgx', name: 'NPGX', kana: 'エヌピージーエックス', code: 'NX-01', base: '#ff2d55', accent: '#ffd400', trim: '#111111', ink: '#0a0a0c', motto: 'NEXT GENERATION', url: 'https://npgx.website' },
];

export const ALL_TEAMS: readonly Team[] = [...BRACER_TEAMS, ...FAMILY_TEAMS];

/** Friendly ids for the launch teams (their internal ids are the transaction kinds). */
const ALIASES: Record<string, string> = {
  tokenblaster: 'house',
  tb: 'house',
  tokenguild: 'token',
  ordinalorder: 'inscription',
  ordinal: 'inscription',
  merchantcorp: 'payment',
  merchant: 'payment',
  datastream: 'data',
  signalfm: 'social',
  signal: 'social',
  bacc: 'bwalletx',
};
const canon = (raw: string) => {
  const id = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  return Object.prototype.hasOwnProperty.call(ALIASES, id) ? ALIASES[id] : id;
};

export const teamById = (id: string): Team | undefined => ALL_TEAMS.find((t) => t.id === canon(id));

export const SPONSORS: readonly Sponsor[] = [
  { id: 'bacc', name: 'bAcc', url: 'https://bwalletx.com/b/acc', tagline: 'Make Bitcoin faster', colour: '#f5b800', ink: '#010101' },
  { id: 'bwalletx', name: 'bWalletX', url: 'https://bwalletx.com', tagline: 'The smart social super wallet', colour: '#f5b800', ink: '#010101' },
  { id: 'dnsdex', name: 'DNS-DEX', url: 'https://dns-dex.com', tagline: 'Your domain as a BSV-21 token', colour: '#00d26a', ink: '#010101' },
  { id: 'clawdex', name: 'CLAW-DEX', url: 'https://claw-dex.com', tagline: 'The exchange for AI agents', colour: '#f97316', ink: '#010101' },
  { id: 'repodex', name: 'REPO-DEX', url: 'https://repo-dex.com', tagline: 'Code repos on BSV', colour: '#3d9cff', ink: '#010101' },
  { id: 'gitdex', name: 'GITDEX', url: 'https://git-dex.com', tagline: 'Git on BSV', colour: '#d9dce2', ink: '#010101' },
  { id: 'bitsign', name: 'bit-sign', url: 'https://bit-sign.online', tagline: 'Sign, seal and inscribe documents', colour: '#e8e8e8', ink: '#010101' },
  { id: 'vexvoid', name: 'V3XV0ID', url: 'https://vexvoid.com', tagline: 'Experimental electronic music and art', colour: '#0b0b0b', ink: '#ffffff' },
  { id: 'npg', name: 'NINJA PUNK GIRLS', url: 'https://ninjapunkgirls.com', tagline: 'Cards, games and music', colour: '#ff3d8b', ink: '#0a0a0c' },
  { id: 'npgx', name: 'NPGX', url: 'https://npgx.website', tagline: 'Ninja Punk Girls X', colour: '#ff2d55', ink: '#0a0a0c' },
  { id: 'bmovies', name: 'bMovies', url: 'https://bmovies.online', tagline: 'Films on BSV', colour: '#e50914', ink: '#ffffff' },
  { id: 'path402', name: '$402', url: 'https://path402.com', tagline: 'Access tokens for the open web', colour: '#a3e635', ink: '#010101' },
  { id: 'b0ase', name: 'b0ase', url: 'https://b0ase.com', tagline: 'The studio behind the family', colour: '#ffffff', ink: '#000000' },
];
export const sponsorById = (id: string): Sponsor | undefined => SPONSORS.find((s) => s.id === id.trim().toLowerCase());

/** Comma list of known ids (canonicalised), de-duplicated, order kept, unknown ids dropped, capped at `max`. */
export function parseIds(raw: string | null, resolve: (id: string) => { id: string } | undefined, max: number): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const hit = part.trim() ? resolve(part) : undefined;
    if (!hit || out.includes(hit.id)) continue;
    out.push(hit.id);
    if (out.length >= max) break;
  }
  return out;
}

export type RaceSetup = {
  /** The grid, player's team first. Without ?teams= this is every team (the menu's full list). */
  teams: Team[];
  /** The player's team from the URL (?team=, else the first of ?teams=), or null to keep the saved pick. */
  player: Team | null;
  /** True when ?teams= chose the grid: rivals then race in the grid's teams instead of their transaction kind's. */
  customGrid: boolean;
  /** Adverts for this race; empty with ?ads=0. */
  sponsors: Sponsor[];
  ads: boolean;
};

/** Everything the race needs from a query string. */
export function resolveRace(search: string | URLSearchParams): RaceSetup {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const picked = parseIds(q.get('teams'), teamById, MAX_TEAMS);
  const customGrid = picked.length > 0;
  const want = teamById(q.get('team') ?? '');
  let ids = customGrid ? picked : ALL_TEAMS.map((t) => t.id);
  if (want && customGrid) ids = [want.id, ...ids.filter((i) => i !== want.id)].slice(0, MAX_TEAMS);
  const teams = ids.map((i) => teamById(i)!);
  const player = want ?? (customGrid ? teams[0] : null);
  const ads = q.get('ads') !== '0';
  const sIds = parseIds(q.get('sponsors'), sponsorById, SPONSORS.length);
  const sponsors = ads ? (sIds.length ? sIds.map((i) => sponsorById(i)!) : [...SPONSORS]) : [];
  return { teams, player, customGrid, sponsors, ads };
}

/** Teams for `count` rivals on a custom grid, dealt round-robin with the player's team last. */
export function dealTeams(teams: readonly Team[], count: number): Team[] {
  if (!teams.length || count <= 0) return [];
  const order = teams.length > 1 ? [...teams.slice(1), teams[0]] : [teams[0]];
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}

/** Relative luminance (WCAG), 0..1. */
export function luminance(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** The colour a team shows as light (trails, minimap dot): its accent, unless that is plain white or too dark. */
export function teamGlow(t: Pick<Team, 'base' | 'accent'>) {
  const pick = t.accent === '#ffffff' ? t.base : t.accent;
  if (luminance(pick) >= 0.03) return pick;
  return luminance(t.accent) >= luminance(t.base) ? t.accent : t.base;
}

/** Text colour for a team's name tag on its body colour (launch teams keep their original rule). */
export const teamInk = (t: Team) => t.ink ?? (t.trim === '#111111' || t.trim === '#101010' ? '#fff' : '#000');

export const domainOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
