/**
 * NPG Card Battle: the rules engine. Pure and deterministic (seeded RNG inside the state), so the
 * same action list replays to the same game on both sides of an online match.
 *
 * RULES (as designed)
 * - Each player has a HERO (an NPG girl, 25 HP) and a DECK of 20 element cards (max 2 copies each).
 * - Card stats come from the card's six NPG attributes (strength, speed, skill, stamina, stealth,
 *   style, each 0-2 on element cards):
 *     cost   = ceil(total / 2), 1..6
 *     ATK/HP = a budget of 2 x cost + 1 (+1 Rare/Epic, +2 Legendary/Mythical, -1 if the card has an
 *              ability) split by the attack attributes (2 x STR + SKL + SPD) vs the defence ones
 *              (2 x STA + STL + STY).
 *     ability = the card's top attribute when it is 2 (ties: STR > SPD > SKL > STA > STL > STY):
 *       STR Overpower: damage beyond a fighter's HP carries through to the enemy hero.
 *       SPD Rush:      can attack the turn it is played.
 *       SKL Strike:    on play, 2 damage to the enemy fighter with the most ATK (or the enemy hero).
 *       STA Guard:     enemies must attack Guards first.
 *       STL Shadow:    can't be attacked until it attacks.
 *       STY Inspire:   on play, draw a card.
 * - HERO POWER (once per turn, 2 energy), from the girl's top attribute:
 *       STR/SKL Strike: 2 damage to the enemy fighter with the most ATK (or the enemy hero).
 *       SPD/STL Shuriken: 1 damage to the enemy hero and 1 to the weakest enemy fighter.
 *       STA/STY Mend: restore 3 HP to your hero.
 * - Turns: energy refills to max, max energy +1 per turn (up to 8), draw 1 (the first player skips
 *   the draw on turn 1). Start with 4 cards. Hand limit 8 (extra draws burn). Board limit 5.
 *   An empty deck deals fatigue damage 1, 2, 3...
 * - Fighters attack once per turn (not on the turn they're played unless Rush): a fighter attacked
 *   hits back. Reduce the enemy hero to 0 HP to win.
 */

export type Stat = 'strength' | 'speed' | 'skill' | 'stamina' | 'stealth' | 'style';
export const STATS: Stat[] = ['strength', 'speed', 'skill', 'stamina', 'stealth', 'style'];
export const STAT_ABBR: Record<Stat, string> = { strength: 'STR', speed: 'SPD', skill: 'SKL', stamina: 'STA', stealth: 'STL', style: 'STY' };

export type Ability = 'overpower' | 'rush' | 'strike' | 'guard' | 'shadow' | 'inspire';
export const ABILITY_OF: Record<Stat, Ability> = { strength: 'overpower', speed: 'rush', skill: 'strike', stamina: 'guard', stealth: 'shadow', style: 'inspire' };
export const ABILITY_TEXT: Record<Ability, { name: string; text: string; icon: string }> = {
  overpower: { name: 'Overpower', text: 'Damage beyond a fighter’s HP carries through to the enemy hero.', icon: '💪' },
  rush: { name: 'Rush', text: 'Can attack the turn it is played.', icon: '⚡' },
  strike: { name: 'Strike', text: 'On play: 2 damage to the enemy fighter with the most ATK (or the enemy hero).', icon: '🎯' },
  guard: { name: 'Guard', text: 'Enemies must attack Guards first.', icon: '🛡' },
  shadow: { name: 'Shadow', text: 'Can’t be attacked until it attacks.', icon: '🌑' },
  inspire: { name: 'Inspire', text: 'On play: draw a card.', icon: '✨' },
};

export type Power = 'strike' | 'shuriken' | 'mend';
export const POWER_TEXT: Record<Power, { name: string; text: string; icon: string }> = {
  strike: { name: 'Strike', text: '2 damage to the enemy fighter with the most ATK (or the enemy hero).', icon: '🎯' },
  shuriken: { name: 'Shuriken', text: '1 damage to the enemy hero and 1 to the weakest enemy fighter.', icon: '✴' },
  mend: { name: 'Mend', text: 'Restore 3 HP to your hero.', icon: '❤' },
};
const POWER_OF: Record<Stat, Power> = { strength: 'strike', skill: 'strike', speed: 'shuriken', stealth: 'shuriken', stamina: 'mend', style: 'mend' };

