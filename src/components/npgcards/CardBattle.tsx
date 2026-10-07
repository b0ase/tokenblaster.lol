'use client';

/**
 * NPG Card Battle: menu, hero pick, deck builder, tutorial, battle vs AI (easy / hard) and online
 * PvP over a broadcast room. Rules live in lib/npgcards/engine.ts; this file is UI + match flow.
 * Site-specific pieces come in as props (card pool, heroes, transport, sound, paid plays).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ABILITY_TEXT,
  BOARD_MAX,
  DECK_SIZE,
  HERO_HP,
  MAX_COPIES,
  POWER_COST,
  POWER_TEXT,
  STATS,
  STAT_ABBR,
  aiMove,
  apply,
  autoDeck,
  canPlay,
  canPower,
  createGame,
  deriveCard,
  makeHero,
  targetsFor,
  validDeck,
  type Ability,
  type Action,
  type CardInfo,
  type Difficulty,
  type Ev,
  type Game,
  type HeroInfo,
  type PlayerSetup,
  type Target,
  type Unit,
} from '@/lib/npgcards/engine';
import type { Net, NetFactory, NetStatus } from '@/lib/npgcards/net';

export type SoundName = 'play' | 'attack' | 'hit' | 'die' | 'power' | 'turn' | 'win' | 'lose' | 'click' | 'draw';
export type GameResult = { won: boolean; vsAI: boolean; difficulty: Difficulty | null; rounds: number; secs: number; streak: number; streakSecs: number; hpLeft: number };

type Props = {
  pool: CardInfo[];
  heroes: HeroInfo[];
  /** The player's own NPGs (from their wallet), offered first as heroes. */
  ownedHeroes?: HeroInfo[];
  storageKey: string;
  net?: NetFactory | null;
  roomPrefix?: string;
  /** Called before each card you play; return false to refuse the play (e.g. LIVE mode out of sats). */
  payPlay?: () => boolean;
  /** Called before each match vs the AI starts with the current win streak (0 = a new streak); return false to refuse it. */
  beforeStartAI?: (streak: number) => boolean;
  sfx?: (n: SoundName) => void;
  renderGameOver?: (r: GameResult) => ReactNode;
  /** Overlay drawn on the battlefield (e.g. a PRACTICE / LIVE badge). */
  badge?: ReactNode;
  /** Extra controls on the main menu (e.g. a LIVE mode panel). */
  menuExtra?: ReactNode;
  onScreen?: (s: Screen) => void;
};
type Screen = 'menu' | 'deck' | 'battle' | 'lobby';
type Vs = { kind: 'ai'; level: Difficulty } | { kind: 'pvp'; room: string };
type Fx = { id: number; key: string; text: string; cls: string };

const ABILITY_COLOR: Record<Ability, string> = {
  overpower: 'bg-orange-600',
  rush: 'bg-yellow-500 text-black',
  strike: 'bg-red-600',
  guard: 'bg-sky-600',
  shadow: 'bg-violet-700',
  inspire: 'bg-pink-600',
};

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};

const randId = () => Math.random().toString(36).slice(2, 10);
const IMG_OK = /^(\/[\w\-./]+|https:\/\/[\w\-./%]+)\.(jpe?g|png|webp)$/i;

/** Re-derive a card a peer sent us from its attributes, so nobody can send a 9/9 for 1. */
function sanitizeCard(c: unknown): CardInfo | null {
  const x = c as Partial<CardInfo>;
  if (!x || typeof x.id !== 'string' || !Array.isArray(x.stats)) return null;
  const d = deriveCard([x.id.slice(0, 80), String(x.name ?? '?').slice(0, 40), String(x.layer ?? '').slice(0, 30), String(x.rarity ?? 'Common').slice(0, 12), String(x.character ?? '').slice(0, 30), '', x.stats.map(Number)], '');
  d.img = typeof x.img === 'string' && IMG_OK.test(x.img) ? x.img : '';
  return d;
}
function sanitizeSetup(s: unknown): PlayerSetup | null {
  const x = s as { name?: unknown; hero?: Partial<HeroInfo>; deck?: unknown[] };
  if (!x || !x.hero || !Array.isArray(x.deck) || !Array.isArray(x.hero.stats)) return null;
  const deck = x.deck.map(sanitizeCard).filter((c): c is CardInfo => !!c);
  const cards = Object.fromEntries(deck.map((c) => [c.id, c]));
  if (validDeck(deck.map((c) => c.id), cards)) return null;
  const img = typeof x.hero.img === 'string' && IMG_OK.test(x.hero.img) ? x.hero.img : '';
  return { name: String(x.name ?? 'Opponent').slice(0, 16), hero: makeHero(String(x.hero.id ?? 'hero').slice(0, 60), String(x.hero.name ?? 'Hero').slice(0, 24), img, x.hero.stats.map(Number).slice(0, 6)), deck };
}

/** Tiny built-in blips when the site doesn't pass its own sound. */
let actx: AudioContext | null = null;
function blip(n: SoundName) {
  try {
    actx ??= new AudioContext();
    const f: Record<SoundName, [number, number, OscillatorType]> = { play: [520, 0.08, 'triangle'], attack: [180, 0.1, 'sawtooth'], hit: [110, 0.12, 'square'], die: [70, 0.25, 'sawtooth'], power: [760, 0.15, 'sine'], turn: [440, 0.06, 'sine'], win: [880, 0.4, 'triangle'], lose: [140, 0.5, 'triangle'], click: [1200, 0.03, 'square'], draw: [660, 0.04, 'sine'] };
    const [hz, d, type] = f[n];
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, actx.currentTime);
    if (n === 'win') o.frequency.linearRampToValueAtTime(hz * 1.5, actx.currentTime + d);
    if (n === 'lose' || n === 'die') o.frequency.linearRampToValueAtTime(hz * 0.5, actx.currentTime + d);
    g.gain.setValueAtTime(0.08, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + d);
  } catch {
    /* no audio */
  }
}

