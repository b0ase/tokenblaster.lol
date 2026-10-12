/**
 * The cast and the map. Every character is a fictional parody; who anyone "really" is stays an in-world
 * rumour the game never settles (docs/satoshi-city-vision.md, satire rule).
 */
import type { Character, CharacterId, District, DistrictId } from './types';

export const CAST: Record<CharacterId, Character> = {
  anon: { id: 'anon', name: 'Anon', role: 'Courier. Holding a USB stick nobody should have.', colour: '#ff3fb4' },
  professor: { id: 'professor', name: 'Dr. Greg Wrongly', role: '"The Professor." Forty degrees, one claim, zero signatures.', faction: 'professor', colour: '#ffc83d' },
  keeper: { id: 'keeper', name: 'The Keeper', role: 'Hooded maintainer of the Small Block. Don\'t trust, verify.', faction: 'keepers', colour: '#ff8a1f' },
  dpr: { id: 'dpr', name: 'Dread Pirate Robots', role: 'Masked kingpin of Silk Row. The mask has had many faces.', faction: 'dpr', colour: '#28e7ff' },
  hashcat: { id: 'hashcat', name: 'Hashcat', role: 'Orphan Alley fixer, 19, paranoid, probably double-crossing someone.', colour: '#9dff3d' },
  uncle: { id: 'uncle', name: 'Uncle Nakamoto', role: 'Runs the noodle cart. Says nothing useful. Ever.', colour: '#f2efe6' },
  suit: { id: 'suit', name: 'The Suit', role: 'Venture fund partner and ETF desk. Would love to custody that for you.', faction: 'suits', colour: '#9aa7b8' },
  miner: { id: 'miner', name: 'Miner Patrol', role: 'City police and city tax. Accepts fees.', faction: 'miners', colour: '#ff3b5c' },
  grox: { id: 'grox', name: 'Mt. Grox', role: 'Collapsed-exchange card café. The coins are "just resting."', colour: '#c49bff' },
  narrator: { id: 'narrator', name: '', role: 'Caption text', colour: '#ffffff' },
};

export const DISTRICTS: Record<DistrictId, District> = {
  genesis: { id: 'genesis', name: 'Genesis Square', tagline: 'Gold statue, tourists, pickpockets.', act: 1, mood: 'neon-night' },
  'silk-row': { id: 'silk-row', name: 'Silk Row', tagline: 'Five stars. Trusted vendor. Do not ask.', act: 2, mood: 'market' },
  'orphan-alley': { id: 'orphan-alley', name: 'Orphan Alley', tagline: 'Where stale blocks go to die.', act: 3, mood: 'rain' },
  interchange: { id: 'interchange', name: 'The Mempool Interchange', tagline: 'Rush hour is the network.', act: 4, mood: 'motorway' },
  docks: { id: 'docks', name: "Miner's Docks", tagline: 'Every block is a ship.', act: 5, mood: 'industrial' },
  'small-block': { id: 'small-block', name: 'Small Block Heights', tagline: 'Tiny doors. Toll gates. Rail closed for maintenance.', act: 6, mood: 'gated' },
  exchange: { id: 'exchange', name: 'The Exchange', tagline: '99 floors. One vault.', act: 7, mood: 'glass' },
};