export const HERO_HP = 25;
export const DECK_SIZE = 20;
export const MAX_COPIES = 2;
export const BOARD_MAX = 5;
export const HAND_MAX = 8;
export const START_HAND = 4;
export const MAX_ENERGY = 8;
export const POWER_COST = 2;

/** [id, name, layer, rarity, character, team, [str, spd, skl, sta, stl, sty]] */
export type RawCard = [string, string, string, string, string, string, number[]];

export type CardInfo = {
  id: string;
  name: string;
  img: string;
  layer: string;
  rarity: string;
  character?: string;
  stats: number[];
  cost: number;
  atk: number;
  hp: number;
  ability: Ability | null;
};

export type HeroInfo = { id: string; name: string; img: string; stats: number[]; power: Power };

const RARITY_BONUS: Record<string, number> = { common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 2, mythical: 2 };

/** Top attribute index (ties broken by STATS order). */
const topStat = (s: number[]) => s.reduce((best, v, i) => (v > s[best] ? i : best), 0);

export function deriveCard(raw: RawCard, imgBase: string): CardInfo {
  const [id, name, layer, rarity, character, , s] = raw;
  const st = STATS.map((_, i) => Math.max(0, Math.min(2, Math.round(s[i] ?? 0))));
  const total = st.reduce((a, b) => a + b, 0);
  const cost = Math.max(1, Math.min(6, Math.ceil(total / 2)));
  const top = topStat(st);
  const ability = st[top] >= 2 ? ABILITY_OF[STATS[top]] : null;
  const budget = Math.max(2, 2 * cost + 1 + (RARITY_BONUS[rarity.toLowerCase()] ?? 0) - (ability ? 1 : 0));
  const a = 2 * st[0] + st[2] + st[1] + 1;
  const h = 2 * st[3] + st[4] + st[5] + 1;
  const atk = Math.max(1, Math.min(budget - 1, Math.round((budget * a) / (a + h))));
  return { id, name, img: imgBase + id + '.jpg', layer, rarity, character: character || undefined, stats: st, cost, atk, hp: budget - atk, ability };
}

export function makeHero(id: string, name: string, img: string, stats: number[]): HeroInfo {
  return { id, name, img, stats, power: POWER_OF[STATS[topStat(stats)]] };
}

// ---------------------------------------------------------------- state

export type Unit = { uid: number; card: string; atk: number; hp: number; maxHp: number; ability: Ability | null; ready: boolean; hidden: boolean };
export type Side = { hero: HeroInfo; hp: number; deck: string[]; hand: string[]; board: Unit[]; energy: number; maxEnergy: number; fatigue: number; powerUsed: boolean; name: string };
export type Game = {
  cards: Record<string, CardInfo>;
  sides: [Side, Side];
  turn: 0 | 1;
  round: number;
  rng: number;
  uid: number;
  winner: 0 | 1 | null;
  seq: number;
};

export type Target = number | 'hero';
export type Action =
  | { t: 'play'; card: string }
  | { t: 'attack'; uid: number; target: Target }
  | { t: 'power' }
  | { t: 'end' }
  | { t: 'concede'; p: 0 | 1 };

export type Ev =
  | { k: 'play'; p: 0 | 1; uid: number; card: string }
  | { k: 'dmg'; p: 0 | 1; at: Target; n: number }
  | { k: 'heal'; p: 0 | 1; n: number }
  | { k: 'die'; p: 0 | 1; uid: number }
  | { k: 'draw'; p: 0 | 1; burned?: string }
  | { k: 'fatigue'; p: 0 | 1; n: number }
  | { k: 'attack'; p: 0 | 1; uid: number; target: Target }
  | { k: 'power'; p: 0 | 1; power: Power }
  | { k: 'turn'; p: 0 | 1 }
  | { k: 'win'; p: 0 | 1 };

