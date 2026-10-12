/**
 * The seven acts. Missions marked `planned` are in the journal but not playable yet; the build order lives in
 * docs/satoshi-city-vision.md §4.
 */
import type { Act } from './types';

export const ACTS: Act[] = [
  {
    n: 0,
    title: 'Prologue: The Stick',
    district: 'genesis',
    opener: 'prologue',
    chapters: [
      {
        id: 'p.1',
        title: 'Crash',
        missions: [
          { id: 'p.1.steal', title: 'Get Wheels', giver: 'hashcat', district: 'genesis', objectives: [{ kind: 'steal', what: 'any car', label: 'Steal a car (F)' }] },
          { id: 'p.1.escape', title: 'Unconfirmed', giver: 'hashcat', district: 'genesis', objectives: [{ kind: 'escape', heat: 1, label: 'Lose the Miners' }], planned: true },
        ],
      },
    ],
  },
  {
    n: 1,
    title: 'Genesis',
    district: 'genesis',
    chapters: [
      {
        id: '1.1',
        title: 'Learning the Streets',
        missions: [
          { id: '1.1.deliver', title: 'First Block', giver: 'hashcat', district: 'genesis', objectives: [{ kind: 'deliver', label: 'Deliver the block to the red beam' }] },
          { id: '1.1.rush', title: 'Mempool Rush', giver: 'hashcat', district: 'genesis', objectives: [{ kind: 'checkpoints', count: 6, label: 'Hit 6 checkpoints before the block lands' }] },
          { id: '1.1.noodles', title: 'Noodles', giver: 'uncle', district: 'genesis', objectives: [{ kind: 'talk', who: 'uncle', label: 'Buy noodles. Ask questions. Get nothing.' }], evidence: { spook: 0 }, planned: true },
        ],
      },
      {
        id: '1.2',
        title: 'Half a Signature',
        missions: [
          { id: '1.2.lawyers', title: 'Served', giver: 'professor', district: 'genesis', objectives: [{ kind: 'escape', heat: 2, label: 'Outrun the Professor\'s process servers' }], evidence: { conman: 1 }, planned: true },
          { id: '1.2.billboard', title: 'Forty Degrees', giver: 'professor', district: 'genesis', objectives: [{ kind: 'checkpoints', count: 5, label: 'Deface five of the Professor\'s billboards' }], standing: { professor: -1, keepers: 1 }, planned: true },
        ],
      },
    ],
  },
  { n: 2, title: 'Silk Row', district: 'silk-row', chapters: [{ id: '2.1', title: 'Five Stars', missions: [{ id: '2.1.escrow', title: 'Escrow', giver: 'dpr', district: 'silk-row', objectives: [{ kind: 'deliver', label: 'Carry the package. Don\'t open it.' }], standing: { dpr: 1 }, planned: true }] }] },
  { n: 3, title: 'Orphan Alley', district: 'orphan-alley', chapters: [{ id: '3.1', title: 'Stale Tips', missions: [{ id: '3.1.rooftops', title: 'Rooftops', giver: 'hashcat', district: 'orphan-alley', objectives: [{ kind: 'escape', heat: 3, label: 'Lose them over the rooftops' }], planned: true }] }] },
  { n: 4, title: 'Fork Wars', district: 'interchange', chapters: [{ id: '4.1', title: 'The Split', missions: [{ id: '4.1.turf', title: 'Turf', giver: 'suit', district: 'interchange', objectives: [{ kind: 'survive', blocks: 3, label: 'Hold the interchange for three blocks' }], standing: { suits: 1 }, planned: true }] }] },
  { n: 5, title: 'The Docks', district: 'docks', chapters: [{ id: '5.1', title: 'Block Ship', missions: [{ id: '5.1.smuggle', title: 'Unconfirmed Cargo', giver: 'hashcat', district: 'docks', objectives: [{ kind: 'steal', what: 'the missing half', label: 'Get the stick\'s other half off the block-ship' }], planned: true }] }] },
  { n: 6, title: 'Small Block Heights', district: 'small-block', chapters: [{ id: '6.1', title: 'Tiny Doors', missions: [{ id: '6.1.infiltrate', title: 'Verify', giver: 'keeper', district: 'small-block', objectives: [{ kind: 'goto', where: 'small-block', label: 'Get inside the enclave' }], evidence: { genius: 1, spook: 1 }, planned: true }] }] },
  { n: 7, title: 'The Exchange', district: 'exchange', chapters: [{ id: '7.1', title: 'Genesis Vault', missions: [{ id: '7.1.vault', title: '99 Floors', giver: 'professor', district: 'exchange', objectives: [{ kind: 'goto', where: 'exchange', label: 'Open the vault' }], planned: true }] }] },
];

export const allMissions = () => ACTS.flatMap((a) => a.chapters.flatMap((c) => c.missions));
