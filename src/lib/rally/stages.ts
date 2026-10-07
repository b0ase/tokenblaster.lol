/** The three rally stages: seeds, palettes, texture sets and how each one drives. */

export type StageId = 'forest' | 'desert' | 'snow';

export type Stage = {
  id: StageId;
  name: string;
  place: string;
  blurb: string;
  seed: number;
  length: number;
  /** Heading wander: [amplitude rad, wavelength m] sinusoids summed along the stage. */
  bends: [number, number][];
  hillAmp: number;
  /** Road elevation wander in metres. */
  rise: number;
  hdr: string;
  /** Texture set for the ground (public/rally/tex/<ground>_diff|nor.webp). */
  ground: string;
  groundTint: string;
  groundScale: number;
  roadTint: string;
  rockTint: string;
  /** Scenery palette. */
  leaf: [string, string, string];
  bark: string;
  rock: string;
  moss: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  dust: string;
  /** Tyre grip on the gravel road / off it, relative. */
  grip: number;
  offGrip: number;
  /** Falling snow. */
  snow: boolean;
  /** Scenery mix: tree models, density 0..1. */
  trees: string[];
  treeDensity: number;
  rocks: string[];
  rockDensity: number;
  bushes: string[];
  par: number;
  /** Sun elevation in degrees (time of day) and colour grade: [shadow rgb, highlight rgb, saturation, contrast]. */
  sunElev: number;
  grade: [number, number, number, number, number, number, number, number];
  sunCol: string;
};

export const STAGES: Record<StageId, Stage> = {
  forest: {
    id: 'forest',
    name: 'Mainnet Pines',
    place: 'Block 1 · pine forest',
    blurb: 'Tight, twisting gravel through tall pines. Trees do not move; learn the corners.',
    seed: 11,
    length: 1700,
    bends: [[0.55, 235], [0.45, 124], [0.2, 70]],
    hillAmp: 16,
    rise: 9,
    hdr: '/rally/hdr/forest.hdr',
    ground: 'forest',
    groundTint: '#a8a08a',
    groundScale: 7,
    roadTint: '#b09478',
    rockTint: '#8a8780',
    leaf: ['#2f6b34', '#3d7d3a', '#27572f'],
    bark: '#5a3b26',
    rock: '#7a7a76',
    moss: '#4c7a3c',
    fog: '#a9bccb',
    fogNear: 50,
    fogFar: 300,
    exposure: 0.95,
    dust: '#cbb89a',
    grip: 1,
    offGrip: 0.62,
    snow: false,
    trees: ['pine', 'pine', 'pine', 'pine', 'oak', 'birch'],
    treeDensity: 1,
    rocks: ['rock', 'rock', 'rockTall', 'stump', 'log'],
    rockDensity: 0.5,
    bushes: ['bush', 'fern', 'fern'],
    par: 108,
    sunElev: 46,
    sunCol: '#fff0d8',
    grade: [0.9, 1.03, 1.08, 1.08, 1.02, 0.9, 1.14, 1.08],
  },
  desert: {
    id: 'desert',
    name: 'Mempool Mesa',
    place: 'Block 2 · red desert',
    blurb: 'Fast sweepers across baked clay. Dust hangs, rocks bite, the sun is low.',
    seed: 29,
    length: 2000,
    bends: [[0.6, 420], [0.38, 190], [0.2, 80]],
    hillAmp: 22,
    rise: 8,
    hdr: '/rally/hdr/desert.hdr',
    ground: 'desert',
    groundTint: '#c98f68',
    groundScale: 9,
    roadTint: '#f0d6ac',
    rockTint: '#b8805a',
    leaf: ['#6f8a3a', '#7f9a44', '#5d7a32'],
    bark: '#6b4a30',
    rock: '#a8704e',
    moss: '#c9a24e',
    fog: '#e6b894',
    fogNear: 90,
    fogFar: 460,
    exposure: 0.9,
    dust: '#e0b890',
    grip: 0.92,
    offGrip: 0.55,
    snow: false,
    trees: ['palm'],
    treeDensity: 0.1,
    rocks: ['rock', 'rock', 'rockTall', 'cactus', 'cactus', 'cactusShort', 'cactusShort'],
    rockDensity: 1.3,
    bushes: ['bush', 'cactusShort'],
    par: 118,
    sunElev: 21,
    sunCol: '#ffc88a',
    grade: [0.95, 0.98, 1.1, 1.18, 1.0, 0.82, 1.2, 1.12],
  },
  snow: {
    id: 'snow',
    name: 'Orphan Ridge',
    place: 'Block 3 · snow ridge',
    blurb: 'Low grip, hairpins, falling snow. Smooth inputs or you are in the white.',
    seed: 47,
    length: 1800,
    bends: [[0.5, 280], [0.5, 120], [0.22, 66]],
    hillAmp: 26,
    rise: 11,
    hdr: '/rally/hdr/snow.hdr',
    ground: 'snow',
    groundTint: '#e9eef4',
    groundScale: 8,
    roadTint: '#a4a8ae',
    rockTint: '#9a9ea4',
    leaf: ['#2a4a3a', '#223f31', '#30573f'],
    bark: '#4a3a30',
    rock: '#8c9096',
    moss: '#f2f6fa',
    fog: '#c6d0da',
    fogNear: 40,
    fogFar: 250,
    exposure: 1.0,
    dust: '#f4f8fc',
    grip: 0.68,
    offGrip: 0.5,
    snow: true,
    trees: ['pine', 'pine', 'pine', 'deadpine'],
    treeDensity: 0.8,
    rocks: ['rock', 'rockTall', 'log', 'stump'],
    rockDensity: 0.6,
    bushes: ['bush'],
    par: 112,
    sunElev: 17,
    sunCol: '#dfe9ff',
    grade: [0.86, 0.98, 1.16, 1.0, 1.02, 1.08, 1.05, 1.06],
  },
};
export const STAGE_LIST = [STAGES.forest, STAGES.desert, STAGES.snow];

export type CarSpec = {
  id: string;
  name: string;
  model: string;
  blurb: string;
  /** Physics tuning. */
  power: number;
  top: number;
  grip: number;
  steer: number;
  mass: number;
  rearBias: number;
  scale: number;
  body: 'hatch' | 'coupe' | 'sedan' | 'wagon';
  base: string;
  accent: string;
  trim: string;
  number: string;
};

export const CARS: CarSpec[] = [
  { id: 'hatch', name: 'Satoshi GT', model: 'hatchback-sports', blurb: 'Balanced hot hatch. Forgiving, quick to rotate.', power: 1, top: 1, grip: 1, steer: 1, mass: 1, rearBias: 0.62, scale: 1.55, body: 'hatch', base: '#1747b8', accent: '#ff7a00', trim: '#f5f5f5', number: '7' },
  { id: 'race', name: 'Hash Rocket', model: 'race', blurb: 'Light open-wheel dart. Fastest, twitchy.', power: 1.18, top: 1.12, grip: 0.95, steer: 1.12, mass: 0.85, rearBias: 0.7, scale: 1.5, body: 'coupe', base: '#f2c200', accent: '#101010', trim: '#ffffff', number: '21' },
  { id: 'sedan', name: 'Block Sedan', model: 'sedan-sports', blurb: 'Planted four-door. Stable, a touch slower.', power: 0.94, top: 0.97, grip: 1.1, steer: 0.94, mass: 1.15, rearBias: 0.48, scale: 1.55, body: 'sedan', base: '#f2f2f2', accent: '#d41424', trim: '#14141a', number: '1' },
];
