/**
 * ESCAPE FROM TERRORNODE character select: pick an NPG girl and a weapon per hand (NPG card game data,
 * Ninja Punk Girls Ltd IP; built by scripts/npg-roster-build.ts into src/lib/npg/npgIndex.json + public/npg/).
 *
 * The six NPG stats (strength, speed, skill, stamina, stealth, style) map to small game modifiers so balance holds:
 * each stat is worth ±STEP per point around the roster average, capped at ±CAP. Pure, no React, no wallet.
 */
import INDEX from './npg/npgIndex.json';

export const STATS = ['strength', 'speed', 'skill', 'stamina', 'stealth', 'style'] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;
export const STAT_ABBR: Record<Stat, string> = { strength: 'STR', speed: 'SPD', skill: 'SKL', stamina: 'STA', stealth: 'STL', style: 'STY' };

export type NpgWeapon = { id: string; hand: 'left' | 'right'; name: string; rarity: string; owner: string | null; team: string | null; stats: Stats };
export type NpgGirl = { id: string; name: string; parts: { layer: string; id: string; stats: Stats }[] };

export const WEAPONS = INDEX.weapons as NpgWeapon[];
export const GIRLS = INDEX.girls as NpgGirl[];
export const weaponById = (id: string | null | undefined) => WEAPONS.find((w) => w.id === id);
export const girlImg = (id: string) => `/npg/girls/${id}.webp`;
export const weaponImg = (id: string) => `/npg/weapons/${id}.webp`;

const zero = (): Stats => ({ strength: 0, speed: 0, skill: 0, stamina: 0, stealth: 0, style: 0 });
const add = (a: Stats, b: Partial<Stats>) => {
  for (const s of STATS) a[s] += Number(b[s] ?? 0);
  return a;
};

/**
 * Weapons a girl may hold in one hand: the universal ones (no named owner, not Erobot team), her own signature
 * pieces, plus anything the player owns as an NPG part card.
 */
export function allowedWeapons(girl: NpgGirl, hand: 'left' | 'right', owned: ReadonlySet<string> = new Set()): NpgWeapon[] {
  return WEAPONS.filter((w) => w.hand === hand && (owned.has(w.id) || w.owner === girl.name || (!w.owner && w.team !== 'Erobot')));
}

/** Her starter weapon for a hand: her signature piece, else the first universal Common, else the first allowed. */
export function starterWeapon(girl: NpgGirl, hand: 'left' | 'right'): NpgWeapon | undefined {
  const ok = allowedWeapons(girl, hand);
  return ok.find((w) => w.owner === girl.name) ?? ok.find((w) => w.rarity === 'Common') ?? ok[0];
}

export type Pick = { girl: string; right: string | null; left: string | null };

/** The default roster: every girl with her starter pair. Anyone can play, no cards needed. */
export const DEFAULT_ROSTER: (NpgGirl & { right: string | null; left: string | null })[] = GIRLS.map((g) => ({ ...g, right: starterWeapon(g, 'right')?.id ?? null, left: starterWeapon(g, 'left')?.id ?? null }));

/** A girl's total stats: her look parts plus the two weapons. */
export function statsFor(p: Pick): Stats {
  const g = GIRLS.find((x) => x.id === p.girl) ?? GIRLS[0];
  const s = zero();
  for (const part of g.parts) add(s, part.stats);
  add(s, weaponById(p.right)?.stats ?? {});
  add(s, weaponById(p.left)?.stats ?? {});
  return s;
}

/** ±% per stat point above/below the baseline, and the cap each modifier is held inside. */
export const STEP = 0.02;
export const CAP = 0.12;
/** Baseline per stat: the default roster's average, so an average starter pick is ~±0. */
export const BASE: Stats = (() => {
  const t = zero();
  for (const g of DEFAULT_ROSTER) add(t, statsFor({ girl: g.id, right: g.right, left: g.left }));
  for (const s of STATS) t[s] = Math.round((t[s] / Math.max(1, DEFAULT_ROSTER.length)) * 10) / 10;
  return t;
})();

