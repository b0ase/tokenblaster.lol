/**
 * bRacer vehicles: what a team RACES IN, separate from what it races WITH.
 *
 * A team may name a `vehicle` (registry.ts). The vehicle is the body: its geometry, materials and animation. It is
 * purely cosmetic. Speed, grip, handling and the collision footprint come from the hull the player picked (SHIPS:
 * Needle/Wedge/Manta), identical for every team, and every vehicle returns the same Rig (../ships.ts), so the engine,
 * sim, AI, multiplayer and collision code do not know or care which body is on screen.
 *
 * Add a vehicle: write a builder `(spec, livery, accent, variant) => Rig`, add it to VEHICLES, and set `vehicle` on
 * the team in registry.ts. Unknown ids fall back to the standard ship.
 */
import type { ShipSpec } from '../sim';
import type { Livery } from '../teams';
import { buildShip, type Rig } from '../ships';
import { buildClaw, clawPresetFor, clawSpec, CLAW_PRESETS } from './claw';
import { buildJetBike } from './jetbike';
import { buildPaperPlane } from './paperplane';
import { seedOf, type Detail } from './kit';

export type { Detail };
export { CLAW_PRESETS, clawSpec, clawPresetFor, seedOf };

/** Which body to build, and which version of it. */
export type VehicleChoice = {
  /** Vehicle id (registry Team.vehicle). Missing or unknown = the standard ship. */
  vehicle?: string | null;
  /** Variant within the family (claw preset id). */
  variant?: string | null;
  /** Deterministic variation seed (claws). 0 = the variant exactly. */
  seed?: number;
  detail?: Detail;
  /** The player's own car (seen from the chase camera): drops clutter that only reads from outside. */
  own?: boolean;
};

type Builder = (spec: ShipSpec, l: Livery, accent: string, c: VehicleChoice) => Rig;

export const VEHICLES: Record<string, { name: string; build: Builder }> = {
  claw: { name: 'Jet claw', build: (s, l, a, c) => buildClaw(s, l, a, clawSpec(c.variant, c.seed ?? 0), c.detail) },
  jetbike: { name: 'Tesla jet-bike', build: (s, l, a, c) => buildJetBike(s, l, a, c.detail) },
  paperplane: { name: 'Blueprint paper plane', build: (s, l, a, c) => buildPaperPlane(s, l, a, c.detail, c.own) },
};

export const isVehicleId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(VEHICLES, id);

/** Build the body for a choice; the standard ship when the choice names no known vehicle. */
export function buildVehicle(c: VehicleChoice, spec: ShipSpec, l: Livery, accent: string): Rig {
  if (isVehicleId(c.vehicle)) return VEHICLES[c.vehicle].build(spec, l, accent, c);
  return buildShip(spec, l, accent);
}

/** Variant for the n-th car of a vehicle family on a grid (n = 0 is the player): claws all get different shapes. */
export function variantFor(vehicle: string | null | undefined, n: number): string | undefined {
  return vehicle === 'claw' ? clawPresetFor(n) : undefined;
}
