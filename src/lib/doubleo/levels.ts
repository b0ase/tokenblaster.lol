/**
 * Double-O Kweg: the five missions. Each map is a grid of SIZE-unit cells.
 *
 *   #  wall            .  floor           S  start            X  exit
 *   D  door (opens when anyone walks up)  Q  locked door (opens once the objective before the boss is done)
 *   C  crate           T  casino table    W  withdrawal desk  $  slot machine    V  pile of IOUs
 *   +  medkit          a  body armour     1 2  objective spots
 *   o  gold sat coin (score)   i  intel file (secret collectible)   k  adrenaline (8s speed boost)
 *   g  guard bot       p  paper-wallet goon   h  hazmat tech (Arena model)
 *   K  CZ boss   U  BRIAN boss   L  MICHAEL boss   Y  SAM boss (the yacht)   (parody names live in names.ts)
 *
 * Bosses are cartoon parody characters (parody names only; no real names, photos or logos).
 */

import { BRIAN, BRIAN_CO, CZ, CZ_EXCHANGE, MICHAEL, MINER, SAM, SAM_CO } from './names';

export const SIZE = 4;

export type Objective =
  | { kind: 'goto'; at: string; text: string }
  | { kind: 'plant'; at: string; text: string; secs: number }
  | { kind: 'boss'; text: string };

export type Theme = {
  wall: 'metal_plate' | 'castle_brick_07' | 'rough_block_wall' | 'rusty_metal_02' | 'painted_metal_shutter' | 'metal_grate_rusty' | 'corrugated_iron_02';
  trim: Theme['wall'];
  floor: 'concrete_floor_worn_001' | 'metal_grate_rusty' | null; // null = flat carpet colour
  carpet?: string;
  ceiling: string;
  fog: string;
  light: string; // ceiling panel colour
  ambient: number;
};

export type Level = {
  id: string;
  name: string;
  codename: string;
  brief: string;
  map: string[];
  objectives: Objective[];
  theme: Theme;
  signs: { at: [number, number]; text: string; face: 'n' | 's' | 'e' | 'w' }[];
};