/** mulberry32 step: returns [value 0..1, next state]. */
function rand(g: Game) {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle<T>(g: Game, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type PlayerSetup = { name: string; hero: HeroInfo; deck: CardInfo[] };

export function createGame(seed: number, a: PlayerSetup, b: PlayerSetup): Game {
  const cards: Record<string, CardInfo> = {};
  for (const c of [...a.deck, ...b.deck]) cards[c.id] = c;
  const side = (p: PlayerSetup): Side => ({ hero: p.hero, hp: HERO_HP, deck: p.deck.map((c) => c.id), hand: [], board: [], energy: 0, maxEnergy: 0, fatigue: 0, powerUsed: false, name: p.name });
  const g: Game = { cards, sides: [side(a), side(b)], turn: 0, round: 0, rng: seed | 0, uid: 1, winner: null, seq: 0 };
  for (const s of g.sides) {
    shuffle(g, s.deck);
    for (let i = 0; i < START_HAND; i++) draw(g, s, []);
  }
  startTurn(g, 0, [], true);
  return g;
}

const clone = (g: Game): Game => ({ ...g, sides: g.sides.map((s) => ({ ...s, deck: [...s.deck], hand: [...s.hand], board: s.board.map((u) => ({ ...u })) })) as [Side, Side] });

function draw(g: Game, s: Side, ev: Ev[]) {
  const p = g.sides.indexOf(s) as 0 | 1;
  const c = s.deck.shift();
  if (!c) {
    s.fatigue++;
    s.hp -= s.fatigue;
    ev.push({ k: 'fatigue', p, n: s.fatigue });
    return;
  }
  if (s.hand.length >= HAND_MAX) ev.push({ k: 'draw', p, burned: c });
  else {
    s.hand.push(c);
    ev.push({ k: 'draw', p });
  }
}

function startTurn(g: Game, p: 0 | 1, ev: Ev[], first = false) {
  g.turn = p;
  g.round++;
  const s = g.sides[p];
  s.maxEnergy = Math.min(MAX_ENERGY, s.maxEnergy + 1);
  s.energy = s.maxEnergy;
  s.powerUsed = false;
  for (const u of s.board) u.ready = true;
  if (!first) draw(g, s, ev);
  ev.push({ k: 'turn', p });
}

/** The enemy fighter with the most ATK (ties: lowest HP, then oldest). */
const strongest = (b: Unit[]) => b.reduce<Unit | null>((m, u) => (!m || u.atk > m.atk || (u.atk === m.atk && u.hp < m.hp) ? u : m), null);
const weakest = (b: Unit[]) => b.reduce<Unit | null>((m, u) => (!m || u.hp < m.hp || (u.hp === m.hp && u.atk > m.atk) ? u : m), null);

function hit(g: Game, p: 0 | 1, at: Target, n: number, ev: Ev[]) {
  if (n <= 0) return;
  const s = g.sides[p];
  if (at === 'hero') s.hp -= n;
  else {
    const u = s.board.find((x) => x.uid === at);
    if (!u) return;
    u.hp -= n;
  }
  ev.push({ k: 'dmg', p, at, n });
}

function cleanup(g: Game, ev: Ev[]) {
  g.sides.forEach((s, p) => {
    s.board = s.board.filter((u) => {
      if (u.hp > 0) return true;
      ev.push({ k: 'die', p: p as 0 | 1, uid: u.uid });
      return false;
    });
  });
  if (g.winner === null) {
    const [a, b] = g.sides;
    if (a.hp <= 0 || b.hp <= 0) {
      // Both down at once (fatigue): the player whose turn it is loses.
      g.winner = a.hp <= 0 && b.hp <= 0 ? ((1 - g.turn) as 0 | 1) : a.hp <= 0 ? 1 : 0;
      ev.push({ k: 'win', p: g.winner });
    }
  }
}

export function canPlay(g: Game, card: string): boolean {
  const s = g.sides[g.turn];
  const c = g.cards[card];
  return g.winner === null && !!c && s.hand.includes(card) && c.cost <= s.energy && s.board.length < BOARD_MAX;
}

export function canPower(g: Game): boolean {
  const s = g.sides[g.turn];
  return g.winner === null && !s.powerUsed && s.energy >= POWER_COST;
}

/** Legal attack targets for one of the current player's fighters. */
export function targetsFor(g: Game, uid: number): Target[] {
  if (g.winner !== null) return [];
  const me = g.sides[g.turn];
  const u = me.board.find((x) => x.uid === uid);
  if (!u || !u.ready || u.atk <= 0) return [];
  const foe = g.sides[1 - g.turn];
  const guards = foe.board.filter((x) => x.ability === 'guard');
  if (guards.length) return guards.map((x) => x.uid);
  return [...foe.board.filter((x) => !x.hidden).map((x) => x.uid), 'hero'];
}

export function legal(g: Game, a: Action): boolean {
  switch (a.t) {
    case 'play':
      return canPlay(g, a.card);
    case 'attack':
      return targetsFor(g, a.uid).includes(a.target);
    case 'power':
      return canPower(g);
    case 'end':
      return g.winner === null;
    case 'concede':
      return g.winner === null && (a.p === 0 || a.p === 1);
  }
}

/** Apply an action. Illegal actions return the same state and no events. */
export function apply(g0: Game, a: Action): { g: Game; ev: Ev[] } {
  if (!legal(g0, a)) return { g: g0, ev: [] };
  const g = clone(g0);
  g.seq++;
  const ev: Ev[] = [];
  const p = g.turn;
  const q = (1 - p) as 0 | 1;
  const me = g.sides[p];
  const foe = g.sides[q];
  if (a.t === 'play') {
    const c = g.cards[a.card];
    me.hand.splice(me.hand.indexOf(a.card), 1);
    me.energy -= c.cost;
    const u: Unit = { uid: g.uid++, card: c.id, atk: c.atk, hp: c.hp, maxHp: c.hp, ability: c.ability, ready: c.ability === 'rush', hidden: c.ability === 'shadow' };
    me.board.push(u);
    ev.push({ k: 'play', p, uid: u.uid, card: c.id });
    if (c.ability === 'strike') {
      const t = strongest(foe.board);
      hit(g, q, t ? t.uid : 'hero', 2, ev);
    } else if (c.ability === 'inspire') draw(g, me, ev);
  } else if (a.t === 'attack') {
    const u = me.board.find((x) => x.uid === a.uid)!;
    u.ready = false;
    u.hidden = false;
    ev.push({ k: 'attack', p, uid: u.uid, target: a.target });
    if (a.target === 'hero') hit(g, q, 'hero', u.atk, ev);
    else {
      const t = foe.board.find((x) => x.uid === a.target)!;
      const over = u.ability === 'overpower' ? Math.max(0, u.atk - t.hp) : 0;
      hit(g, q, t.uid, u.atk, ev);
      hit(g, p, u.uid, t.atk, ev);
      if (over) hit(g, q, 'hero', over, ev);
    }
  } else if (a.t === 'power') {
    me.energy -= POWER_COST;
    me.powerUsed = true;
    ev.push({ k: 'power', p, power: me.hero.power });
    if (me.hero.power === 'strike') {
      const t = strongest(foe.board);
      hit(g, q, t ? t.uid : 'hero', 2, ev);
    } else if (me.hero.power === 'shuriken') {
      hit(g, q, 'hero', 1, ev);
      const t = weakest(foe.board);
      if (t) hit(g, q, t.uid, 1, ev);
    } else {
      const n = Math.min(3, HERO_HP - me.hp);
      me.hp += n;
      ev.push({ k: 'heal', p, n });
    }
  } else if (a.t === 'end') {
    startTurn(g, q, ev);
  } else if (a.t === 'concede') {
    g.winner = (1 - a.p) as 0 | 1;
    ev.push({ k: 'win', p: g.winner });
  }
  cleanup(g, ev);
  return { g, ev };
}

// ---------------------------------------------------------------- AI

export type Difficulty = 'easy' | 'hard';

/** Every legal action for the current player except 'end' / 'concede'. */
export function moves(g: Game): Action[] {
  const s = g.sides[g.turn];
  const out: Action[] = [];
  for (const c of new Set(s.hand)) if (canPlay(g, c)) out.push({ t: 'play', card: c });
  if (canPower(g)) out.push({ t: 'power' });
  for (const u of s.board) for (const t of targetsFor(g, u.uid)) out.push({ t: 'attack', uid: u.uid, target: t });
  return out;
}

const unitValue = (u: Unit) => u.atk * 1.3 + u.hp + (u.ability === 'guard' ? 1.5 : 0) + (u.ability === 'shadow' && u.hidden ? 1 : 0) + (u.ability === 'overpower' ? 0.8 : 0);

/** Board evaluation from player p's point of view. */
export function evaluate(g: Game, p: 0 | 1): number {
  if (g.winner !== null) return g.winner === p ? 1e6 : -1e6;
  const me = g.sides[p];
  const foe = g.sides[1 - p];
  const danger = (s: Side) => (s.hp <= 8 ? (9 - s.hp) * 1.5 : 0);
  return (
    (me.hp - foe.hp) * 0.9 -
    danger(me) +
    danger(foe) +
    me.board.reduce((n, u) => n + unitValue(u), 0) -
    foe.board.reduce((n, u) => n + unitValue(u), 0) * 1.1 +
    (me.hand.length - foe.hand.length) * 0.6
  );
}

/**
 * The AI's next action. Easy: plays what it can afford at random and swings at random targets.
 * Hard: greedy one-step search over every legal action with a board evaluation, takes lethal
 * when it sees it, and spends its energy on the best-value card first.
 */
export function aiMove(g: Game, level: Difficulty, rnd: () => number = Math.random): Action {
  const p = g.turn;
  const all = moves(g);
  if (!all.length) return { t: 'end' };
  if (level === 'easy') {
    if (rnd() < 0.12) return { t: 'end' };
    const plays = all.filter((a) => a.t !== 'attack');
    const pool = plays.length && rnd() < 0.6 ? plays : all;
    return pool[Math.floor(rnd() * pool.length)];
  }
  const base = evaluate(g, p);
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const a of all) {
    const { g: n } = apply(g, a);
    let sc = evaluate(n, p);
    // Look one move further for attacks (spot follow-up lethal and good trades).
    if (a.t === 'attack' && n.winner === null) {
      for (const b of moves(n)) if (b.t === 'attack') sc = Math.max(sc, evaluate(apply(n, b).g, p) - 0.01);
    }
    if (a.t === 'play') sc += g.cards[a.card].cost * 0.35; // use energy
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  if (!best) return { t: 'end' };
  // Plays and the hero power are free value; attacks only if they don't make things worse.
  if (best.t === 'attack' && bestScore < base - 0.25) return { t: 'end' };
  return best;
}

// ---------------------------------------------------------------- decks

export function validDeck(ids: string[], cards: Record<string, CardInfo>): string | null {
  if (ids.length !== DECK_SIZE) return `A deck is ${DECK_SIZE} cards (this one has ${ids.length}).`;
  const n: Record<string, number> = {};
  for (const id of ids) {
    if (!cards[id]) return 'Unknown card in deck.';
    n[id] = (n[id] ?? 0) + 1;
    if (n[id] > MAX_COPIES) return `Max ${MAX_COPIES} copies of a card.`;
  }
  return null;
}

/** A balanced deck from a pool: a mana curve with some of every ability. Deterministic for a seed. */
export function autoDeck(pool: CardInfo[], seed = 7): string[] {
  const g = { rng: seed } as Game;
  const want = [0, 3, 4, 4, 4, 3, 2]; // by cost 1..6
  const byCost: CardInfo[][] = [[], [], [], [], [], [], []];
  for (const c of shuffle(g, [...pool])) byCost[c.cost].push(c);
  const out: string[] = [];
  for (let cost = 1; cost <= 6; cost++) {
    const list = byCost[cost].sort((a, b) => b.atk + b.hp + (b.ability ? 1.5 : 0) - (a.atk + a.hp + (a.ability ? 1.5 : 0)));
    for (const c of list.slice(0, want[cost])) if (out.length < DECK_SIZE) out.push(c.id);
  }
  // Fill up (with second copies if the pool is small).
  const sorted = [...pool].sort((a, b) => a.cost - b.cost);
  for (let pass = 0; pass < MAX_COPIES && out.length < DECK_SIZE; pass++)
    for (const c of sorted) {
      if (out.length >= DECK_SIZE) break;
      if (out.filter((x) => x === c.id).length <= pass) out.push(c.id);
    }
  return out.slice(0, DECK_SIZE);
}