const CSS = `
@keyframes npgc-in{0%{transform:translateY(40px) scale(.5);opacity:0}70%{transform:translateY(-6px) scale(1.06);opacity:1}100%{transform:none}}
@keyframes npgc-shake{0%,100%{transform:none}20%{transform:translateX(-5px) rotate(-2deg)}40%{transform:translateX(5px) rotate(2deg)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
@keyframes npgc-float{0%{transform:translate(-50%,0) scale(.6);opacity:0}15%{transform:translate(-50%,-6px) scale(1.25);opacity:1}100%{transform:translate(-50%,-46px) scale(1);opacity:0}}
@keyframes npgc-up{0%,100%{transform:none}45%{transform:translateY(-34px) scale(1.08)}}
@keyframes npgc-down{0%,100%{transform:none}45%{transform:translateY(34px) scale(1.08)}}
@keyframes npgc-glow{0%,100%{box-shadow:0 0 0 2px #22d3ee,0 0 10px #22d3ee}50%{box-shadow:0 0 0 2px #22d3ee,0 0 22px #22d3ee}}
@keyframes npgc-banner{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.1);opacity:1}100%{transform:scale(1)}}
.npgc-in{animation:npgc-in .45s ease-out}
.npgc-shake{animation:npgc-shake .4s}
.npgc-up{animation:npgc-up .35s ease-in-out}
.npgc-down{animation:npgc-down .35s ease-in-out}
.npgc-ready{animation:npgc-glow 1.4s infinite}
.npgc-float{position:absolute;left:50%;top:30%;z-index:30;pointer-events:none;font-weight:900;text-shadow:0 2px 0 #000,0 0 8px #000;animation:npgc-float .95s ease-out forwards;white-space:nowrap}
.npgc-banner{animation:npgc-banner .5s ease-out}
`;

// ---------------------------------------------------------------- card faces

function Chip({ children, cls }: { children: ReactNode; cls: string }) {
  return <span className={`flex items-center justify-center rounded-full border-2 border-black font-black leading-none text-white shadow ${cls}`}>{children}</span>;
}