export const LEVELS: Level[] = [
  {
    id: 'facility',
    name: 'The Facility',
    codename: 'MISSION 1',
    brief: 'A secret bunker mining fake blocks. Get into the server room, plant a real BSV node in their mainframe and get out before the guard bots wake up.',
    map: [
      '########################',
      '#So.#....o.C.....#....i#',
      '#..oD.....oC..g..D..1..#',
      '#...#..C......o..#.....#',
      '##D######D####...###D###',
      '#iC...#.....#.....ooo..#',
      '#.C...#..h..#..CC...p..#',
      '#..o..D.....D..........#',
      '#..g..#..C..#..CC..g...#',
      '###D#####D#####D########',
      '#o......#.oo....#.....i#',
      '#..C....D...g...D...2..#',
      '#..C.o..#..C..o.#....o.#',
      '#.+.k.g.#..a....#..h..X#',
      '########################',
    ],
    objectives: [
      { kind: 'goto', at: '1', text: 'Reach the server room' },
      { kind: 'plant', at: '2', text: 'Plant a BSV node in the mainframe', secs: 2.5 },
      { kind: 'goto', at: 'X', text: 'Get to the exit lift' },
    ],
    theme: { wall: 'metal_plate', trim: 'painted_metal_shutter', floor: 'concrete_floor_worn_001', ceiling: '#1a1d22', fog: '#07090c', light: '#cfe8ff', ambient: 0.55 },
    signs: [
      { at: [0, 7], text: 'FAKE BLOCKS: 0% REAL', face: 'e' },
      { at: [12, 14], text: 'PROOF OF WORK: PAUSED', face: 'n' },
      { at: [20, 0], text: 'SERVER ROOM', face: 's' },
      { at: [20, 9], text: 'MAINFRAME', face: 's' },
    ],
  },
  {
    id: 'tower',
    name: 'Exchange Tower',
    codename: 'MISSION 2',
    brief: `${CZ} runs the ${CZ_EXCHANGE} casino and calls it an exchange. Withdrawals have been "paused for maintenance" for 400 days. Unfreeze the desks and take him down.`,
    map: [
      '##########################',
      '#S....#.o.....$.$.$.....i#',
      '#o....D...o.o...o........#',
      '#..o..#..T...T....T..p...#',
      '###D###..................#',
      '#...o.#..T...T....T..o...#',
      '#k.p..#.........g........#',
      '#.....#D####D#####D#######',
      '#.+...#..o...#.....#....o#',
      '#.....D..p...#..a..D..1..#',
      '#.....#....o.#..i..#..g..#',
      '####D##########D######D###',
      '#.o...o...o...o...o......#',
      '#..$..W.W.W.W.W.W.W...$..#',
      '#..........2............i#',
      '#o...p..T....K...T...g...#',
      '#..$..o....p...........X.#',
      '##########################',
    ],
    objectives: [
      { kind: 'goto', at: '1', text: 'Find the withdrawal office' },
      { kind: 'plant', at: '2', text: 'Unfreeze the withdrawal desks', secs: 3 },
      { kind: 'boss', text: `Defeat ${CZ}` },
      { kind: 'goto', at: 'X', text: 'Take the express elevator out' },
    ],
    theme: { wall: 'castle_brick_07', trim: 'painted_metal_shutter', floor: null, carpet: '#4a0d14', ceiling: '#1c0d08', fog: '#0c0504', light: '#ffd27a', ambient: 0.6 },
    signs: [
      { at: [0, 13], text: 'PROOF OF RESERVES: TRUST ME', face: 'e' },
      { at: [25, 9], text: 'KYC REQUIRED', face: 'w' },
      { at: [12, 11], text: 'WITHDRAWALS: FROZEN', face: 's' },
      { at: [22, 7], text: 'OFFICE', face: 's' },
      { at: [9, 0], text: `${CZ_EXCHANGE.toUpperCase()} CASINO`, face: 's' },
    ],
  },
  {
    id: 'vault',
    name: 'The Vault',
    codename: 'MISSION 3',
    brief: `Deep under the city ${BRIAN} of ${BRIAN_CO} guards a vault of IOUs, and ${MICHAEL} sits on a pile he will never spend. Crack the vault, beat them both, escape.`,
    map: [
      '########################',
      '#S...#.o......#..o..C..#',
      '#.o..D...g....D...p.C.i#',
      '#....#..C...o.#........#',
      '##D#####D######D###D####',
      '#....k.#.......#.......#',
      '#..V..i#...1...#..g....#',
      '#.o....D..o..o.D.....o.#',
      '#.p....#.......#..a..p.#',
      '####Q###########Q#######',
      '#....o....o....o....o..#',
      '#..V..............V....#',
      '#.......U..g...L.......#',
      '#..V........i.....V....#',
      '#.+..................+.#',
      '#####D##############D###',
      '#o.........X..........o#',
      '########################',
    ],
    objectives: [
      { kind: 'plant', at: '1', text: 'Crack the vault of IOUs', secs: 3 },
      { kind: 'boss', text: `Defeat ${BRIAN} and ${MICHAEL}` },
      { kind: 'goto', at: 'X', text: 'Escape with the keys' },
    ],
    theme: { wall: 'rusty_metal_02', trim: 'metal_grate_rusty', floor: 'metal_grate_rusty', ceiling: '#101010', fog: '#050605', light: '#9effb8', ambient: 0.5 },
    signs: [
      { at: [0, 11], text: 'YOUR COINS ARE SAFE (WITH US)', face: 'e' },
      { at: [23, 13], text: 'IOU 4 BTC', face: 'w' },
      { at: [11, 4], text: 'VAULT', face: 's' },
      { at: [11, 9], text: 'NOT YOUR KEYS', face: 's' },
    ],
  },
  {
    id: 'farm',
    name: 'The Hash Farm',
    codename: 'MISSION 4',
    brief: `${MINER} built a mining farm that only mines empty blocks. Reach the cooling plant, flip the farm to big blocks, and get out before the rigs cook you.`,
    map: [
      '############################',
      '#S..o.#..C.C.C.C.C.C..#....#',
      '#.....D...............D..i.#',
      '#..o..#..C.C.C.C.C.C..#....#',
      '###D###.......g.......###D##',
      '#.....#..C.C.C.C.C.C..#....#',
      '#.k...D......g........D..1.#',
      '#.....#..C.C.C.C.C.C..#..p.#',
      '####D######D######D####D####',
      '#o...o.#.......#....+....o.#',
      '#.......D...h..D...p.......#',
      '#..CC..#.......#.....CC....#',
      '#..CC..#..o.o..#..g..CC..i.#',
      '###D#######D#####D######D###',
      '#....................o.....#',
      '#..o..C.......2.......C..o.#',
      '#.+...C...............C..a.#',
      '#i....p......g.......h....X#',
      '############################',
    ],
    objectives: [
      { kind: 'goto', at: '1', text: 'Find the cooling plant' },
      { kind: 'plant', at: '2', text: 'Flip the farm to big blocks', secs: 3.5 },
      { kind: 'goto', at: 'X', text: 'Get out through the loading bay' },
    ],
    theme: { wall: 'corrugated_iron_02', trim: 'metal_grate_rusty', floor: 'concrete_floor_worn_001', ceiling: '#0d1410', fog: '#040806', light: '#7affc0', ambient: 0.5 },
    signs: [
      { at: [0, 15], text: 'EMPTY BLOCKS = HAPPY BLOCKS', face: 'e' },
      { at: [27, 10], text: 'HASH FOR CASH', face: 'w' },
      { at: [12, 0], text: 'EMPTY BLOCKS ONLY', face: 's' },
      { at: [26, 4], text: 'COOLING', face: 's' },
      { at: [10, 13], text: 'CONTROL ROOM', face: 'n' },
    ],
  },
  {
    id: 'yacht',
    name: 'The Yacht',
    codename: 'MISSION 5',
    brief: `${SAM} of ${SAM_CO} is throwing a party on a yacht bought with customer deposits. Board it, recover the backdoor ledger, and settle the bill with the host.`,
    map: [
      '##########################',
      '#S..o..#.....$.....#.....#',
      '#......D...........D..i..#',
      '#..o...#..T....T...#..g..#',
      '####D###...........###D###',
      '#......#..T....T...#.....#',
      '#.k..p.#.....g.....#..1..#',
      '#......######D######.....#',
      '#..o...#...........#.o.p.#',
      '###D####...o...o...####D##',
      '#......D...........D.....#',
      '#..i...#..g..2.....#..+..#',
      '#..p...#...........#..a..#',
      '####Q################Q####',
      '#........................#',
      '#..o..T.h....Y.....T.p.o.#',
      '#.....$....$..g..$....+..#',
      '#..i....p....X......g....#',
      '##########################',
    ],
    objectives: [
      { kind: 'goto', at: '1', text: 'Get below deck' },
      { kind: 'plant', at: '2', text: 'Copy the backdoor ledger', secs: 3 },
      { kind: 'boss', text: `Settle the bill with ${SAM}` },
      { kind: 'goto', at: 'X', text: 'Jump to the speedboat' },
    ],
    theme: { wall: 'painted_metal_shutter', trim: 'metal_plate', floor: null, carpet: '#0e2a4a', ceiling: '#0a1420', fog: '#03070c', light: '#ffe7b0', ambient: 0.65 },
    signs: [
      { at: [0, 15], text: 'MARGIN CALL', face: 'e' },
      { at: [25, 15], text: 'CUSTOMER FUNDS BAR', face: 'w' },
      { at: [16, 0], text: 'VIP DECK', face: 's' },
      { at: [21, 4], text: 'BELOW DECK', face: 's' },
      { at: [13, 13], text: 'CUSTOMER FUNDS (SPENT)', face: 's' },
    ],
  },
];

/** Cells that block movement. Doors are handled separately (open/closed). */
export const SOLID = new Set(['#', 'C', 'T', 'W', '$', 'V']);
export const LOW = new Set(['C', 'T', 'W', '$', 'V']); // don't block sight
export const DOORS = new Set(['D', 'Q']);