export type Mods = { damage: number; speed: number; spread: number; hp: number; incoming: number; score: number };
export const NEUTRAL: Mods = { damage: 1, speed: 1, spread: 1, hp: 1, incoming: 1, score: 1 };

const pct = (v: number, s: Stat) => Math.max(-CAP, Math.min(CAP, (v - BASE[s]) * STEP));
/**
 * strength → damage, speed → move speed, skill → tighter spread, stamina → max health,
 * stealth → less incoming fire (enemy aggro), style → score multiplier.
 */
export function modsFor(s: Stats): Mods {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    damage: r(1 + pct(s.strength, 'strength')),
    speed: r(1 + pct(s.speed, 'speed')),
    spread: r(1 - pct(s.skill, 'skill')),
    hp: r(1 + pct(s.stamina, 'stamina')),
    incoming: r(1 - pct(s.stealth, 'stealth')),
    score: r(1 + pct(s.style, 'style')),
  };
}

/** A pick, made valid: unknown girl → the first, a weapon she can't hold (and doesn't own) → her starter. */
export function normalizePick(p: Partial<Pick> | null | undefined, owned: ReadonlySet<string> = new Set()): Pick {
  const g = GIRLS.find((x) => x.id === p?.girl) ?? GIRLS[0];
  const fix = (hand: 'left' | 'right', id: string | null | undefined) =>
    id && allowedWeapons(g, hand, owned).some((w) => w.id === id) ? id : (starterWeapon(g, hand)?.id ?? null);
  return { girl: g.id, right: fix('right', p?.right), left: fix('left', p?.left) };
}

export const PICK_KEY = 'tb:terrornode-girl';
export function loadPick(): Pick {
  try {
    return normalizePick(JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null') as Partial<Pick>);
  } catch {
    return normalizePick(null);
  }
}
export function savePick(p: Pick) {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

// ── Owned NPG cards (read only) ──────────────────────────────────────────────────────────────────
/**
 * NPG cards are 1Sat ordinals minted by ninja-punk-girls.com (src/lib/onchain/minter.ts): MAP `app: npg`,
 * `npgType: part | stack`, and a JSON inscription body `{ type: 'part', elementId: '07_003', layer, … }` or
 * `{ type: 'stack', partLayers: [{ layer, elementId }, …] }`. elementId is `<folder>_<asset>`, the same id our
 * weapon index uses.
 */
export type NpgOwned = { elements: Set<string>; girls: Set<string>; stacks: number };

/** Is this MAP (from an ordinal's origin) an NPG card? */
export function isNpgMap(map: Record<string, unknown> | null | undefined): 'part' | 'stack' | null {
  if (!map || map.app !== 'npg') return null;
  const t = map.npgType ?? map.type;
  return t === 'part' || t === 'stack' ? t : null;
}

/** Element ids a card's JSON inscription body carries. */
export function elementsOfCard(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as { type?: unknown; elementId?: unknown; partLayers?: unknown };
  const ok = (x: unknown): x is string => typeof x === 'string' && /^\d{2}_\d{3}$/.test(x);
  if (b.type === 'part') return ok(b.elementId) ? [b.elementId] : [];
  if (b.type === 'stack' && Array.isArray(b.partLayers)) return b.partLayers.map((p) => (p as { elementId?: unknown })?.elementId).filter(ok);
  return [];
}

/** Fold the element ids of owned cards into unlocks: weapons by id, a roster girl when her body part is owned. */
export function ownedFrom(elementLists: string[][], stacks = 0): NpgOwned {
  const elements = new Set(elementLists.flat());
  const girls = new Set(GIRLS.filter((g) => g.parts.some((p) => p.layer === '21-Body' && elements.has(p.id))).map((g) => g.id));
  return { elements, girls, stacks };
}
