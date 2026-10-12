/**
 * Cutscene scripts. Shots are camera setups relative to Genesis Square; lines play in order and each may cut
 * to a shot. Keep lines short: they're read over a moving city, not in a menu.
 */
import type { Cutscene } from './types';

export const CUTSCENES: Record<string, Cutscene> = {
  prologue: {
    id: 'prologue',
    title: 'PROLOGUE · THE STICK',
    shots: [
      { dayT: 0.93, x: 0, z: 27, yaw: 0, pitch: 0.12, dist: 14, hold: 0 }, // wide across the plaza to the statue, rain, neon
      { dayT: 0.93, x: 5, z: 13, yaw: 0.35, pitch: 0.38, dist: 8, hold: 0 }, // closer: the gold statue
      { dayT: 0.93, x: 0, z: 12, yaw: Math.PI, pitch: 0.1, dist: 3.4, hold: 0 }, // Anon's face
      { dayT: 0.93, x: 18, z: 22, yaw: 0.8, pitch: 0.55, dist: 22, hold: 0 }, // high and wide: they're coming
    ],
    lines: [
      { who: 'narrator', text: 'Satoshi City. Every car on these streets is a live transaction. The ledger never forgets.', shot: 0 },
      { who: 'narrator', text: 'Nobody agrees who built it. Plenty of people claim they did.', shot: 1 },
      { who: 'anon', text: 'Ow. Whose van was that? …Why am I holding a USB stick that says "wallet.dat, DO NOT"?', shot: 2 },
      { who: 'uncle', text: 'Noodles?' },
      { who: 'professor', text: '(on every billboard) That stick is MY property. My lawyers are on their way. All of them.', shot: 3 },
      { who: 'keeper', text: '(over a pirate radio) Don\'t give it to him. Don\'t give it to anyone. Run a node and run.' },
      { who: 'miner', text: 'Patrol to Genesis Square. Suspect is holding unconfirmed assets.' },
      { who: 'hashcat', text: 'Psst. Courier. Steal a car, lose the Miners, meet me in the alley. Don\'t trust anyone. Especially me.' },
    ],
  },
};
