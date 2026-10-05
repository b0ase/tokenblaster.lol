/**
 * 1Sat Ordnance ammo: one BSV-21 token per kind of round. In LIVE play an ordnance gun only fires
 * its own ammo (stock guns fire any token). The PNEE Shotgun fires real PNEE. The rest fire
 * TokenBlaster's minted fantasy ammo, sold as marketplace (OrdLock) listings from the owner's wallet.
 *
 * `id` is the BSV-21 token id (`<deploy txid>_0`). It is EMPTY until the owner deploys the token
 * from /1satordnance/ammo/mint?qbranch=1. While it is empty the gun is unrestricted, so nothing
 * becomes unplayable before the drop.
 */
import { ammoOf, type Ammo } from './ordnance';

export type AmmoDef = {
  kind: Ammo;
  sym: string;
  name: string;
  blurb: string;
  /** Icon inscribed with the token (and shown in the store). */
  icon: string;
  color: string;
  /** BSV-21 token id; empty until minted. */
  id: string;
  /** Fixed supply (house convention: 1B for internal tokens), whole rounds. */
  supply: bigint;
  dec: 0;
};

export const AMMO: Record<Ammo, AmmoDef> = {
  bullet: { kind: 'bullet', sym: '9MM', name: '9MM Rounds', blurb: 'Brass for every rifle, pistol, SMG and minigun in the armoury.', icon: '/ordnance/ammo/9mm.svg', color: '#ffd27a', id: '', supply: BigInt(1_000_000_000), dec: 0 },
  pellet: { kind: 'pellet', sym: 'SHELLS', name: '12-Gauge Shells', blurb: 'Buckshot for the shotguns. Close range, wide spread.', icon: '/ordnance/ammo/shells.svg', color: '#ff7a1a', id: '', supply: BigInt(1_000_000_000), dec: 0 },
  laser: { kind: 'laser', sym: 'BEAM', name: 'Beam Charges', blurb: 'Focused light for the laser rifles. Zero spread, zero chill.', icon: '/ordnance/ammo/beam.svg', color: '#ff2a2a', id: '', supply: BigInt(1_000_000_000), dec: 0 },
  plasma: { kind: 'plasma', sym: 'CELLS', name: 'Plasma Cells', blurb: 'Hot plasma for the blasters and the Teranode Cannon.', icon: '/ordnance/ammo/cells.svg', color: '#6ae0ff', id: '', supply: BigInt(1_000_000_000), dec: 0 },
  rocket: { kind: 'rocket', sym: 'RPG', name: 'Rockets', blurb: 'One warhead, one big problem. For the Hashpower Howitzer.', icon: '/ordnance/ammo/rpg.svg', color: '#9acd32', id: '', supply: BigInt(1_000_000_000), dec: 0 },
  grenade: { kind: 'grenade', sym: 'NADES', name: 'Grenades', blurb: 'Lobbed rounds for the KWEG Grenade Launcher. Patent pending.', icon: '/ordnance/ammo/nades.svg', color: '#40d070', id: '', supply: BigInt(1_000_000_000), dec: 0 },
};

/** Real tokens a specific gun insists on, matched by token id (never by ticker). PNEE: 2 decimals, 1 unit = 1 US cent. */
export type RealAmmo = { sym: string; id: string; name: string; buyUrl: string | null };
export const PNEE: RealAmmo = { sym: 'PNEE', id: '1599c4e49a28c7791295f50613e1545aa9246dd592ae8b8f696b81916a475ae4_0', name: 'PNEE', buyUrl: 'https://bwalletx.com/pnees' };
const OVERRIDE: Record<string, RealAmmo> = { 'pnee-shotgun': PNEE };

export type AmmoRule = { label: string; sym: string; ids: string[]; real: RealAmmo | null; def: AmmoDef | null };

/**
 * What an ordnance gun may fire in LIVE play, or null if it fires anything (a stock gun, or its
 * ammo hasn't been minted yet). `ids` are the accepted BSV-21 token ids (a real token with no
 * pinned id would fall back to its ticker; PNEE is pinned).
 */
export function requiredAmmo(ordnanceId: string | undefined): AmmoRule | null {
  if (!ordnanceId) return null;
  const real = OVERRIDE[ordnanceId];
  if (real) return { label: real.name, sym: real.sym, ids: real.id ? [real.id] : [], real, def: null };
  const def = AMMO[ammoOf({ id: ordnanceId })];
  if (!def.id) return null;
  return { label: def.name, sym: def.sym, ids: [def.id], real: null, def };
}

/** Does this token satisfy the gun's ammo rule? */
export function ammoAccepts(rule: AmmoRule | null, token: { id: string; sym: string } | null | undefined): boolean {
  if (!rule) return true;
  if (!token) return false;
  if (rule.ids.length) return rule.ids.includes(token.id);
  return token.sym.toUpperCase() === rule.sym.toUpperCase();
}

/** The ammo a weapon uses, for display (manifest, store cards). */
export function ammoFor(ordnanceId: string): { kind: Ammo; sym: string; name: string; tokenId: string | null; real: boolean } {
  const real = OVERRIDE[ordnanceId];
  const kind = ammoOf({ id: ordnanceId });
  if (real) return { kind, sym: real.sym, name: real.name, tokenId: real.id || null, real: true };
  const d = AMMO[kind];
  return { kind, sym: d.sym, name: d.name, tokenId: d.id || null, real: false };
}