function CardFace({ c, u, size = 'md', className = '' }: { c: CardInfo; u?: Unit; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const chip = size === 'sm' ? 'h-5 w-5 text-[11px]' : size === 'md' ? 'h-7 w-7 text-sm' : 'h-9 w-9 text-lg';
  const atk = u ? u.atk : c.atk;
  const hp = u ? u.hp : c.hp;
  const hurt = u && u.hp < u.maxHp;
  return (
    <div className={`relative aspect-[2/3] w-full overflow-hidden rounded-md border border-black bg-zinc-900 ${u?.hidden ? 'opacity-70 saturate-50' : ''} ${className}`}>
      {c.img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.img} alt={c.name} loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-fuchsia-900 to-zinc-900" />
      )}
      {!u && (
        <span className="absolute left-0.5 top-0.5">
          <Chip cls={`${chip} bg-blue-600`}>{c.cost}</Chip>
        </span>
      )}
      {c.ability && (
        <span title={ABILITY_TEXT[c.ability].name} className={`absolute right-0.5 top-0.5 rounded px-1 font-bold text-white ${ABILITY_COLOR[c.ability]} ${size === 'sm' ? 'text-[9px]' : 'text-[11px]'}`}>
          {ABILITY_TEXT[c.ability].icon}
          {size !== 'sm' && <span className="ml-0.5">{ABILITY_TEXT[c.ability].name}</span>}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black via-black/80 to-transparent px-0.5 pb-0.5 pt-3">
        <Chip cls={`${chip} bg-amber-500`}>{atk}</Chip>
        {size !== 'sm' && <span className="mx-0.5 mb-0.5 min-w-0 flex-1 truncate text-center text-[10px] font-bold uppercase text-white">{c.name}</span>}
        <Chip cls={`${chip} ${hurt ? 'bg-red-700' : 'bg-red-600'}`}>{hp}</Chip>
      </div>
      {u?.ability === 'guard' && <div className="pointer-events-none absolute inset-0 rounded-md ring-4 ring-inset ring-sky-400/80" />}
    </div>
  );
}

function CardBack({ className = '' }: { className?: string }) {
  return <div className={`aspect-[2/3] rounded-md border border-black bg-[repeating-linear-gradient(45deg,#db2777_0_6px,#111_6px_12px)] shadow ${className}`} />;
}

function HeroPortrait({ h, hp, size = 'md' }: { h: HeroInfo; hp?: number; size?: 'md' | 'lg' }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg border-2 border-fuchsia-500 bg-zinc-900 ${size === 'lg' ? 'h-28 w-20' : 'h-16 w-12 sm:h-20 sm:w-14'}`}>
      {h.img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={h.img} alt={h.name} draggable={false} className="h-full w-full object-cover object-top" />
      )}
      {hp !== undefined && (
        <span className="absolute bottom-0 right-0">
          <Chip cls="h-7 w-7 bg-red-600 text-sm">{Math.max(0, hp)}</Chip>
        </span>
      )}
    </div>
  );
}

function CardDetail({ c }: { c: CardInfo }) {
  return (
    <div className="text-xs text-zinc-300">
      <div className="font-bold text-white">
        {c.name} <span className="text-zinc-400">· {c.layer} · {c.rarity}</span>
      </div>
      <div>
        Cost {c.cost} · ATK {c.atk} · HP {c.hp} · {STATS.map((s, i) => `${STAT_ABBR[s]} ${c.stats[i]}`).join(' ')}
      </div>
      {c.ability ? (
        <div className="text-amber-300">
          {ABILITY_TEXT[c.ability].icon} {ABILITY_TEXT[c.ability].name}: {ABILITY_TEXT[c.ability].text}
        </div>
      ) : (
        <div className="text-zinc-500">No ability (no attribute at 2).</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tutorial

const TUTORIAL: { title: string; body: ReactNode }[] = [
  { title: 'Ninja Punk Girls: Card Battle', body: <>Two NPG heroes, two decks of {DECK_SIZE} NPG element cards. Bring the enemy hero from {HERO_HP} HP to 0 to win.</> },
  {
    title: 'Cards come from NPG attributes',
    body: (
      <>
        Every element card carries six attributes (STR, SPD, SKL, STA, STL, STY). The total sets the <b className="text-blue-400">cost</b>; STR/SKL/SPD lean it to <b className="text-amber-400">ATK</b>, STA/STL/STY to <b className="text-red-400">HP</b>; rarer cards get bonus points. A card whose top attribute is 2 gets that attribute&apos;s ability.
      </>
    ),
  },
  {
    title: 'Abilities',
    body: (
      <ul className="space-y-0.5">
        {(Object.keys(ABILITY_TEXT) as Ability[]).map((a) => (
          <li key={a}>
            <span className={`mr-1 rounded px-1 text-white ${ABILITY_COLOR[a]}`}>
              {ABILITY_TEXT[a].icon} {ABILITY_TEXT[a].name}
            </span>
            {ABILITY_TEXT[a].text}
          </li>
        ))}
      </ul>
    ),
  },
  { title: 'Energy and turns', body: <>Each turn your energy refills and grows by 1 (up to 8), and you draw a card. Tap a card in your hand to see it, tap again to play it into your row (max {BOARD_MAX} fighters).</> },
  { title: 'Attacking', body: <>Fighters can attack the turn after they arrive (Rush: right away). Tap a glowing fighter, then tap an enemy fighter or the enemy hero. A fighter you attack hits back. Guards must be attacked first; Shadows can&apos;t be targeted until they strike.</> },
  {
    title: 'Hero power',
    body: (
      <>
        Your NPG girl&apos;s top attribute gives her a power, once per turn for {POWER_COST} energy:
        <ul className="mt-1 space-y-0.5">
          {Object.values(POWER_TEXT).map((p) => (
            <li key={p.name}>
              {p.icon} <b>{p.name}</b>: {p.text}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  { title: 'Ready?', body: <>Build your own deck in the Deck Builder (or use the auto deck), then fight the AI on Easy or Hard, or send a friend a room link for an online match.</> },
];

function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = TUTORIAL[i];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="w-full max-w-md rounded-xl border-2 border-fuchsia-500 bg-zinc-950 p-4 text-sm text-zinc-200 shadow-[0_0_30px_#c026d3]">
        <div className="mb-1 text-[10px] tracking-widest text-zinc-500">
          HOW TO PLAY · {i + 1}/{TUTORIAL.length}
        </div>
        <h2 className="mb-2 text-lg font-black text-fuchsia-400">{s.title}</h2>
        <div className="min-h-[120px]">{s.body}</div>
        <div className="mt-3 flex justify-between gap-2">
          <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white">
            Skip
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="rounded border border-zinc-600 px-3 py-1 hover:border-white">
                Back
              </button>
            )}
            <button onClick={() => (i + 1 < TUTORIAL.length ? setI(i + 1) : onClose())} className="rounded bg-fuchsia-600 px-3 py-1 font-bold text-white hover:bg-fuchsia-500">
              {i + 1 < TUTORIAL.length ? 'Next' : 'Let’s fight'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- deck builder

function DeckBuilder({ pool, deck, setDeck, onDone }: { pool: CardInfo[]; deck: string[]; setDeck: (d: string[]) => void; onDone: () => void }) {
  const [ability, setAbility] = useState<Ability | 'none' | 'all'>('all');
  const [cost, setCost] = useState<number | 0>(0);
  const [q, setQ] = useState('');
  const [peek, setPeek] = useState<CardInfo | null>(null);
  const byId = useMemo(() => Object.fromEntries(pool.map((c) => [c.id, c])), [pool]);
  const count = (id: string) => deck.filter((x) => x === id).length;
  const shown = pool
    .filter((c) => (ability === 'all' ? true : ability === 'none' ? !c.ability : c.ability === ability))
    .filter((c) => !cost || (cost === 6 ? c.cost >= 6 : c.cost === cost))
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.layer.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.cost - b.cost || b.atk + b.hp - (a.atk + a.hp));
  const curve = [1, 2, 3, 4, 5, 6].map((n) => deck.filter((id) => byId[id] && Math.min(6, byId[id].cost) === n).length);
  const err = validDeck(deck, byId);
  const add = (c: CardInfo) => {
    setPeek(c);
    if (deck.length < DECK_SIZE && count(c.id) < MAX_COPIES) setDeck([...deck, c.id]);
  };
  const remove = (id: string) => {
    const i = deck.lastIndexOf(id);
    if (i >= 0) setDeck([...deck.slice(0, i), ...deck.slice(i + 1)]);
  };
  const grouped = [...new Set(deck)].map((id) => byId[id]).filter(Boolean).sort((a, b) => a.cost - b.cost);
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <section className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards" className="w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white" />
          {(['all', ...Object.keys(ABILITY_TEXT), 'none'] as (Ability | 'all' | 'none')[]).map((a) => (
            <button key={a} onClick={() => setAbility(a)} className={`rounded px-2 py-1 ${ability === a ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {a === 'all' ? 'All' : a === 'none' ? 'Plain' : `${ABILITY_TEXT[a].icon} ${ABILITY_TEXT[a].name}`}
            </button>
          ))}
          <span className="ml-1 text-zinc-500">Cost</span>
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} onClick={() => setCost(n)} className={`rounded px-2 py-1 ${cost === n ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {n === 0 ? 'Any' : n === 6 ? '6+' : n}
            </button>
          ))}
        </div>
        {peek && (
          <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/80 p-2">
            <CardDetail c={peek} />
          </div>
        )}
        <div className="grid max-h-[62vh] grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-6 md:grid-cols-7">
          {shown.map((c) => {
            const n = count(c.id);
            return (
              <button key={c.id} onClick={() => add(c)} onContextMenu={(e) => (e.preventDefault(), remove(c.id))} title={`${c.name}: tap to add`} className={`relative text-left transition hover:-translate-y-0.5 ${n >= MAX_COPIES ? 'opacity-40' : ''}`}>
                <CardFace c={c} size="sm" />
                {n > 0 && <span className="absolute -right-1 -top-1 z-10 rounded-full bg-fuchsia-600 px-1.5 text-[10px] font-bold text-white">×{n}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <aside className="w-full shrink-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2 lg:w-64">
        <div className="flex items-baseline justify-between">
          <h3 className="font-black text-fuchsia-400">Your deck</h3>
          <span className={`text-sm font-bold ${deck.length === DECK_SIZE ? 'text-emerald-400' : 'text-amber-400'}`}>
            {deck.length}/{DECK_SIZE}
          </span>
        </div>
        <div className="my-2 flex h-12 items-end gap-1" aria-label="Mana curve">
          {curve.map((n, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="w-full rounded-t bg-blue-600" style={{ height: `${Math.min(100, n * 12)}%` }} />
              <span className="text-[9px] text-zinc-500">{i === 5 ? '6+' : i + 1}</span>
            </div>
          ))}
        </div>
        <ul className="max-h-56 space-y-0.5 overflow-y-auto text-xs lg:max-h-[38vh]">
          {grouped.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <span className="w-4 rounded bg-blue-600 text-center font-bold text-white">{c.cost}</span>
              <button onClick={() => setPeek(c)} className="min-w-0 flex-1 truncate text-left text-zinc-200 hover:text-white">
                {c.name} <span className="text-zinc-500">{c.atk}/{c.hp}</span> {c.ability && ABILITY_TEXT[c.ability].icon}
              </button>
              <span className="text-zinc-400">×{count(c.id)}</span>
              <button onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`} className="px-1 text-red-400 hover:text-red-300">
                −
              </button>
            </li>
          ))}
          {!deck.length && <li className="text-zinc-500">Tap cards to add them (max {MAX_COPIES} each).</li>}
        </ul>
        {err && deck.length > 0 && <p className="mt-1 text-[11px] text-amber-400">{err}</p>}
        <div className="mt-2 flex flex-wrap gap-1 text-xs">
          <button onClick={() => setDeck(autoDeck(pool, Math.floor(Math.random() * 1e9)))} className="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700">
            Auto-build
          </button>
          <button onClick={() => setDeck([])} className="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700">
            Clear
          </button>
          <button onClick={onDone} disabled={!!err} className="ml-auto rounded bg-fuchsia-600 px-3 py-1 font-bold text-white disabled:opacity-40">
            Done
          </button>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- main

