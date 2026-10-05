/**
 * 1Sat Ordnance: game weapons as real 1Sat ordinal NFTs. Own the inscription → the gun unlocks
 * in Double-O Kweg and the Arena. Each weapon rides on one of the arena gun models
 * (`base`, see GUNS in arenaHD.ts) with its own stats.
 *
 * `origin` is the outpoint of the weapon's first inscription (`<txid>_<vout>`). It is EMPTY until
 * the owner mints it (see /1satordnance/mint and README): empty = COMING SOON, nobody owns it.
 * `ORDNANCE_COLLECTION` is the origin of the collection inscription; every edition of a weapon
 * is a collectionItem pointing at it, so later editions are recognised by collection + name.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type Ordnance = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Arena gun model this weapon is built on. */
  base: 'minigun' | 'plasmarifle' | 'quadplasma' | 'sawedoff';
  /** Stats the games use: ms between shots, pellets per shot, spread (radians-ish), bolt colour, kick. */
  stats: { fireMs: number; pellets: number; spread: number; bolt: string; kick: number };
  /** Finish on the 3D model (blended into its materials). */
  tint?: string;
  /**
   * Its own 3D model: `public/arena/models/guns/<model>.glb` (credits in docs/ordnance-models.md).
   * Without one it uses the stock `base` model. `fit` tunes how it is held: `flip` turns a model
   * whose barrel points back at you, `roll` (radians, about the barrel) rights an upside-down or
   * sideways model, `length` is its size in first person.
   */
  model?: string;
  fit?: { flip?: boolean; roll?: number; length?: number; tint?: number };
  /** Hand-made inscription art (square). Without it the store renders the 3D model. */
  image?: string;
  edition: number;
  rarity: Rarity;
  /** Inscription origin outpoint of the owner-minted edition #1. Empty if none. */
  origin: string;
};

/** Store price per rarity, in sats (BSV ~$20 when set: 0.01 / 0.05 / 0.25 / 1 BSV). */
export const PRICE_SATS: Record<Rarity, number> = { common: 1_000_000, rare: 5_000_000, epic: 25_000_000, legendary: 100_000_000 };
export const priceOf = (o: Ordnance) => PRICE_SATS[o.rarity];

/** Site path of a weapon's 3D model. */
export const modelPath = (o: Ordnance) => `/arena/models/guns/${o.model ?? o.base}.glb`;
export const modelUrl = (o: Ordnance) => `https://www.tokenblaster.lol${modelPath(o)}`;

/** Store weapons with their own model file (named after the weapon); the rest use their base. */
const OWN_MODEL = new Set(['sat-stacker', 'op-return', 'nlocktime', 'p2pkh-pistolero', 'utxo-thumper', 'merkle-mauler', 'bitcoin-schema-sniper', 'block-reward', 'teranode-cannon', 'double-spend', 'fee-spike', 'hashpower-howitzer', 'genesis-blaster', 'craig-cannon', 'satoshi-sidearm', 'big-block']);

/** Per-model fixes, checked by eye in the store renders and the Arena (see `fit` on Ordnance). */
const FIT: Record<string, Ordnance['fit']> = {
  'big-block': { flip: true },
  'satoshi-sidearm': { flip: true, length: 0.42 },
  'fee-spike': { flip: true },
  'block-reward': { flip: true },
  'bitcoin-schema-sniper': { flip: true, length: 0.85 },
  'teranode-cannon': { flip: true },
  nlocktime: { flip: true, length: 0.8 },
  'p2pkh-pistolero': { flip: true, length: 0.42 },
  'genesis-blaster': { length: 0.42 },
  'op-return': { length: 0.45 },
  'utxo-thumper': { tint: 0.65 }, // untextured white: wear the full finish
  'hashpower-howitzer': { tint: 0.65 }, // untextured white
};

/** Origin of the "1Sat Ordnance" collection inscription. Empty until minted. */
export const ORDNANCE_COLLECTION = '';
export const ORDNANCE_COLLECTION_NAME = '1Sat Ordnance';
export const ORDNANCE_APP = 'tokenblaster.lol';

