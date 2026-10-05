/**
 * Double-O Satoshi: the three missions. Each map is a grid of SIZE-unit cells.
 *
 *   #  wall            .  floor           S  start            X  exit
 *   D  door (opens when anyone walks up)  Q  locked door (opens once the objective before the boss is done)
 *   C  crate           T  casino table    W  withdrawal desk  $  slot machine    V  pile of IOUs
 *   +  medkit          a  body armour     1 2  objective spots
 *   g  guard bot       p  paper-wallet goon   h  hazmat tech (Arena model)
 *   K  CZ boss   U  BRIAN boss   L  MICHAEL boss   (parody names live in names.ts)
 *
 * Bosses are cartoon parody characters (parody names only; no real names, photos or logos).
 */

import { BRIAN, BRIAN_CO, CZ, CZ_EXCHANGE, MICHAEL } from './names';

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
      '#S..#......C.....#.....#',
      '#...D......C..g..D..1..#',
      '#...#............#.....#',
      '##D######D####...###D###',
      '#.....#.....#..........#',
      '#.C...#..h..#..CC...p..#',
      '#.....D.....D..........#',
      '#..g..#.....#..CC......#',
      '###D###########D########',
      '#.......#.......#......#',
      '#..C....D...g...D...2..#',
      '#..C....#.......#......#',
      '#.+...g.#..a....#..h..X#',
      '########################',
    ],
    objectives: [
      { kind: 'goto', at: '1', text: 'Reach the server room' },
      { kind: 'plant', at: '2', text: 'Plant a BSV node in the mainframe', secs: 2.5 },
      { kind: 'goto', at: 'X', text: 'Get to the exit lift' },
    ],
    theme: { wall: 'metal_plate', trim: 'painted_metal_shutter', floor: 'concrete_floor_worn_001', ceiling: '#1a1d22', fog: '#07090c', light: '#cfe8ff', ambient: 0.55 },
    signs: [
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
      '#S....#.......$.$.$......#',
      '#.....D..................#',
      '#.....#..T...T....T..p...#',
      '###D###..................#',
      '#.....#..T...T....T......#',
      '#..p..#.........g........#',
      '#.....######D#####D#######',
      '#.+...#......#.....#.....#',
      '#.....D..p...#..a..D..1..#',
      '#.....#......#.....#.....#',
      '####D##########D######D###',
      '#........................#',
      '#..$..W.W.W.W.W.W.W...$..#',
      '#..........2.............#',
      '#....p.......K.......g...#',
      '#..$...................X.#',
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
      '#S...#........#........#',
      '#....D...g....D...p....#',
      '#....#........#........#',
      '##D#####D##########D####',
      '#......#.......#.......#',
      '#..V...#...1...#..g....#',
      '#......D.......D.......#',
      '#.p....#.......#..a....#',
      '####Q###########Q#######',
      '#......................#',
      '#..V..............V....#',
      '#.......U......L.......#',
      '#..V..............V....#',
      '#.+..................+.#',
      '#####D##############D###',
      '#..........X...........#',
      '########################',
    ],
    objectives: [
      { kind: 'plant', at: '1', text: 'Crack the vault of IOUs', secs: 3 },
      { kind: 'boss', text: `Defeat ${BRIAN} and ${MICHAEL}` },
      { kind: 'goto', at: 'X', text: 'Escape with the keys' },
    ],
    theme: { wall: 'rusty_metal_02', trim: 'metal_grate_rusty', floor: 'metal_grate_rusty', ceiling: '#101010', fog: '#050605', light: '#9effb8', ambient: 0.5 },
    signs: [
      { at: [11, 4], text: 'VAULT', face: 's' },
      { at: [11, 9], text: 'NOT YOUR KEYS', face: 's' },
    ],
  },
];

/** Cells that block movement. Doors are handled separately (open/closed). */
export const SOLID = new Set(['#', 'C', 'T', 'W', '$', 'V']);
export const LOW = new Set(['C', 'T', 'W', '$', 'V']); // don't block sight
export const DOORS = new Set(['D', 'Q']);