export default function CardBattle({ pool, heroes, ownedHeroes = [], storageKey, net, roomPrefix = 'npgcards-', payPlay, beforeStartAI, sfx, renderGameOver, badge, menuExtra, onScreen }: Props) {
  const cards = useMemo(() => Object.fromEntries(pool.map((c) => [c.id, c])), [pool]);
  const allHeroes = useMemo(() => [...ownedHeroes, ...heroes], [ownedHeroes, heroes]);
  const play = useCallback((n: SoundName) => (sfx ?? blip)(n), [sfx]);

  const initialRoom = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('room')?.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || null;
    } catch {
      return null;
    }
  }, []);
  const [screen, setScreenState] = useState<Screen>(initialRoom ? 'lobby' : 'menu');
  const setScreen = useCallback(
    (s: Screen) => {
      setScreenState(s);
      onScreen?.(s);
    },
    [onScreen],
  );
  const [heroId, setHeroId] = useState<string>(() => store.get(`${storageKey}:hero`) ?? '');
  const [deck, setDeckState] = useState<string[]>(() => {
    try {
      const d = JSON.parse(store.get(`${storageKey}:deck`) ?? '[]') as string[];
      if (Array.isArray(d) && !validDeck(d, cards)) return d;
    } catch {
      /* bad json */
    }
    return autoDeck(pool);
  });
  const setDeck = (d: string[]) => {
    setDeckState(d);
    if (!validDeck(d, cards)) store.set(`${storageKey}:deck`, JSON.stringify(d));
  };
  const [tutorial, setTutorial] = useState(() => !store.get(`${storageKey}:tutorial`));
  const [name, setName] = useState(() => store.get(`${storageKey}:name`) ?? '');
  const hero = allHeroes.find((h) => h.id === heroId) ?? allHeroes[0];
  const deckOk = !validDeck(deck, cards);

  const [game, setGame] = useState<Game | null>(null);
  const gRef = useRef<Game | null>(null);
  const [mySide, setMySide] = useState<0 | 1>(0);
  const sideRef = useRef<0 | 1>(0);
  const [vs, setVs] = useState<Vs>(initialRoom ? { kind: 'pvp', room: initialRoom } : { kind: 'ai', level: 'easy' });
  const [sel, setSel] = useState<{ kind: 'hand'; card: string } | { kind: 'unit'; uid: number } | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [anim, setAnim] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<GameResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const streak = useRef({ wins: 0, secs: 0 });
  const [streakView, setStreakView] = useState(0);
  const startedAt = useRef(0);
  const fxId = useRef(0);
  const vsRef = useRef(vs);
  useEffect(() => {
    vsRef.current = vs;
  }, [vs]);

  // ---- events → animations, sound, log
  const describe = useCallback(
    (g: Game, e: Ev, me: 0 | 1): string | null => {
      const who = (p: 0 | 1) => (p === me ? 'You' : g.sides[p].name);
      const unitName = (p: 0 | 1, uid: number) => {
        const u = g.sides[p].board.find((x) => x.uid === uid);
        return u ? g.cards[u.card]?.name : 'a fighter';
      };
      switch (e.k) {
        case 'play':
          return `${who(e.p)} played ${g.cards[e.card]?.name}`;
        case 'power':
          return `${who(e.p)} used ${POWER_TEXT[e.power].name}`;
        case 'attack':
          return `${who(e.p)}: ${unitName(e.p, e.uid)} → ${e.target === 'hero' ? g.sides[(1 - e.p) as 0 | 1].hero.name : unitName((1 - e.p) as 0 | 1, e.target)}`;
        case 'fatigue':
          return `${who(e.p)} took ${e.n} fatigue (empty deck)`;
        case 'draw':
          return e.burned ? `${who(e.p)} burned ${g.cards[e.burned]?.name} (hand full)` : null;
        case 'turn':
          return e.p === me ? '— Your turn —' : `— ${g.sides[e.p].name}’s turn —`;
        default:
          return null;
      }
    },
    [],
  );

  const handleEvents = useCallback(
    (before: Game, after: Game, ev: Ev[]) => {
      const me = sideRef.current;
      const newFx: Fx[] = [];
      const newAnim: Record<string, string> = {};
      const lines: string[] = [];
      const sounds = new Set<SoundName>();
      for (const e of ev) {
        const line = describe(e.k === 'attack' ? before : after, e, me);
        if (line) lines.push(line);
        const key = (p: 0 | 1, at: Target) => (at === 'hero' ? `h${p}` : `u${at}`);
        if (e.k === 'dmg') {
          newFx.push({ id: ++fxId.current, key: key(e.p, e.at), text: `-${e.n}`, cls: 'text-2xl text-red-500' });
          newAnim[key(e.p, e.at)] = 'npgc-shake';
          sounds.add('hit');
        } else if (e.k === 'heal') {
          newFx.push({ id: ++fxId.current, key: `h${e.p}`, text: `+${e.n}`, cls: 'text-2xl text-emerald-400' });
          sounds.add('power');
        } else if (e.k === 'fatigue') {
          newFx.push({ id: ++fxId.current, key: `h${e.p}`, text: `-${e.n}`, cls: 'text-2xl text-amber-400' });
          newAnim[`h${e.p}`] = 'npgc-shake';
        } else if (e.k === 'attack') {
          newAnim[`u${e.uid}`] = e.p === me ? 'npgc-up' : 'npgc-down';
          sounds.add('attack');
        } else if (e.k === 'play') sounds.add('play');
        else if (e.k === 'power') sounds.add('power');
        else if (e.k === 'die') sounds.add('die');
        else if (e.k === 'turn' && e.p === me) sounds.add('turn');
        else if (e.k === 'win') {
          const won = e.p === me;
          sounds.add(won ? 'win' : 'lose');
          const secs = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
          const v = vsRef.current;
          if (v.kind === 'ai') {
            if (won) streak.current = { wins: streak.current.wins + 1, secs: streak.current.secs + secs };
          }
          const r: GameResult = { won, vsAI: v.kind === 'ai', difficulty: v.kind === 'ai' ? v.level : null, rounds: Math.ceil(after.round / 2), secs, streak: streak.current.wins, streakSecs: streak.current.secs, hpLeft: Math.max(0, after.sides[me].hp) };
          if (v.kind === 'ai' && !won) streak.current = { wins: 0, secs: 0 };
          setStreakView(streak.current.wins);
          setTimeout(() => setResult(r), 700);
        }
      }
      if (sounds.size) for (const s of sounds) play(s);
      if (lines.length) setLog((l) => [...lines.reverse(), ...l].slice(0, 30));
      if (newFx.length) {
        setFx((f) => [...f, ...newFx]);
        const ids = new Set(newFx.map((f) => f.id));
        setTimeout(() => setFx((f) => f.filter((x) => !ids.has(x.id))), 1000);
      }
      if (Object.keys(newAnim).length) {
        setAnim((a) => ({ ...a, ...newAnim }));
        setTimeout(
          () =>
            setAnim((a) => {
              const n = { ...a };
              for (const k of Object.keys(newAnim)) if (n[k] === newAnim[k]) delete n[k];
              return n;
            }),
          450,
        );
      }
    },
    [describe, play],
  );

  const netRef = useRef<Net | null>(null);
  const commit = useCallback((g: Game | null) => {
    gRef.current = g;
    setGame(g);
  }, []);

  /** Apply an action locally (and send it to the opponent unless it came from them). */
  const run = useCallback(
    (a: Action, fromNet = false): boolean => {
      const g = gRef.current;
      if (!g) return false;
      const { g: n, ev } = apply(g, a);
      if (n === g) return false;
      commit(n);
      handleEvents(g, n, ev);
      if (!fromNet && vsRef.current.kind === 'pvp') netRef.current?.send('act', { seq: g.seq, a });
      return true;
    },
    [commit, handleEvents],
  );

  const mySetup = useCallback((): PlayerSetup => ({ name: (name || 'Player').slice(0, 16), hero, deck: deck.map((id) => cards[id]) }), [name, hero, deck, cards]);

  const begin = useCallback(
    (g: Game, side: 0 | 1) => {
      sideRef.current = side;
      setMySide(side);
      commit(g);
      setSel(null);
      setFx([]);
      setAnim({});
      setResult(null);
      setNotice(null);
      setLog([g.turn === side ? '— You go first —' : `— ${g.sides[g.turn].name} goes first —`]);
      startedAt.current = Date.now();
      setScreen('battle');
      play('turn');
    },
    [commit, play, setScreen],
  );

  const startAI = (level: Difficulty) => {
    if (!deckOk) return setScreen('deck');
    if (beforeStartAI && !beforeStartAI(streak.current.wins)) return;
    const v: Vs = { kind: 'ai', level };
    setVs(v);
    vsRef.current = v;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const aiHero = allHeroes.filter((h) => h.id !== hero.id)[seed % Math.max(1, allHeroes.length - 1)] ?? hero;
    const ai: PlayerSetup = { name: `${aiHero.name} (${level === 'hard' ? 'Hard' : 'Easy'} AI)`, hero: aiHero, deck: autoDeck(pool, seed + 1).map((id) => cards[id]) };
    const meFirst = seed % 2 === 0;
    const g = meFirst ? createGame(seed, mySetup(), ai) : createGame(seed, ai, mySetup());
    begin(g, meFirst ? 0 : 1);
  };

  // ---- AI turns
  useEffect(() => {
    if (!game || game.winner !== null || vs.kind !== 'ai' || game.turn === mySide || screen !== 'battle') return;
    const t = setTimeout(() => {
      const g = gRef.current;
      if (!g || g.turn === sideRef.current || g.winner !== null) return;
      const a = aiMove(g, vs.level);
      if (!run(a)) run({ t: 'end' });
    }, 750);
    return () => clearTimeout(t);
  }, [game, vs, mySide, run, screen]);

  // ---- online play
  const [room, setRoom] = useState<string | null>(initialRoom);
  const [netStatus, setNetStatus] = useState<NetStatus>('connecting');
  const [peers, setPeers] = useState<string[]>([]);
  const myId = useMemo(() => {
    if (!room) return '';
    const k = `npgc:id:${room}`;
    try {
      const v = sessionStorage.getItem(k) ?? randId();
      sessionStorage.setItem(k, v);
      return v;
    } catch {
      return randId();
    }
  }, [room]);
  const opp = useRef<{ id: string; setup: PlayerSetup } | null>(null);
  const [hasOpp, setHasOpp] = useState(false);
  const firstRef = useRef<string>('');
  const setupRef = useRef(mySetup);
  const beginRef = useRef(begin);
  const runRef = useRef(run);
  const commitRef = useRef(commit);
  useEffect(() => {
    setupRef.current = mySetup;
    beginRef.current = begin;
    runRef.current = run;
    commitRef.current = commit;
  }, [mySetup, begin, run, commit]);
  const inRoom = screen === 'lobby' || screen === 'battle';

  useEffect(() => {
    if (!room || !net || !inRoom || vs.kind !== 'pvp') return;
    const begin = (g: Game, side: 0 | 1) => beginRef.current(g, side);
    const run = (a: Action, fromNet: boolean) => runRef.current(a, fromNet);
    const commit = (g: Game) => commitRef.current(g);
    opp.current = null;
    const hello = () => n.send('hello', { id: myId, setup: setupRef.current() });
    const startAsHost = () => {
      const o = opp.current;
      if (!o || gRef.current) return;
      const seed = Math.floor(Math.random() * 2 ** 31);
      const first = seed % 2 ? myId : o.id;
      firstRef.current = first;
      const mine = setupRef.current();
      const g = first === myId ? createGame(seed, mine, o.setup) : createGame(seed, o.setup, mine);
      n.send('start', { to: o.id, seed, first, host: mine });
      begin(g, first === myId ? 0 : 1);
    };
    const n = net(`${roomPrefix}${room}`, myId, {
      onStatus: (s) => {
        setNetStatus(s);
        if (s === 'live') hello();
      },
      onPeers: (ids) => setPeers(ids),
      onMsg: (event, raw) => {
        const p = (raw ?? {}) as Record<string, unknown>;
        const from = typeof p.id === 'string' ? p.id : '';
        if (event === 'hello') {
          if (!from || from === myId) return;
          if (opp.current && opp.current.id !== from) return; // room taken: two players only
          const setup = sanitizeSetup(p.setup);
          if (!setup) return;
          const known = !!opp.current;
          opp.current = { id: from, setup };
          setHasOpp(true);
          if (!known) hello();
          const g = gRef.current;
          if (g) n.send('state', { id: myId, to: from, g, first: firstRef.current });
          else if (myId < from) startAsHost();
        } else if (event === 'start') {
          if (p.to !== myId || gRef.current || !opp.current) return;
          const host = sanitizeSetup(p.host);
          if (!host) return;
          const first = String(p.first);
          firstRef.current = first;
          const mine = setupRef.current();
          const seed = Number(p.seed) | 0;
          const g = first === myId ? createGame(seed, mine, host) : createGame(seed, host, mine);
          begin(g, first === myId ? 0 : 1);
        } else if (event === 'act') {
          const g = gRef.current;
          if (!g) return;
          const seq = Number(p.seq);
          if (seq === g.seq) {
            const a = p.a as Action;
            // Only the opponent's own moves are accepted from the wire.
            if (g.turn === sideRef.current && a.t !== 'concede') return;
            if (a.t === 'concede' && a.p === sideRef.current) return;
            run(a, true);
          } else if (seq > g.seq) n.send('sync', { id: myId, seq: g.seq });
        } else if (event === 'sync') {
          const g = gRef.current;
          if (g && opp.current?.id === from && g.seq > Number(p.seq ?? -1)) n.send('state', { id: myId, to: from, g, first: firstRef.current });
        } else if (event === 'state') {
          if (p.to !== myId) return;
          const g = p.g as Game;
          if (!g || !g.sides || typeof g.seq !== 'number') return;
          const cur = gRef.current;
          if (cur && cur.seq >= g.seq) return;
          firstRef.current = String(p.first);
          const side: 0 | 1 = firstRef.current === myId ? 0 : 1;
          if (!cur) begin(g, side);
          else {
            sideRef.current = side;
            setMySide(side);
            commit(g);
          }
        }
      },
    });
    netRef.current = n;
    // A dropped broadcast would leave us waiting forever: while it's the opponent's move, ask every
    // few seconds whether they're ahead of us (they answer with their state only if so).
    const poll = setInterval(() => {
      const g = gRef.current;
      if (g && g.winner === null && g.turn !== sideRef.current && opp.current) n.send('sync', { id: myId, seq: g.seq });
    }, 3000);
    return () => {
      clearInterval(poll);
      n.close();
      if (netRef.current === n) netRef.current = null;
    };
  }, [room, net, myId, vs.kind, inRoom, roomPrefix]);

  const oppOnline = vs.kind !== 'pvp' || !hasOpp || peers.length >= 2;
  const [awaySince, setAwaySince] = useState<number | null>(null);
  useEffect(() => {
    if (vs.kind !== 'pvp' || !game || game.winner !== null) return;
    const t = setTimeout(() => setAwaySince(oppOnline ? null : (s) => s ?? Date.now()), 0);
    return () => clearTimeout(t);
  }, [oppOnline, vs.kind, game]);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (awaySince === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [awaySince]);

  const createRoom = () => {
    if (!deckOk) return setScreen('deck');
    const slug = randId().slice(0, 6);
    openRoom(slug);
  };
  const openRoom = (slug: string) => {
    const v: Vs = { kind: 'pvp', room: slug };
    setVs(v);
    vsRef.current = v;
    commit(null);
    setRoom(slug);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('room', slug);
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* no history */
    }
    setScreen('lobby');
  };
  const leave = () => {
    const g = gRef.current;
    if (g && g.winner === null) run({ t: 'concede', p: sideRef.current });
    commit(null);
    setResult(null);
    if (vs.kind === 'pvp') {
      setRoom(null);
      setVs({ kind: 'ai', level: 'easy' });
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('room');
        window.history.replaceState(null, '', u.toString());
      } catch {
        /* no history */
      }
    }
    setScreen('menu');
  };

  // ---- player input
  const myTurn = !!game && game.winner === null && game.turn === mySide;
  const targets = useMemo(() => (game && myTurn && sel?.kind === 'unit' ? targetsFor(game, sel.uid) : []), [game, myTurn, sel]);
  const tapHand = (id: string) => {
    if (!game) return;
    play('click');
    if (sel?.kind === 'hand' && sel.card === id) {
      if (!myTurn || !canPlay(game, id)) return;
      if (payPlay && !payPlay()) return setNotice('Out of ammo: load more to keep playing LIVE, or play PRACTICE.');
      setNotice(null);
      run({ t: 'play', card: id });
      setSel(null);
    } else setSel({ kind: 'hand', card: id });
  };
  const tapMine = (u: Unit) => {
    if (!myTurn) return;
    if (sel?.kind === 'unit' && sel.uid === u.uid) return setSel(null);
    if (targetsFor(game!, u.uid).length) {
      play('click');
      setSel({ kind: 'unit', uid: u.uid });
    }
  };
  const tapTarget = (t: Target) => {
    if (sel?.kind !== 'unit' || !targets.includes(t)) return;
    run({ t: 'attack', uid: sel.uid, target: t });
    setSel(null);
  };
  const endTurn = () => {
    setSel(null);
    run({ t: 'end' });
  };

  useEffect(() => {
    if (screen !== 'battle') return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'e' || e.key === 'E') endTurn();
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const closeTutorial = () => {
    setTutorial(false);
    store.set(`${storageKey}:tutorial`, '1');
  };

  // ---------------------------------------------------------------- render
  const shell = (body: ReactNode) => (
    <div className="relative w-full text-zinc-100">
      <style>{CSS}</style>
      {tutorial && <Tutorial onClose={closeTutorial} />}
      {body}
    </div>
  );

  if (screen === 'deck')
    return shell(
      <div className="rounded-xl border border-zinc-800 bg-black/70 p-2 sm:p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-black text-fuchsia-400">Deck Builder</h2>
          <button onClick={() => setScreen('menu')} className="text-sm text-zinc-400 hover:text-white">
            ← Menu
          </button>
        </div>
        <DeckBuilder pool={pool} deck={deck} setDeck={setDeck} onDone={() => setScreen('menu')} />
      </div>,
    );

  if (screen === 'menu' || (screen === 'lobby' && !game))
    return shell(
      <div className="rounded-xl border border-zinc-800 bg-black/70 p-3 sm:p-4">
        {screen === 'lobby' ? (
          <Lobby room={room ?? ''} status={net ? netStatus : 'off'} peers={peers.length} hero={hero} onLeave={leave} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white">
                  NINJA PUNK GIRLS <span className="text-fuchsia-500">CARD BATTLE</span>
                </h2>
                <p className="text-xs text-zinc-400">Pick your girl, build a {DECK_SIZE}-card deck from NPG element cards, fight.</p>
              </div>
              <button onClick={() => setTutorial(true)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-white">
                ? How to play
              </button>
            </div>
            <label className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
              Your name
              <input
                value={name}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^A-Za-z0-9 _.\-]/g, '').slice(0, 16);
                  setName(v);
                  store.set(`${storageKey}:name`, v);
                }}
                placeholder="Player"
                className="w-36 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white"
              />
            </label>
            <h3 className="mb-1 text-xs font-bold tracking-widest text-zinc-500">CHOOSE YOUR HERO {ownedHeroes.length > 0 && <span className="text-fuchsia-400">· your NPGs first</span>}</h3>
            <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
              {allHeroes.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setHeroId(h.id);
                    store.set(`${storageKey}:hero`, h.id);
                    play('click');
                  }}
                  className={`shrink-0 rounded-lg p-0.5 transition ${h.id === hero.id ? 'bg-fuchsia-500' : 'bg-transparent opacity-70 hover:opacity-100'}`}
                  title={`${h.name}: ${POWER_TEXT[h.power].name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.img} alt={h.name} loading="lazy" className="h-24 w-16 rounded-md object-cover object-top sm:h-32 sm:w-20" />
                  <div className="w-16 truncate text-center text-[10px] text-white sm:w-20">{h.name}</div>
                </button>
              ))}
            </div>
            <div className="mb-3 rounded border border-zinc-800 bg-zinc-900/70 p-2 text-xs">
              <b className="text-white">{hero.name}</b> · {STATS.map((s, i) => `${STAT_ABBR[s]} ${hero.stats[i]}`).join(' · ')}
              <div className="text-amber-300">
                Hero power {POWER_TEXT[hero.power].icon} {POWER_TEXT[hero.power].name} ({POWER_COST} energy): {POWER_TEXT[hero.power].text}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button onClick={() => startAI('easy')} className="rounded-lg bg-emerald-600 px-3 py-3 font-black text-white hover:bg-emerald-500">
                ▶ VS AI · EASY
              </button>
              <button onClick={() => startAI('hard')} className="rounded-lg bg-red-600 px-3 py-3 font-black text-white hover:bg-red-500">
                ▶ VS AI · HARD
              </button>
              <button onClick={createRoom} disabled={!net} className="rounded-lg bg-cyan-600 px-3 py-3 font-black text-white hover:bg-cyan-500 disabled:opacity-40" title={net ? 'Create a room and send the link' : 'Online play is not configured here'}>
                ⚔ PLAY ONLINE
              </button>
              <button onClick={() => setScreen('deck')} className="rounded-lg bg-zinc-800 px-3 py-3 font-black text-white hover:bg-zinc-700">
                🃏 DECK ({deck.length}/{DECK_SIZE})
              </button>
            </div>
            {!deckOk && <p className="mt-2 text-xs text-amber-400">Your deck isn&apos;t ready: open the Deck Builder.</p>}
            {streakView > 0 && <p className="mt-2 text-xs text-emerald-400">Win streak vs AI: {streakView}</p>}
            {menuExtra && <div className="mt-3">{menuExtra}</div>}
          </>
        )}
      </div>,
    );

  if (!game) return shell(null);
  const me = game.sides[mySide];
  const foe = game.sides[(1 - mySide) as 0 | 1];
  const foeSide = (1 - mySide) as 0 | 1;
  const selCard = sel?.kind === 'hand' ? cards[sel.card] ?? game.cards[sel.card] : null;
  const fxFor = (key: string) =>
    fx
      .filter((f) => f.key === key)
      .map((f) => (
        <span key={f.id} className={`npgc-float ${f.cls}`}>
          {f.text}
        </span>
      ));
  const away = awaySince !== null && now ? Math.floor((now - awaySince) / 1000) : 0;

  const unitCell = (u: Unit, p: 0 | 1) => {
    const mine = p === mySide;
    const c = game.cards[u.card];
    const canAct = mine && myTurn && targetsFor(game, u.uid).length > 0;
    const isTarget = !mine && targets.includes(u.uid);
    const selected = sel?.kind === 'unit' && sel.uid === u.uid;
    return (
      <button
        key={u.uid}
        onClick={() => (mine ? tapMine(u) : tapTarget(u.uid))}
        aria-label={`${c?.name} ${u.atk} attack ${u.hp} health${u.ability ? ` ${u.ability}` : ''}${canAct ? ', ready to attack' : ''}`}
        className={`npgc-in relative w-[18.5%] max-w-[112px] shrink-0 rounded-md transition ${selected ? '-translate-y-2 ring-4 ring-amber-400' : canAct ? 'npgc-ready' : ''} ${isTarget ? 'cursor-crosshair ring-4 ring-red-500' : ''}`}
      >
        <div className={anim[`u${u.uid}`] ?? ''}>{c && <CardFace c={c} u={u} size="sm" />}</div>
        {fxFor(`u${u.uid}`)}
      </button>
    );
  };

  const heroBar = (p: 0 | 1) => {
    const s = game.sides[p];
    const mine = p === mySide;
    const isTarget = !mine && targets.includes('hero');
    return (
      <div className={`flex items-center gap-2 ${mine ? '' : 'flex-row'}`}>
        <button onClick={() => !mine && tapTarget('hero')} aria-label={`${s.hero.name} ${s.hp} health`} className={`relative rounded-lg ${isTarget ? 'cursor-crosshair ring-4 ring-red-500' : ''} ${game.turn === p && game.winner === null ? 'shadow-[0_0_14px_#d946ef]' : ''}`}>
          <div className={anim[`h${p}`] ?? ''}>
            <HeroPortrait h={s.hero} hp={s.hp} />
          </div>
          {fxFor(`h${p}`)}
        </button>
        <div className="min-w-0 flex-1 text-xs">
          <div className="truncate font-bold text-white">
            {mine ? 'You' : s.name} <span className="font-normal text-zinc-400">· {s.hero.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-zinc-300">
            <span className="text-red-400">♥ {Math.max(0, s.hp)}/{HERO_HP}</span>
            <span className="text-blue-400" aria-label={`${s.energy} of ${s.maxEnergy} energy`}>
              {'◆'.repeat(Math.max(0, s.energy))}
              <span className="text-zinc-600">{'◇'.repeat(Math.max(0, s.maxEnergy - s.energy))}</span>
            </span>
            <span>🂠 {s.deck.length}</span>
            {!mine && <span>✋ {s.hand.length}</span>}
          </div>
        </div>
        {mine ? (
          <button
            onClick={() => run({ t: 'power' })}
            disabled={!myTurn || !canPower(game)}
            title={POWER_TEXT[s.hero.power].text}
            className="rounded-lg border-2 border-amber-400 bg-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-200 enabled:hover:bg-amber-500/40 disabled:opacity-35"
          >
            {POWER_TEXT[s.hero.power].icon} {POWER_TEXT[s.hero.power].name}
            <span className="ml-1 rounded bg-blue-600 px-1 text-white">{POWER_COST}</span>
          </button>
        ) : (
          <span title={POWER_TEXT[s.hero.power].text} className={`rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 ${s.powerUsed ? 'opacity-40' : ''}`}>
            {POWER_TEXT[s.hero.power].icon} {POWER_TEXT[s.hero.power].name}
          </span>
        )}
      </div>
    );
  };

  return shell(
    <div data-npgc-seq={game.seq} data-npgc-turn={game.turn} data-npgc-side={mySide} className={`relative overflow-hidden rounded-xl border border-zinc-800 bg-[radial-gradient(ellipse_at_center,#3b0764_0%,#09090b_70%)] p-2 sm:p-3 ${badge ? 'pb-10 sm:pb-10' : ''}`}>
      {badge}
      {/* top bar */}
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span>
          {vs.kind === 'ai' ? `VS AI · ${vs.level.toUpperCase()}` : `ONLINE · room ${vs.room}`} · round {Math.ceil(game.round / 2)}
        </span>
        <span className="flex gap-2">
          <button onClick={() => setTutorial(true)} className="hover:text-white">
            ? Rules
          </button>
          <button onClick={leave} className="hover:text-red-400">
            {game.winner === null ? 'Concede' : 'Menu'}
          </button>
        </span>
      </div>
      {heroBar(foeSide)}
      {/* enemy hand */}
      <div className="my-1 flex h-6 justify-center gap-0.5 overflow-hidden" aria-hidden>
        {foe.hand.map((_, i) => (
          <CardBack key={i} className="h-6 w-4" />
        ))}
      </div>
      {/* board */}
      <div className="rounded-lg border border-white/5 bg-black/30 p-1.5">
        <div className="flex min-h-[86px] items-center justify-center gap-1 sm:min-h-[150px] sm:gap-2">
          {foe.board.map((u) => unitCell(u, foeSide))}
          {!foe.board.length && <span className="text-xs text-zinc-600">No enemy fighters</span>}
        </div>
        <div className="my-1 flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-fuchsia-500/60 to-transparent" />
          <span className={`text-xs font-black tracking-widest ${myTurn ? 'text-fuchsia-300' : 'text-zinc-500'}`}>{game.winner !== null ? 'GAME OVER' : myTurn ? 'YOUR TURN' : vs.kind === 'ai' ? 'AI IS THINKING…' : 'OPPONENT’S TURN'}</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-fuchsia-500/60 to-transparent" />
        </div>
        <div className="flex min-h-[86px] items-center justify-center gap-1 sm:min-h-[150px] sm:gap-2">
          {me.board.map((u) => unitCell(u, mySide))}
          {!me.board.length && <span className="text-xs text-zinc-600">Play fighters from your hand</span>}
        </div>
      </div>
      <div className="mt-1.5">{heroBar(mySide)}</div>
      {/* selection / hints */}
      <div className="mt-1 min-h-[40px] rounded border border-zinc-800 bg-black/50 px-2 py-1">
        {selCard ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CardDetail c={selCard} />
            </div>
            <button
              onClick={() => tapHand(selCard.id)}
              disabled={!myTurn || !canPlay(game, selCard.id)}
              className="shrink-0 rounded bg-fuchsia-600 px-3 py-2 text-sm font-black text-white disabled:opacity-35"
            >
              PLAY ({selCard.cost})
            </button>
          </div>
        ) : sel?.kind === 'unit' ? (
          <p className="text-xs text-amber-300">Pick a target: a red-ringed enemy fighter{targets.includes('hero') ? ' or the enemy hero' : ''}. (Esc to cancel)</p>
        ) : (
          <p className="truncate text-xs text-zinc-400">{notice ?? log[0] ?? ''}</p>
        )}
      </div>
      {/* hand */}
      <div className="mt-1.5 flex items-end gap-1.5">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-0.5 pb-1 pt-3">
          {me.hand.map((id, i) => {
            const c = game.cards[id];
            const ok = myTurn && canPlay(game, id);
            const chosen = sel?.kind === 'hand' && sel.card === id;
            return (
              <button
                key={`${id}-${i}`}
                onClick={() => tapHand(id)}
                aria-label={`${c.name}, cost ${c.cost}, ${c.atk} attack ${c.hp} health${ok ? ', playable' : ''}`}
                className={`npgc-in w-[17%] min-w-[62px] max-w-[104px] shrink-0 rounded-md transition ${chosen ? '-translate-y-3 ring-4 ring-fuchsia-400' : ok ? 'ring-2 ring-emerald-400 hover:-translate-y-1' : 'opacity-60'}`}
              >
                <CardFace c={c} size="sm" />
              </button>
            );
          })}
        </div>
        <button onClick={endTurn} disabled={!myTurn} className="mb-1 shrink-0 rounded-lg bg-amber-500 px-3 py-4 text-sm font-black text-black shadow enabled:hover:bg-amber-400 disabled:opacity-30" title="End turn (E)">
          END
          <br />
          TURN
        </button>
      </div>
      {vs.kind === 'pvp' && !oppOnline && game.winner === null && (
        <div className="absolute inset-x-0 top-10 z-30 mx-auto w-fit rounded border-2 border-amber-400 bg-black/90 px-3 py-2 text-center text-xs text-amber-200">
          Opponent disconnected{away ? ` (${away}s)` : ''}. Waiting for them to come back…
          {away >= 45 && (
            <button onClick={() => run({ t: 'concede', p: foeSide }, true)} className="ml-2 rounded bg-amber-500 px-2 py-0.5 font-bold text-black">
              Claim win
            </button>
          )}
        </div>
      )}
      {/* game over */}
      {result && (
        <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/80 p-3">
          <div className="npgc-banner flex w-full max-w-sm flex-col items-center gap-2 rounded-xl border-2 border-fuchsia-500 bg-zinc-950 p-4 text-center">
            <div className={`text-4xl font-black ${result.won ? 'text-emerald-400' : 'text-red-500'}`}>{result.won ? 'VICTORY' : 'DEFEAT'}</div>
            <HeroPortrait h={result.won ? me.hero : foe.hero} size="lg" />
            <p className="text-xs text-zinc-400">
              {result.rounds} rounds · {result.secs}s · {result.won ? `${result.hpLeft} HP left` : `${foe.hero.name} wins`}
              {result.vsAI && <> · win streak {result.streak}</>}
            </p>
            {renderGameOver?.(result)}
            <div className="flex flex-wrap justify-center gap-2">
              {vs.kind === 'ai' ? (
                <button onClick={() => startAI(vs.level)} className="rounded bg-fuchsia-600 px-4 py-2 font-black text-white">
                  {result.won ? 'NEXT FIGHT' : 'REMATCH'}
                </button>
              ) : (
                <button onClick={() => openRoom(randId().slice(0, 6))} className="rounded bg-cyan-600 px-4 py-2 font-black text-white">
                  NEW ROOM
                </button>
              )}
              <button onClick={leave} className="rounded border border-zinc-600 px-4 py-2 text-zinc-200">
                MENU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
  );
}

function Lobby({ room, status, peers, hero, onLeave }: { room: string; status: NetStatus; peers: number; hero: HeroInfo; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === 'undefined' ? '' : window.location.href;
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <h2 className="text-xl font-black text-cyan-400">ONLINE MATCH · room {room}</h2>
      <HeroPortrait h={hero} size="lg" />
      <p className="text-sm text-zinc-300">
        {status === 'off' ? 'Online play is not available right now.' : status === 'connecting' ? 'Connecting…' : peers >= 2 ? 'Opponent found, dealing cards…' : 'Waiting for an opponent. Send them this link:'}
      </p>
      <div className="flex w-full max-w-md items-center gap-1">
        <input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white" aria-label="Room link" />
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
          className="rounded bg-cyan-600 px-3 py-1 text-xs font-bold text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">Both players bring their own hero and saved deck. Two players per room.</p>
      <button onClick={onLeave} className="text-xs text-zinc-400 hover:text-white">
        ← Back to menu
      </button>
    </div>
  );
}