export const ORDNANCE: Ordnance[] = [
  {
    id: 'pnee-shotgun',
    model: 'pnee-shotgun',
    fit: { flip: true },
    name: 'PNEE Shotgun',
    tagline: 'Ten pellets of pure PNEE.',
    description: 'A sawed-off that sprays ten pellets of PNEE per pull. Close range only. Recommended by four out of five maximalists who were standing too close.',
    base: 'sawedoff',
    stats: { fireMs: 520, pellets: 10, spread: 0.1, bolt: '#ffd27a', kick: 1.8 },
    tint: '#c08040',
    edition: 210,
    rarity: 'common',
    origin: '',
  },
  {
    id: 'kweg-grenade-launcher',
    model: 'kweg-grenade-launcher',
    fit: { tint: 0.5, length: 0.62 }, // flat colours: lean on the finish
    name: 'KWEG Grenade Launcher',
    tagline: 'Patent pending. Patent denied.',
    description: "Professor Kweg's quad-barrel lobber. Fires six fat plasma rounds that land somewhere near the target, like a pachyderm submarine parking.",
    base: 'quadplasma',
    stats: { fireMs: 420, pellets: 6, spread: 0.06, bolt: '#60ff90', kick: 1.4 },
    tint: '#40d070',
    edition: 100,
    rarity: 'rare',
    origin: '',
  },
  {
    id: 'laser-eye-rifle',
    name: 'Laser-Eye Rifle',
    tagline: 'Zero spread. Zero chill.',
    description: 'Mount your laser eyes on a stock. Perfectly accurate, painfully red, and somehow still bullish while you reload.',
    base: 'plasmarifle',
    stats: { fireMs: 90, pellets: 1, spread: 0.002, bolt: '#ff2a2a', kick: 0.3 },
    tint: '#d02020',
    image: '/ordnance/laser-eye-rifle.webp',
    edition: 100,
    rarity: 'rare',
    origin: '',
  },
  {
    id: 'minigun-of-the-mempool',
    name: 'Mempool MiniGun',
    tagline: '45 shots a second, all unconfirmed.',
    description: 'Spins up faster than a fee spike. Every barrel is a different node with a different opinion about what you just fired.',
    base: 'minigun',
    stats: { fireMs: 22, pellets: 1, spread: 0.05, bolt: '#ff8040', kick: 0.2 },
    tint: '#ff6a30',
    edition: 50,
    rarity: 'epic',
    origin: '',
  },
  {
    id: 'safu-blaster',
    name: 'SAFU Blaster',
    tagline: 'Funds are safu. You are not.',
    description: 'Solid gold, boss drop, absurdly rare. Twin bolts at plasma speed. Said to have been confiscated from a custodian who swore everything was fine.',
    base: 'plasmarifle',
    stats: { fireMs: 45, pellets: 2, spread: 0.012, bolt: '#ffd700', kick: 0.5 },
    tint: '#ffc830',
    image: '/ordnance/safu-blaster.webp',
    edition: 21,
    rarity: 'legendary',
    origin: '',
  },
  // ---- Store stock (issued from /1satordnance/store; art is rendered from the tinted model) ----
  ...([
    ['sat-stacker', 'Sat Stacker', 'Stack sats. Stack bodies.', 'A plasma MG that never sells. Holds the trigger through every dip and every top.', 'plasmarifle', [60, 1, 0.014, '#ffb000', 0.4], '#e0a020', 300, 'common'],
    ['dust-sweeper', 'Dust Sweeper', 'Cleans up every last satoshi.', 'Sawed-off tuned for consolidating dust. Eight pellets, one UTXO at the end.', 'sawedoff', [560, 8, 0.09, '#d0c0a0', 1.5], '#9a8a70', 300, 'common'],
    ['op-return', 'OP_RETURN', 'Data goes in. Nothing comes back.', 'Provably unspendable rounds. Whatever it hits is written on chain forever.', 'plasmarifle', [70, 1, 0.01, '#9ae0ff', 0.35], '#5a8aa0', 300, 'common'],
    ['nlocktime', 'nLockTime', 'Fires when it feels like it.', 'Every round is time-locked to the next block. Slow, steady, final.', 'quadplasma', [380, 4, 0.03, '#a0ffd0', 1.0], '#50a080', 250, 'common'],
    ['p2pkh-pistolero', 'P2PKH Pistolero', 'Pay to public key hash. Or else.', 'The standard issue. Everyone has one, and it always works.', 'plasmarifle', [80, 1, 0.012, '#ffd27a', 0.3], '#b08850', 400, 'common'],
    ['utxo-thumper', 'UTXO Thumper', 'One input, many outputs.', 'Splits every shell into a spray of fresh outputs. Wallets hate it.', 'sawedoff', [500, 12, 0.12, '#ffa060', 1.9], '#a06030', 250, 'common'],
    ['merkle-mauler', 'Merkle Mauler', 'Proof of hit.', 'Four bolts hashed in pairs until only one answer is left: you lose.', 'quadplasma', [200, 4, 0.025, '#80ff80', 0.9], '#30a040', 120, 'rare'],
    ['bitcoin-schema-sniper', 'Schema Sniper', 'One shot. Properly formatted.', 'Tight as a MAP key. Barely any spread, all the metadata.', 'plasmarifle', [140, 1, 0.002, '#60c0ff', 0.8], '#3070c0', 120, 'rare'],
    ['block-reward', 'Block Reward', 'Halving every few seasons.', 'Belt-fed and generous, for now. Fire rate halves when the sequel comes out.', 'minigun', [30, 1, 0.04, '#ffd84a', 0.25], '#c09020', 100, 'rare'],
    ['teranode-cannon', 'Teranode Cannon', 'A million rounds a second. Allegedly.', 'Horizontally scaled quad plasma. The benchmarks are incredible.', 'quadplasma', [110, 4, 0.04, '#40e0ff', 0.9], '#2090c0', 100, 'rare'],
    ['double-spend', 'Double Spend', 'Fires twice. Only one counts.', 'Two pellets leave, the miners pick one. The other was never there.', 'sawedoff', [260, 2, 0.02, '#ff60a0', 1.0], '#b03070', 100, 'rare'],
    ['fee-spike', 'Fee Spike', 'Priced out? Not you.', 'Fires faster the busier the chain gets. On BSV that just means very fast.', 'minigun', [26, 1, 0.05, '#ff7a1a', 0.2], '#d05010', 60, 'epic'],
    ['hashpower-howitzer', 'Hashpower Howitzer', '51% of the room. Every time.', 'Six barrels of raw SHA-256. Rewrites whatever history you were having.', 'quadplasma', [300, 6, 0.05, '#ff3e9d', 1.6], '#a01860', 50, 'epic'],
    ['genesis-blaster', 'Genesis Blaster', 'The Times 03/Jan/2009.', 'Restored to the original protocol. Plasma rounds etched with a headline about banks.', 'plasmarifle', [40, 2, 0.01, '#fff1dc', 0.5], '#e8e0c8', 40, 'epic'],
    ['craig-cannon', 'Peer-to-Peer Cannon', 'Cash, electronic, aimed.', 'Section five of the whitepaper, in shotgun form. Nodes accept it by working on extending it.', 'sawedoff', [380, 14, 0.13, '#ffe58a', 2.0], '#c8a040', 40, 'epic'],
    ['satoshi-sidearm', "Satoshi's Sidearm", 'Nobody knows who carried it.', 'Untouched since 2010. Every bolt is signed with a key nobody has ever moved.', 'plasmarifle', [35, 2, 0.006, '#ffffff', 0.4], '#f5b800', 21, 'legendary'],
    ['big-block', 'BIG BLOCK', 'Unbounded.', 'A minigun with no block size limit. It does not stop. It does not cap. It scales.', 'minigun', [16, 1, 0.045, '#f5b800', 0.18], '#ffd24d', 21, 'legendary'],
  ] as const).map(([id, name, tagline, description, base, [fireMs, pellets, spread, bolt, kick], tint, edition, rarity]) => ({
    id, name, tagline, description, base, stats: { fireMs, pellets, spread, bolt, kick }, tint, edition, rarity, origin: '',
    ...(OWN_MODEL.has(id) ? { model: id, fit: FIT[id] } : {}),
  })),
];

