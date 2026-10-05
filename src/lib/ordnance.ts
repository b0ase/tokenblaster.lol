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
  /** The inscription art (square). */
  image: string;
  edition: number;
  rarity: Rarity;
  /** Inscription origin outpoint. Empty until minted. */
  origin: string;
};

/** Origin of the "1Sat Ordnance" collection inscription. Empty until minted. */
export const ORDNANCE_COLLECTION = '';
export const ORDNANCE_COLLECTION_NAME = '1Sat Ordnance';
export const ORDNANCE_APP = 'tokenblaster.lol';

export const ORDNANCE: Ordnance[] = [
  {
    id: 'pnee-shotgun',
    name: 'PNEE Shotgun',
    tagline: 'Ten pellets of pure PNEE.',
    description: 'A sawed-off that sprays ten pellets of PNEE per pull. Close range only. Recommended by four out of five maximalists who were standing too close.',
    base: 'sawedoff',
    stats: { fireMs: 520, pellets: 10, spread: 0.1, bolt: '#ffd27a', kick: 1.8 },
    tint: '#c08040',
    image: '/ordnance/pnee-shotgun.webp',
    edition: 210,
    rarity: 'common',
    origin: '',
  },
  {
    id: 'kweg-grenade-launcher',
    name: 'KWEG Grenade Launcher',
    tagline: 'Patent pending. Patent denied.',
    description: "Professor Kweg's quad-barrel lobber. Fires six fat plasma rounds that land somewhere near the target, like a pachyderm submarine parking.",
    base: 'quadplasma',
    stats: { fireMs: 420, pellets: 6, spread: 0.06, bolt: '#60ff90', kick: 1.4 },
    tint: '#40d070',
    image: '/ordnance/kweg-grenade-launcher.webp',
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
    name: 'Minigun of the Mempool',
    tagline: '45 shots a second, all unconfirmed.',
    description: 'Spins up faster than a fee spike. Every barrel is a different node with a different opinion about what you just fired.',
    base: 'minigun',
    stats: { fireMs: 22, pellets: 1, spread: 0.05, bolt: '#ff8040', kick: 0.2 },
    tint: '#ff6a30',
    image: '/ordnance/minigun-of-the-mempool.webp',
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
];

export const isMinted = (o: Ordnance) => Boolean(o.origin);
export const RARITY_COLOR: Record<Rarity, string> = { common: '#c9b37a', rare: '#6ae0ff', epic: '#c070ff', legendary: '#ffd700' };

/** 1Sat MAP metadata for one edition of a weapon (collectionItem). */
export function ordnanceMap(o: Ordnance, mintNumber: number, collectionId = ORDNANCE_COLLECTION): Record<string, string> {
  const traits = [
    { name: 'Rarity', value: o.rarity },
    { name: 'Base', value: o.base },
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