export const isMinted = (o: Ordnance) => Boolean(o.origin);
export const RARITY_COLOR: Record<Rarity, string> = { common: '#c9b37a', rare: '#6ae0ff', epic: '#c070ff', legendary: '#ffd700' };

/** 1Sat MAP metadata for one edition of a weapon (collectionItem). */
export function ordnanceMap(o: Ordnance, mintNumber: number, collectionId = ORDNANCE_COLLECTION): Record<string, string> {
  const traits = [
    { name: 'Rarity', value: o.rarity },
    { name: 'Model', value: o.model ?? o.base },
    { name: 'Rate of fire', value: `${Math.round(1000 / o.stats.fireMs)}/s` },
    { name: 'Pellets', value: String(o.stats.pellets) },
    { name: 'Spread', value: String(o.stats.spread) },
    { name: 'Edition size', value: String(o.edition) },
  ];
  const subTypeData: Record<string, unknown> = { description: o.description, mintNumber: String(mintNumber), rank: String(mintNumber), rarityLabel: o.rarity.toUpperCase(), traits, attachments: [] };
  if (collectionId) subTypeData.collectionId = collectionId;
  return {
    app: ORDNANCE_APP,
    type: 'ord',
    name: `${o.name} #${mintNumber}`,
    subType: 'collectionItem',
    subTypeData: JSON.stringify(subTypeData),
    weapon: o.id,
    collection: ORDNANCE_COLLECTION_NAME,
    // For 3D display cabinets (bWalletX): the glTF this gun is built on, and its finish.
    model: modelUrl(o),
    tint: o.tint ?? '',
  };
}

/** 1Sat MAP metadata for the collection inscription itself. */
export function collectionMap(): Record<string, string> {
  return {
    app: ORDNANCE_APP,
    type: 'ord',
    name: ORDNANCE_COLLECTION_NAME,
    subType: 'collection',
    subTypeData: JSON.stringify({
      description: 'Weapons you actually own. Each gun is a 1Sat ordinal; hold it and it unlocks in Double-O Kweg and the Arena on tokenblaster.lol.',
      quantity: ORDNANCE.reduce((n, o) => n + o.edition, 0),
      rarityLabels: ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'],
      traits: {},
    }),
  };
}
